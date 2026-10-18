import { defineConfig, devices } from "@playwright/test";
const apiPort = process.env.E2E_API_PORT ?? "8787";
const webPort = process.env.E2E_WEB_PORT ?? "5173";
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: `${webOrigin}/money-stalker/`,
    trace: "retain-on-failure",
    ...(process.env.PLAYWRIGHT_CHROME_PATH
      ? {
          launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH },
        }
      : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: `LOCAL_EPHEMERAL=1 LOCAL_API_PORT=${apiPort} LOCAL_WEB_PORT=${webPort} node --import tsx server/local.ts`,
      url: `${apiOrigin}/api/state`,
      reuseExistingServer: false,
    },
    {
      command: `LOCAL_API_URL=${apiOrigin} npm run dev:web -- --port ${webPort}`,
      url: `${webOrigin}/money-stalker/`,
      reuseExistingServer: false,
    },
  ],
});
