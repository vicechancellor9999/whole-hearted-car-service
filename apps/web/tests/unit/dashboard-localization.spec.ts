import { expect, test } from "@playwright/test";
import { localizeDashboardCard, localizeDashboardTeam } from "../../src/lib/i18n/dashboard-localization";

test("English dashboard cards replace backend Chinese system copy by stable card id", () => {
  const card = localizeDashboardCard({
    id: "today_revenue",
    href: "/revenue?range=day",
    title: "今日营业收入",
    subtitle: "今日逐笔收款 − 今日逐笔退款",
    value: 123,
    valuePrefix: "JMD ",
    valueSuffix: "单",
    breakdownItems: [{ label: "今日收款", value: "JMD 200" }],
    footerItems: [{ label: "退款记录", value: "2 笔" }],
    size: "large",
  }, "en");

  expect(card.title).toBe("Today's operating revenue");
  expect(card.subtitle).toBe("Payments received today − refunds issued today");
  expect(card.valueSuffix).toBe("");
  expect(JSON.stringify(card)).not.toMatch(/[\p{Script=Han}]/u);
});

test("English dashboard teams mark untranslated business dictionary values explicitly", () => {
  const team = localizeDashboardTeam({
    id: "4",
    name: "工程机械",
    targetStatus: "not_configured",
    completionRate: null,
    currentAmount: 0,
    targetAmount: null,
    targetMissingReasons: ["缺少 2026-08 绩效参数"],
    color: "#000",
  }, "en");

  expect(team.name).toBe("Team 4 · Translation required");
  expect(team.targetMissingReasons).toEqual(["Performance parameters are missing for 2026-08"]);
  expect(JSON.stringify(team)).not.toMatch(/[\p{Script=Han}]/u);
});
