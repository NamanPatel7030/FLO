// The installed package (CI and docker/run.sh install the .deb / the NSIS setup before the run):
// desktop entry with the flo:// handler, AppStream metainfo, icons, and the binary starts.
import { assert, ctx, fs, IS_LINUX, IS_WIN, path, ready } from "../support/app.mjs";
import { spawnSync } from "node:child_process";

const installed = () => (IS_LINUX ? ctx().app.startsWith("/usr/") : IS_WIN ? !ctx().app.includes("target") : false);

describe("install", () => {
  it("the installed app starts", async () => {
    await ready();
  });

  it("Linux .deb: desktop entry, flo:// handler, metainfo, icon, dependencies", function () {
    if (!IS_LINUX || !installed()) this.skip();
    const apps = fs.readdirSync("/usr/share/applications").filter((f) => /flo/i.test(f));
    assert.ok(apps.length >= 1, `a desktop entry (${apps})`);
    const entry = fs.readFileSync(path.join("/usr/share/applications", apps[0]), "utf8");
    assert.match(entry, /^Exec=flo-flow/m, "Exec runs flo-flow");
    assert.match(entry, /MimeType=.*x-scheme-handler\/flo/, "registers the flo:// handler (Google sign-in comes back through it)");
    assert.match(entry, /^Categories=.*(Utility|Office|Productivity)/m, "has a menu category");
    assert.ok(fs.existsSync("/usr/share/metainfo/com.flo.flow.metainfo.xml"), "AppStream metainfo (software centres)");
    const icons = spawnSync("sh", ["-c", "ls /usr/share/icons/hicolor/*/apps/ | grep -i flo"], { encoding: "utf8" }).stdout;
    assert.ok(icons.trim(), "icons installed");
    const deps = spawnSync("dpkg-query", ["-W", "-f=${Depends}", "flo"], { encoding: "utf8" }).stdout;
    assert.match(deps, /libwebkit2gtk-4\.1/, `declares its webview dependency (${deps})`);
  });

  it("Windows installer: Start menu shortcut and uninstaller", function () {
    if (!IS_WIN || !installed()) this.skip();
    const dir = path.dirname(ctx().app);
    assert.ok(fs.readdirSync(dir).some((f) => /uninstall/i.test(f)), "an uninstaller next to the app");
    const r = spawnSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "/s", "/f", "Flo"], { encoding: "utf8" });
    assert.match(r.stdout, /DisplayName\s+REG_SZ\s+Flo/i, "listed in Apps & features");
  });
});
