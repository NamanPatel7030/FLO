// Connect Google routes against the running dev server (no real Google calls, no real tokens).
//   cd website && FLO_TEST_DATABASE_URL=postgres://postgres@localhost:54329/flo_test node tests/google-routes.mjs
// (needs `npm run dev` on :3000 using that same DATABASE_URL, with 0010_google.sql applied; never
// `next build` while it runs)
// Covers: setup page when GOOGLE_OAUTH_CLIENT_ID/SECRET are missing, start validation (challenge + scopes),
// install → Google URL (when configured), state validation (CSRF cookie, single use, cancel), claim
// single-use + verifier + account binding + expiry + rate limit, refresh auth + body validation.
// Handoff rows are seeded straight into app.google_handoffs, sealed exactly like lib/google.ts does.
import { createCipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { appToken, BASE, connect, loadEnv, seedUser, testDbUrl } from "./helpers.mjs";

const env = loadEnv();
const SECRET = env.AUTH_SECRET;
if (!SECRET) throw new Error("website/.env.local has no AUTH_SECRET");
const dbUrl = testDbUrl();
if (!dbUrl) {
  console.log("SKIP  set FLO_TEST_DATABASE_URL to the local Postgres the dev server uses");
  process.exit(0);
}
const db = connect(dbUrl);
const owner = await seedUser(db, { name: "Google Owner" });
const stranger = await seedUser(db, { name: "Someone Else" });

const ip = `10.${rnd(255)}.${rnd(255)}.${rnd(255)}`;
function rnd(n) {
  return Math.floor(Math.random() * n);
}
const H = (extra = {}) => ({ "x-forwarded-for": ip, ...extra });

let pass = 0;
let fail = 0;
function check(name, ok, info = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  → ${info}`}`);
}

const b64u = (b) => Buffer.from(b).toString("base64url");
const challengeOf = (v) => createHash("sha256").update(v).digest("base64url");
function seal(plain, aad) {
  const key = Buffer.from(hkdfSync("sha256", SECRET, "", "flo/google-handoff/v1", 32));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
const get = (path, headers = {}) => fetch(BASE + path, { redirect: "manual", headers: H(headers) });
const post = (path, body, headers = {}) =>
  fetch(BASE + path, { method: "POST", redirect: "manual", headers: H({ "content-type": "application/json", ...headers }), body: JSON.stringify(body) });
const loc = (r) => r.headers.get("location") ?? "";

const FAKE = { refresh_token: "1//0g-test-not-a-real-refresh-token", access_token: "ya29.test-not-a-real-access-token", expires_in: 3599, scope: "openid email https://www.googleapis.com/auth/calendar.readonly", email: "owner@example.com" };
async function seed({ code = b64u(randomBytes(24)), verifier = b64u(randomBytes(32)), userId = null, ttl = 5 * 60_000 } = {}) {
  const plain = JSON.stringify({ ...FAKE, obtained_at: Date.now() });
  await db`
    insert into app.google_handoffs (code, sealed, challenge, user_id, email, expires_at)
    values (${code}, ${seal(plain, code)}, ${challengeOf(verifier)}, ${userId}, ${FAKE.email}, now() + make_interval(secs => ${ttl / 1000}))`;
  return { code, verifier };
}
const rows = async (code) => (await db`select 1 from app.google_handoffs where code = ${code}`).length;
const start = (body, headers) => post("/api/google/start", body, headers);

// ── 1. developer setup page / install ────────────────────────────────────────
const configured = !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
{
  const r = await get("/api/google/install?state=whatever");
  if (configured) {
    check("install with unknown state → expired page (Google configured)", r.status === 302 && loc(r).includes("/google/connected?error=expired"), `${r.status} ${loc(r)}`);
    const s = await start({ challenge: challengeOf(b64u(randomBytes(32))), scopes: ["calendar"] });
    const state = new URL((await s.json()).url).searchParams.get("state");
    const go = await get(`/api/google/install?state=${state}`);
    const g = new URL(loc(go) || "http://x/");
    check(
      "install → accounts.google.com with offline, consent, our callback and the chosen scopes",
      g.host === "accounts.google.com" &&
        g.searchParams.get("access_type") === "offline" &&
        g.searchParams.get("prompt") === "consent" &&
        g.searchParams.get("redirect_uri") === `${BASE}/api/google/callback` &&
        g.searchParams.get("scope") === "openid email https://www.googleapis.com/auth/calendar.readonly" &&
        g.searchParams.get("state") === state,
      loc(go),
    );
    check("install pins the state cookie to /api/google", (go.headers.get("set-cookie") ?? "").includes(`flo_google_state=${state}; Path=/api/google; HttpOnly; SameSite=Lax`));
  } else {
    check("install without GOOGLE_OAUTH_CLIENT_ID/SECRET → setup page", r.status === 302 && loc(r).endsWith("/google/setup"), `${r.status} ${loc(r)}`);
  }
  const p = await get("/google/setup");
  const html = await p.text();
  if (!configured) check("setup page names the missing keys", p.status === 200 && html.includes("GOOGLE_OAUTH_CLIENT_ID") && html.includes("GOOGLE_OAUTH_CLIENT_SECRET"));
  check("setup page shows this site's callback and the scopes", html.includes(`${BASE}/api/google/callback`) && html.includes("gmail.send") && html.includes("calendar.readonly"));
  check("setup page never prints secret values", !html.includes(SECRET) && (!env.GOOGLE_OAUTH_CLIENT_SECRET || !html.includes(env.GOOGLE_OAUTH_CLIENT_SECRET)));
}

// ── 2. start + state validation ─────────────────────────────────────────────
{
  const ch = () => challengeOf(b64u(randomBytes(32)));
  check("start rejects a malformed challenge", (await start({ challenge: "short", scopes: ["calendar"] })).status === 400);
  check("start rejects missing scopes", (await start({ challenge: ch() })).status === 400);
  check("start rejects empty scopes", (await start({ challenge: ch(), scopes: [] })).status === 400);
  check("start rejects unknown scopes", (await start({ challenge: ch(), scopes: ["calendar", "drive"] })).status === 400);
  const r = await start({ challenge: ch(), scopes: ["gmail", "calendar"] });
  const j = await r.json();
  const state = new URL(j.url ?? "http://x/").searchParams.get("state") ?? "";
  check("start returns this site's install URL with a one-time state", r.status === 200 && j.url.startsWith(`${BASE}/api/google/install?state=`) && state.length >= 30 && j.expiresIn === 600, JSON.stringify(j));
  const [st] = await db`select scopes from app.google_states where state = ${state}`;
  check("the state remembers the products asked for", st?.scopes === "calendar gmail", JSON.stringify(st));

  const noCookie = await get(`/api/google/callback?state=${state}&code=fake`);
  check("callback without the browser's state cookie → error=state (CSRF)", loc(noCookie).includes("error=state"), loc(noCookie));
  const wrongCookie = await get(`/api/google/callback?state=${state}&code=fake`, { cookie: "flo_google_state=someone-elses" });
  check("callback with a different state cookie → error=state", loc(wrongCookie).includes("error=state"), loc(wrongCookie));
  const unknown = await get(`/api/google/callback?state=nope-not-issued&code=fake`, { cookie: "flo_google_state=nope-not-issued" });
  check("callback with an unissued state → error=expired", loc(unknown).includes("error=expired"), loc(unknown));
  const denied = await get(`/api/google/callback?state=${state}&error=access_denied`, { cookie: `flo_google_state=${state}` });
  check("user cancels on Google → error=denied, cookie cleared", loc(denied).includes("error=denied") && /flo_google_state=;/.test(denied.headers.get("set-cookie") ?? ""), loc(denied));
  const again = await get(`/api/google/callback?state=${state}&code=fake`, { cookie: `flo_google_state=${state}` });
  check("the same state can't be used twice → error=expired", loc(again).includes("error=expired"), loc(again));
  const replay = await get(`/api/google/install?state=${state}`);
  check("install with a used state never reaches Google", replay.status === 302 && !loc(replay).includes("accounts.google.com"), loc(replay));

  await db`insert into app.google_states (state, challenge, scopes, expires_at) values (${"old-state-" + ip}, ${challengeOf("x")}, 'calendar', now() - interval '1 second')`;
  const old = await get(`/api/google/callback?state=old-state-${ip}&code=fake`, { cookie: `flo_google_state=old-state-${ip}` });
  check("expired state → error=expired", loc(old).includes("error=expired"), loc(old));

  const page = await get("/google/connected?error=denied");
  check("error page explains what happened", (await page.text()).includes("cancelled on Google"));
  const ok = await get("/google/connected?code=abcdefghijklmnopqrstuvwx&email=owner%40example.com");
  const okHtml = await ok.text();
  check(
    "success page: Google connected, close this tab, hands off via flo://google",
    okHtml.includes("Google connected") && okHtml.includes("close this tab") && okHtml.includes("flo://google?code=abcdefghijklmnopqrstuvwx") && okHtml.includes("owner@example.com"),
  );
}

// ── 3. claim: single use, verifier, account binding, expiry ─────────────────
{
  check("claim with an unknown code → 401", (await post("/api/google/claim", { code: "nope", verifier: b64u(randomBytes(32)) })).status === 401);
  check("claim without a verifier → 400", (await post("/api/google/claim", { code: "abc" })).status === 400);

  const h = await seed();
  const wrong = await post("/api/google/claim", { code: h.code, verifier: b64u(randomBytes(32)) });
  check("claim with the wrong verifier → 401", wrong.status === 401, String(wrong.status));
  check("…and doesn't burn the code", (await rows(h.code)) === 1);
  const good = await post("/api/google/claim", { code: h.code, verifier: h.verifier });
  const gj = await good.json();
  check(
    "claim with code + verifier → the tokens (once)",
    good.status === 200 &&
      gj.refreshToken === FAKE.refresh_token &&
      gj.accessToken === FAKE.access_token &&
      gj.expiresIn > 3500 &&
      gj.expiresIn <= 3599 &&
      gj.scope === FAKE.scope &&
      gj.email === FAKE.email,
    JSON.stringify({ ...gj, refreshToken: gj.refreshToken ? "…" : undefined, accessToken: gj.accessToken ? "…" : undefined }),
  );
  check("claim response isn't cacheable", (good.headers.get("cache-control") ?? "").includes("no-store"));
  check("row deleted after the claim", (await rows(h.code)) === 0);
  check("second claim of the same code → 401", (await post("/api/google/claim", { code: h.code, verifier: h.verifier })).status === 401);

  const ex = await seed({ ttl: -1000 });
  check("expired handoff → 401", (await post("/api/google/claim", { code: ex.code, verifier: ex.verifier })).status === 401);
  const [sealedRow] = await db`select sealed from app.google_handoffs where code = ${ex.code}`;
  check("tokens are stored encrypted, not in plain text", !!sealedRow && !String(sealedRow.sealed).includes("ya29") && !String(sealedRow.sealed).includes("1//"));

  const bound = await seed({ userId: owner.id });
  check("account-bound handoff without the app session → 401", (await post("/api/google/claim", { code: bound.code, verifier: bound.verifier })).status === 401);
  const other = await appToken(SECRET, stranger.id);
  check("…with another account's session → 401", (await post("/api/google/claim", { code: bound.code, verifier: bound.verifier }, { authorization: `Bearer ${other}` })).status === 401);
  const mine = await appToken(SECRET, owner.id);
  check("…with the same account's session → 200", (await post("/api/google/claim", { code: bound.code, verifier: bound.verifier }, { authorization: `Bearer ${mine}` })).status === 200);

  let limited = false;
  for (let i = 0; i < 35 && !limited; i++) limited = (await post("/api/google/claim", { code: "x" + i, verifier: b64u(randomBytes(32)) })).status === 429;
  check("claim is rate-limited per IP", limited);
  await db`delete from app.google_handoffs where code = ${ex.code}`;
}

// ── 4. start binds the flow to the signed-in account ─────────────────────────
{
  const st = async (token) => {
    const r = await start({ challenge: challengeOf(b64u(randomBytes(32))), scopes: ["calendar"] }, token ? { authorization: `Bearer ${token}` } : {});
    const j = await r.json();
    const state = new URL(j.url ?? "http://x/").searchParams.get("state") ?? "";
    const [row] = await db`select user_id from app.google_states where state = ${state}`;
    return { status: r.status, row };
  };
  const signed = await st(await appToken(SECRET, owner.id));
  check("start with an app session stores the account on the state", signed.status === 200 && signed.row?.user_id === owner.id, JSON.stringify(signed));
  const legacy = await st(await appToken(SECRET, "u_not_a_uuid"));
  check("start with a non-uuid session → unbound state, no crash", legacy.status === 200 && legacy.row && legacy.row.user_id === null, JSON.stringify(legacy));
}

// ── 5. refresh: desktop session required, body validated (no Google call made) ─
{
  const r = await post("/api/google/refresh", { refresh_token: FAKE.refresh_token });
  const j = await r.json();
  check("refresh without a desktop session → 401", r.status === 401 && j.error === "unauthorized", `${r.status} ${JSON.stringify(j)}`);
  const mine = await appToken(SECRET, owner.id);
  const bad = await post("/api/google/refresh", { refresh_token: "x" }, { authorization: `Bearer ${mine}` });
  check("refresh with a bad body → 400", bad.status === 400 && (await bad.json()).error === "bad_request", String(bad.status));
  if (!configured) {
    const ns = await post("/api/google/refresh", { refresh_token: FAKE.refresh_token }, { authorization: `Bearer ${mine}` });
    check("refresh without Google configured → 503 setup", ns.status === 503 && (await ns.json()).error === "setup", String(ns.status));
  }
}

await db`delete from auth.users where id in (${owner.id}, ${stranger.id})`;
await db.end();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
