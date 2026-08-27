import { expect, test } from "@playwright/test";

test("旧运营概览入口不再展示固定班组数据，统一进入业务单", async ({ page }) => {
  await page.goto("/orders/operations");
  await expect(page).toHaveURL(/\/orders\/business$/u);
  await expect(page.getByRole("heading", { level: 1, name: "业务单" })).toBeVisible();
  await expect(page.getByText("车间一组", { exact: true })).toHaveCount(0);
  await expect(page.getByText("王建华", { exact: true })).toHaveCount(0);
});
