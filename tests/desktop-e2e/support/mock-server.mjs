// A stand-in for everything Flo talks to on the network during the E2E run, on 127.0.0.1:
// the Flo account server (sign-in, /me, update check) and the speech model host. The app is
// pointed here by FLO_E2E_ACCOUNT_URL / FLO_E2E_MODEL_URL (test builds only, see src-tauri/src/e2e.rs).
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";

export const USER = { id: "u_e2e", email: "e2e@flo.test", name: "Ada Tester" };
export const PASSWORD = "correct-horse-battery";

export async function startMock({ modelFile } = {}) {
  const state = {
    connects: [], // states seen on /app/connect (the browser leg of Google sign-in)
    opened: [], // URLs the app asked the "browser" to open
    requests: [], // every request, "METHOD /path"
    tokens: new Set(),
    codes: new Map(), // one-time code → state it belongs to (null: any)
    update: null, // { version, notes } → the update endpoint offers it
    modelDownloads: 0,
  };

  const json = (res, code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? {}));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        try {
          resolve(JSON.parse(b || "{}"));
        } catch {
          resolve({});
        }
      });
    });
  const issueToken = () => {
    const t = "tok_" + crypto.randomBytes(12).toString("hex");
    state.tokens.add(t);
    return t;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    state.requests.push(`${req.method} ${url.pathname}`);
    const p = url.pathname;

    // ── test-side helpers ──────────────────────────────────────────────────────────────
    if (p === "/__e2e/open") {
      // the fake browser (support/fake-browser.sh) reports what Flo asked it to open
      const target = url.searchParams.get("url") ?? "";
      state.opened.push(target);
      try {
        const t = new URL(target);
        if (t.pathname === "/app/connect" && t.searchParams.get("state")) state.connects.push(t.searchParams.get("state"));
      } catch {}
      return json(res, 200, { ok: true });
    }

    // ── account server ─────────────────────────────────────────────────────────────────
    if (p === "/app/connect") {
      const s = url.searchParams.get("state");
      if (s) state.connects.push(s);
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<p>Signed in with Google (mock). You can go back to Flo.</p>");
    }
    if (p === "/api/app/exchange" && req.method === "POST") {
      const b = await readBody(req);
      const code = String(b.code ?? "").trim().toUpperCase();
      if (!state.codes.has(code)) return json(res, 400, { error: "That code expired. Try again." });
      const want = state.codes.get(code);
      if (want && b.state && want !== b.state) return json(res, 400, { error: "state mismatch" });
      state.codes.delete(code);
      return json(res, 200, { token: issueToken(), user: USER });
    }
    if (p === "/api/app/login" && req.method === "POST") {
      const b = await readBody(req);
      if (b.email === USER.email && b.password === PASSWORD) return json(res, 200, { token: issueToken(), user: USER });
      return json(res, 401, { error: "Wrong email or password." });
    }
    if (p === "/api/app/me") {
      const t = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      return state.tokens.has(t) ? json(res, 200, { user: USER }) : json(res, 401, { error: "signed out" });
    }
    if (p.startsWith("/api/updates/")) {
      if (!state.update) {
        res.writeHead(204);
        return res.end();
      }
      return json(res, 200, { version: state.update.version, notes: state.update.notes ?? "", pub_date: new Date().toISOString(), url: "https://example.invalid/flo.tar.gz", signature: "" });
    }

    // ── speech models: every file is the small real Whisper model the harness fetched ──
    if (p.startsWith("/models/")) {
      if (!modelFile || !fs.existsSync(modelFile)) return json(res, 404, { error: "no model fixture (run npm run fetch-model)" });
      const size = fs.statSync(modelFile).size;
      const range = /bytes=(\d+)-/.exec(req.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      if (start >= size) {
        res.writeHead(416);
        return res.end();
      }
      state.modelDownloads++;
      res.writeHead(range ? 206 : 200, {
        "content-type": "application/octet-stream",
        "content-length": String(size - start),
        ...(range ? { "content-range": `bytes ${start}-${size - 1}/${size}` } : {}),
      });
      return fs.createReadStream(modelFile, { start }).pipe(res);
    }

    // anything else Flo might ask its account host (sync, phone relay, usage…): nothing here
    json(res, 404, {});
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    /** a one-time code, as the website would show it after Google sign-in */
    issueCode(forState = null) {
      const c = "E2E-" + crypto.randomBytes(3).toString("hex").toUpperCase();
      state.codes.set(c, forState);
      return c;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
