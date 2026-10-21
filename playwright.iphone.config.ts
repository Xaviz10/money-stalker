import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: ['**/mobile-layout.spec.ts', '**/location.spec.ts', '**/loans.spec.ts'],
  projects: [320, 375, 390, 430].map(width => ({
    name: `iphone-webkit-${width}`,
    use: { ...devices['iPhone 13'], browserName: 'webkit' as const, defaultBrowserType: 'webkit' as const, viewport: { width, height: 844 }, launchOptions: {} },
  })),
});
