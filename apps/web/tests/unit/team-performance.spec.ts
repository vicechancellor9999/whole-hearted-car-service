import { expect, test } from "@playwright/test";
import { TeamPerformanceSection } from "../../src/components/dashboard/team-performance";
import type { DashboardHeader, TeamPerformance } from "../../src/lib/types";

function visibleText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(visibleText).join(" ");
  if (typeof value !== "object" || value === null || !("props" in value)) return "";
  return visibleText((value as { props?: { children?: unknown } }).props?.children);
}

test("unconfigured shop and team targets render as 未设置目标 without zero amounts or zero percent", () => {
  const header = {
    breadcrumb: "门店经营 · 实时数据",
    title: "经营概览",
    subtitle: "正式数据",
    dateLabel: "2026年8月26日",
    dateTime: "星期三 10:00:00",
    targetStatus: "not_configured",
    targetCompletionRate: null,
    targetCompletedAmount: 3200,
    targetTotalAmount: null,
  } as DashboardHeader;
  const data = {
    title: "维修班组与绩效",
    dateRange: "2026年8月",
    hint: "正式交单后这里显示绩效。",
    actionText: "查看绩效",
    teams: [{
      id: "7",
      name: "机修一组",
      targetStatus: "not_configured",
      completionRate: null,
      currentAmount: 3200,
      targetAmount: null,
      color: "#465fff",
    }],
  } as TeamPerformance;

  const text = visibleText(TeamPerformanceSection({ data, header }));

  expect(text).toContain("未设置目标");
  expect(text).toContain("已完成 JMD 3,200");
  expect(text).not.toContain("0%");
  expect(text).not.toContain("JMD 0 / JMD 0");
});
