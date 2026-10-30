import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: process.env.SPRAYS_URL || 'http://127.0.0.1:4175/sprays/', screenshot: 'only-on-failure' },
  webServer: process.env.SPRAYS_URL ? undefined : { command: 'npm run preview -- --port 4175 --strictPort', url: 'http://127.0.0.1:4175/sprays/', reuseExistingServer: false },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: 'chrome' } },
  ],
});
