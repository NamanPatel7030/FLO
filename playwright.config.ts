import { defineConfig } from "@playwright/test";

// End-to-end UI tests against the Vite preview with the mock backend (window.__floMock).
// Uses the locally installed Google Chrome — no browser download.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  // the Vite dev server compiles on demand; too many parallel browsers starve it
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5190",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite --port 5190 --strictPort",
    url: "http://localhost:5190",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
