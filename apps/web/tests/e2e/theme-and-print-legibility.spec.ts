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

  await page.getByTestId("account-settings-trigger").click();
  const modes = page.getByTestId("account-theme-options");
  await expect(modes.getByRole("radio", { name: "跟随系统" })).toHaveAttribute("aria-checked", "true");
  await expect(modes.getByRole("radio", { name: "亮色" })).toBeVisible();
  await modes.getByRole("radio", { name: "深色" }).click();

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
    "--wh-background": "#2b3037",
    "--wh-shell": "#24292f",
    "--wh-layer-1": "#3a424c",
    "--wh-layer-2": "#46515d",
    "--wh-layer-3": "#556271",
    "--wh-border-subtle": "#5f6c7c",
    "--wh-border-strong": "#7b899a",
    "--wh-text-primary": "#f5f7fa",
    "--wh-text-secondary": "#d7dde4",
    "--wh-text-tertiary": "#a8b1bd",
    "--wh-accent": "#8db9e8",
  });
});

test("legacy dark surfaces rise through the semantic ladder instead of sinking into shell chrome", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wh_theme_mode", "dark"));
  await page.goto("/login");

  expect(await page.evaluate(() => {
    const host = document.createElement("div");
    host.dataset.testid = "app-shell";
    const primary = document.createElement("div");
    const nested = document.createElement("div");
    const selected = document.createElement("div");
    primary.className = "dark:bg-slate-900";
    nested.className = "dark:bg-slate-800";
    selected.className = "dark:bg-slate-700";
    host.append(primary, nested, selected);
    document.body.append(host);
    return [primary, nested, selected].map((node) => getComputedStyle(node).backgroundColor);
  })).toEqual([
    "rgb(58, 66, 76)",
    "rgb(70, 81, 93)",
    "rgb(85, 98, 113)",
  ]);
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
        canvas: "rgb(43, 48, 55)",
        sidebar: "rgb(36, 41, 47)",
        header: "rgb(58, 66, 76)",
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

    await page.goto("/settings");
    await expect(page.getByTestId("settings-demo-card")).toBeVisible();
    expect(await page.getByTestId("settings-demo-card").evaluate((node) => {
      const style = getComputedStyle(node);
      return { backgroundColor: style.backgroundColor, borderColor: style.borderColor };
    })).toEqual({
      backgroundColor: expected.header,
      borderColor: theme === "light" ? "rgb(212, 219, 228)" : "rgb(95, 108, 124)",
    });
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
    color: "rgb(245, 247, 250)",
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
