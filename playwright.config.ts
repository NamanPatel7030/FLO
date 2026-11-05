import { defineConfig, devices } from "@playwright/test";

// End-to-end UI tests against the app with the mock backend (window.__floMock), on BOTH engines
// the app ships on:
//   chromium ≈ Windows WebView2      webkit ≈ macOS WKWebView + Linux WebKitGTK
// Locally: Vite dev server + the installed Google Chrome (no Chromium download).
// CI (CI env set): production build served by `vite preview` + Playwright's bundled Chromium.
const CI = !!process.env.CI;
const PORT = 5190;

export default defineConfig({
  testDir: "tests/e2e",
  // the dev server compiles routes on demand; on a loaded machine a cold compile can be slow, so
  // give each test headroom (the heaviest, the onboarding walkthrough, also calls test.slow())
  timeout: 45_000,
  fullyParallel: true,
  // too many parallel browsers starve the single Vite server
  workers: CI ? 2 : 3,
  retries: CI ? 1 : 1,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    // signed in by default (the mock starts signed out); account tests reset this with test.use
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: "flo.mock.signedin", value: "1" }] }] },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...(CI ? {} : { channel: "chrome" }) },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: CI ? `npx vite build && npx vite preview --port ${PORT} --strictPort` : `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: CI ? 180_000 : 60_000,
  },
});
