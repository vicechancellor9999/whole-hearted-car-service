import { expect, test } from "@playwright/test";
import { usePerformanceIdentity } from "./helpers/performance-session";

test.use({ colorScheme: "dark" });

const paletteKeys = [
  "--wh-background",
  "--wh-shell",
  "--wh-layer-1",
  "--wh-layer-2",
  "--wh-layer-3",
  "--wh-border-subtle",
  "--wh-border-strong",
  "--wh-text-primary",
  "--wh-text-secondary",
  "--wh-text-tertiary",
  "--wh-accent",
] as const;

async function readResolvedPalette(page: import("@playwright/test").Page) {
  return page.evaluate((keys) => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(keys.map((key) => [key, style.getPropertyValue(key).trim().toLowerCase()]));
  }, paletteKeys);
}

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

test("soft light mode exposes the approved balanced surface ladder", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_theme_mode", "light"));
  await page.goto("/login");

  expect(await readResolvedPalette(page)).toEqual({
    "--wh-background": "#e9eef3",
    "--wh-shell": "#e0e7ee",
    "--wh-layer-1": "#f8fafc",
    "--wh-layer-2": "#edf1f5",
    "--wh-layer-3": "#e4eaf0",
    "--wh-border-subtle": "#d4dbe4",
    "--wh-border-strong": "#aeb9c7",
    "--wh-text-primary": "#202936",
    "--wh-text-secondary": "#647083",
    "--wh-text-tertiary": "#8490a0",
    "--wh-accent": "#356da8",
  });
});

test("comfort dark mode exposes the approved progressively lighter layers", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_theme_mode", "dark"));
  await page.goto("/login");

  expect(await readResolvedPalette(page)).toEqual({
    "--wh-background": "#272c33",
    "--wh-shell": "#23282f",
    "--wh-layer-1": "#323841",
    "--wh-layer-2": "#3a414b",
    "--wh-layer-3": "#444c57",
    "--wh-border-subtle": "#49515c",
    "--wh-border-strong": "#687281",
    "--wh-text-primary": "#eef2f6",
    "--wh-text-secondary": "#b6c0cc",
    "--wh-text-tertiary": "#909ba9",
    "--wh-accent": "#8db9e8",
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`shared application chrome uses semantic layers in ${theme} mode`, async ({ page }) => {
    await usePerformanceIdentity(page, "superadmin");
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("wh_theme_mode", selectedTheme);
    }, theme);
    await page.goto("/employees");

    const expected = theme === "light"
      ? {
        canvas: "rgb(233, 238, 243)",
        sidebar: "rgb(224, 231, 238)",
        header: "rgb(248, 250, 252)",
      }
      : {
        canvas: "rgb(39, 44, 51)",
        sidebar: "rgb(35, 40, 47)",
        header: "rgb(50, 56, 65)",
      };

    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("page-header")).toBeVisible();
    expect(await page.evaluate(() => {
      const color = (selector: string) => getComputedStyle(document.querySelector(selector)!).backgroundColor;
      return {
        canvas: color('[data-testid="app-shell"]'),
        sidebar: color('[data-testid="sidebar"]'),
        header: color('[data-testid="page-header"]'),
      };
    })).toEqual(expected);
  });
}

test("business order workspace inherits comfort dark instead of overriding the application theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_theme_mode", "dark"));
  await page.goto("/login");

  expect(await page.evaluate(() => {
    const workspace = document.createElement("div");
    workspace.className = "formal-business-order-page";
    document.body.appendChild(workspace);
    const style = getComputedStyle(workspace);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      colorScheme: style.colorScheme,
    };
  })).toEqual({
    backgroundColor: "rgba(0, 0, 0, 0)",
    color: "rgb(238, 242, 246)",
    colorScheme: "dark",
  });
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
