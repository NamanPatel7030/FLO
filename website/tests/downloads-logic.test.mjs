// Which installer each Download button serves (no server): node --test tests/downloads-logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { gatedHref, linuxDownload, linuxFormat } from "../lib/downloads.ts";

const REL = "https://github.com/o/r/releases/latest/download";

function withEnv(env, fn) {
  const keys = ["DOWNLOAD_LINUX", "DOWNLOAD_LINUX_DEB", "DOWNLOAD_LINUX_APPIMAGE"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("Linux: the .deb is the main download, the AppImage the other, from one release URL", () => {
  // DOWNLOAD_LINUX may point at either asset: the other sits next to it under its stable name
  withEnv({ DOWNLOAD_LINUX: `${REL}/Flo-linux-x86_64.AppImage` }, () => {
    assert.equal(linuxDownload("deb"), `${REL}/Flo-linux-amd64.deb`);
    assert.equal(linuxDownload("appimage"), `${REL}/Flo-linux-x86_64.AppImage`);
  });
  withEnv({ DOWNLOAD_LINUX: `${REL}/Flo-linux-amd64.deb` }, () => {
    assert.equal(linuxDownload("deb"), `${REL}/Flo-linux-amd64.deb`);
    assert.equal(linuxDownload("appimage"), `${REL}/Flo-linux-x86_64.AppImage`);
  });
  // explicit per-format URLs win
  withEnv({ DOWNLOAD_LINUX: `${REL}/Flo-linux-amd64.deb`, DOWNLOAD_LINUX_APPIMAGE: "/releases/Flo.AppImage" }, () => {
    assert.equal(linuxDownload("appimage"), "/releases/Flo.AppImage");
  });
  // an unknown file: serve it for the .deb button, offer no second format
  withEnv({ DOWNLOAD_LINUX: "/releases/flo-linux.tar.gz" }, () => {
    assert.equal(linuxDownload("deb"), "/releases/flo-linux.tar.gz");
    assert.equal(linuxDownload("appimage"), null);
  });
  withEnv({}, () => {
    assert.equal(linuxDownload("deb"), null);
    assert.equal(linuxDownload("appimage"), null);
  });
});

test("download links stay behind the signed-in route", () => {
  assert.equal(gatedHref("linux"), "/api/download/linux");
  assert.equal(gatedHref("linux", "appimage"), "/api/download/linux?format=appimage");
  assert.equal(gatedHref("mac"), "/api/download/mac");
  assert.equal(linuxFormat("appimage"), "appimage");
  assert.equal(linuxFormat("deb"), "deb");
  for (const v of [null, "", "rpm", "../x"]) assert.equal(linuxFormat(v), "deb");
});
