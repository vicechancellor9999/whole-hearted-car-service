import { expect, test } from "@playwright/test";
import { usePerformanceIdentity } from "./helpers/performance-session";

test.use({ colorScheme: "dark" });

test("new origins follow the operating-system theme", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });

  await page.goto("/login");

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_theme_mode"))).toBe("system");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_theme"))).toBe("dark");
});

test("legacy automatic preference migrates to system mode", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("wh_theme", "dark");
    localStorage.removeItem("wh_theme_source");
    localStorage.removeItem("wh_theme_mode");
  });

  await page.goto("/login");

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_theme_mode"))).toBe("system");
});

test("legacy explicit dark choice migrates to dark mode", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("wh_theme", "dark");
    localStorage.setItem("wh_theme_source", "user");
    localStorage.removeItem("wh_theme_mode");
  });

  await page.goto("/login");

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_theme_mode"))).toBe("dark");
});

test("explicit light mode remains light on a dark operating system", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("wh_theme_mode", "light");
  });

  await page.goto("/login");

  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_theme"))).toBe("light");
});

test("system mode responds to operating-system theme changes", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("wh_theme_mode", "system");
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await page.emulateMedia({ colorScheme: "dark" });

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_theme"))).toBe("dark");
});

test("theme control exposes system light and dark modes", async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
  await page.addInitScript(() => {
    localStorage.setItem("wh_theme_mode", "system");
  });
  await page.goto("/employees");

  const trigger = page.getByRole("button", { name: "主题：跟随系统" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "主题模式" });
  await expect(menu.getByRole("menuitemradio", { name: "跟随系统" })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { name: "柔和亮色" })).toBeVisible();
  await menu.getByRole("menuitemradio", { name: "舒适暗色" }).click();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_theme_mode"))).toBe("dark");
});

test("formal print sheets remain white paper with dark ink inside dark theme", async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
  await page.addInitScript(() => {
    localStorage.setItem("wh_theme_mode", "dark");
  });
  await page.route("**/api/formal/business-orders/7/documents/5", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      id: 5,
      documentNo: "WORK-000005",
      businessOrderId: 7,
      kind: "mechanic_work",
      chargeVersionId: 3,
      chargeVersionNo: 1,
      repairRoundId: 21,
      repairRoundNo: 1,
      generatedAt: "2026-08-28T12:00:00.000Z",
      generatedBy: 1,
      snapshot: {
        version: 1,
        kind: "mechanic_work",
        businessOrder: { id: 7, orderNo: "BO-000007" },
        vehicle: { plate: "1234 AB", description: "Toyota Vitz", vin: "VIN000007" },
        repairRound: { id: 21, roundNo: 1, teamName: "A 组" },
        workItems: [{
          kind: "labor",
          nameZh: "发动机诊断",
          descriptionZh: "读取故障码",
          unitLabelZh: "工时",
          quantity: "1.000",
        }],
        notes: [],
      },
    }),
  }));

  await page.goto("/orders/business/7/documents/5/print?embed=1");

  const paper = page.locator(".formal-print-page");
  await expect(paper).toBeVisible();
  await expect(paper).toContainText("维修工联");
  expect(await paper.evaluate((node) => {
    const style = getComputedStyle(node);
    return { backgroundColor: style.backgroundColor, color: style.color, colorScheme: style.colorScheme };
  })).toEqual({
    backgroundColor: "rgb(255, 255, 255)",
    color: "rgb(15, 23, 42)",
    colorScheme: "light",
  });
});
