import { expect, test } from "@playwright/test";
import {
  assertCatalogParity,
  translate,
  type MessageKey,
} from "@/lib/i18n/catalog";
import { formatUiDate, formatUiMoney, formatUiNumber } from "@/lib/i18n/format";

test("English and Chinese catalogs expose the exact same stable message keys", () => {
  expect(() => assertCatalogParity()).not.toThrow();
});

test("typed translation interpolates named values and never falls back to Chinese", () => {
  const key: MessageKey = "performance.summary.completedAgainstTarget";
  expect(translate(key, "zh", { completed: "JMD 10", target: "JMD 20" })).toBe(
    "已完成 JMD 10 / 目标 JMD 20",
  );
  expect(translate(key, "en", { completed: "JMD 10", target: "JMD 20" })).toBe(
    "JMD 10 completed / JMD 20 target",
  );
});

test("translation rejects a missing interpolation variable instead of leaking a broken label", () => {
  expect(() => translate(
    "performance.summary.completedAgainstTarget",
    "en",
    { completed: "JMD 10" },
  )).toThrow(/target/);
});

test("locale formatters use Jamaica business conventions in both interface languages", () => {
  const date = new Date("2026-08-28T13:05:00.000Z");
  expect(formatUiDate(date, "zh", { dateStyle: "medium" })).toBe("2026年8月28日");
  expect(formatUiDate(date, "en", { dateStyle: "medium" })).toBe("28 Aug 2026");
  expect(formatUiNumber(1234.5, "zh", { maximumFractionDigits: 1 })).toBe("1,234.5");
  expect(formatUiNumber(1234.5, "en", { maximumFractionDigits: 1 })).toBe("1,234.5");
  expect(formatUiMoney(1234.5, "zh")).toBe("JMD 1,234.50");
  expect(formatUiMoney(1234.5, "en")).toBe("JMD 1,234.50");
});
