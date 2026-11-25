import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3123",
    trace: "on-first-retry",
    ...devices["iPhone 14"],
    defaultBrowserType: "chromium",
  },
  webServer: {
    command: "PORT=3123 BETTER_AUTH_URL=http://localhost:3123 APP_URL=http://localhost:3123 NEXT_PUBLIC_APP_URL=http://localhost:3123 npm run start",
    url: "http://localhost:3123/api/health",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
