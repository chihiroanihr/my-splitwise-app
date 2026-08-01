import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.TEST_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // The app is mobile-first; test it at the size people actually use.
    ...devices["iPhone 13"],
  },
  projects: [{ name: "mobile-safari", use: { ...devices["iPhone 13"] } }],
});
