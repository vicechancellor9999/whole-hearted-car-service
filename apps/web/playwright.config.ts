import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const qaRoot = path.resolve(process.cwd(), "../qa");
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3002";
const port = new URL(baseURL).port || "3000";
const reuseExistingServer = process.env.E2E_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 2_500 },
  outputDir: path.join(qaRoot, "playwright-results"),
  reporter: [["line"]],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    channel: "chrome",
    viewport: { width: 1920, height: 841 },
    actionTimeout: 3_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "./start-dev.sh",
    url: baseURL,
    reuseExistingServer,
    timeout: 120_000,
    env: {
      PORT: port,
      NEXT_PUBLIC_FORMAL_AUTH: "false",
      npm_config_cache:
        "/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/.cache/npm",
    },
  },
});
