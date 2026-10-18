import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5173/money-stalker/', trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHROME_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } } : {}) },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: [
    { command: 'LOCAL_EPHEMERAL=1 node --import tsx server/local.ts', url: 'http://127.0.0.1:8787/api/state', reuseExistingServer: false },
    { command: 'npm run dev:web', url: 'http://127.0.0.1:5173/money-stalker/', reuseExistingServer: false },
  ],
});
