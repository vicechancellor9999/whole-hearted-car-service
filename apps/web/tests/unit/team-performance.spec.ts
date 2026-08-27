import { expect, test } from "@playwright/test";
import { TeamPerformanceSection } from "../../src/components/dashboard/team-performance";
import type { DashboardHeader, TeamPerformance } from "../../src/lib/types";

function visibleText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(visibleText).join(" ");
  if (typeof value !== "object" || value === null || !("props" in value)) return "";
  return visibleText((value as { props?: { children?: unknown } }).props?.children);
}

function hrefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(hrefs);
  if (typeof value !== "object" || value === null || !("props" in value)) return [];
  const props = (value as { props?: { href?: unknown; children?: unknown } }).props;
  return [typeof props?.href === "string" ? props.href : null, ...hrefs(props?.children)]
    .filter((href): href is string => href !== null);
}

test("an incomplete target renders the exact missing fact without zero amounts or zero percent", () => {
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
    targetMissingReasons: ["机修一组：张三缺少月标准工资"],
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
      targetMissingReasons: ["机修一组：张三缺少月标准工资"],
      color: "#465fff",
    }],
  } as TeamPerformance;

  const text = visibleText(TeamPerformanceSection({ data, header }));

  expect(text).toContain("机修一组：张三缺少月标准工资");
  expect(text).toContain("已完成 JMD 3,200");
  expect(text).not.toContain("未设置目标");
  expect(text).not.toContain("0%");
  expect(text).not.toContain("JMD 0 / JMD 0");
});

test("a calculated target renders the completion rate and exact target amount", () => {
  const header = {
    breadcrumb: "门店经营 · 实时数据",
    title: "经营概览",
    subtitle: "正式数据",
    dateLabel: "2026年8月26日",
    dateTime: "星期三 10:00:00",
    targetStatus: "configured",
    targetCompletionRate: 50,
    targetCompletedAmount: 88_000,
    targetTotalAmount: 176_000,
    targetMissingReasons: [],
  } as DashboardHeader;
  const data = {
    title: "维修班组与绩效",
    dateRange: "2026年8月",
    hint: "正式交单后这里显示绩效。",
    actionText: "查看绩效",
    teams: [{
      id: "7",
      name: "机修一组",
      targetStatus: "configured",
      completionRate: 50,
      currentAmount: 88_000,
      targetAmount: 176_000,
      targetMissingReasons: [],
      color: "#465fff",
    }],
  } as TeamPerformance;

  const text = visibleText(TeamPerformanceSection({ data, header }));

  expect(text).toContain("50%");
  expect(text).toContain("JMD 88,000 / JMD 176,000");
  expect(text).toContain("目标 JMD 176,000");
});

test("a configured zero target is shown as not applicable rather than missing", () => {
  const header = {
    breadcrumb: "门店经营 · 实时数据",
    title: "经营概览",
    subtitle: "正式数据",
    dateLabel: "2026年8月26日",
    dateTime: "星期三 10:00:00",
    targetStatus: "configured",
    targetCompletionRate: null,
    targetCompletedAmount: 0,
    targetTotalAmount: 0,
    targetMissingReasons: [],
  } as DashboardHeader;
  const data = {
    title: "维修班组与绩效",
    dateRange: "2026年8月",
    hint: "正式交单后这里显示绩效。",
    actionText: "查看绩效",
    teams: [{
      id: "7",
      name: "机修一组",
      targetStatus: "configured",
      completionRate: null,
      currentAmount: 0,
      targetAmount: 0,
      targetMissingReasons: [],
      color: "#465fff",
    }],
  } as TeamPerformance;

  const text = visibleText(TeamPerformanceSection({ data, header }));

  expect(text).toContain("完成率不适用");
  expect(text).toContain("目标 JMD 0");
  expect(text).not.toContain("目标资料不完整");
});

test("a missing monthly performance parameter links the affected team to its settings entry", () => {
  const header = {
    targetStatus: "not_configured",
    targetCompletionRate: null,
    targetCompletedAmount: 0,
    targetTotalAmount: null,
    targetMissingReasons: ["缺少 2026-08 绩效参数"],
  } as DashboardHeader;
  const data = {
    title: "维修班组与绩效",
    dateRange: "2026年8月",
    hint: "正式交单后这里显示绩效。",
    actionText: "查看绩效",
    teams: [{
      id: "7",
      name: "维修一组",
      targetStatus: "not_configured",
      completionRate: null,
      currentAmount: 0,
      targetAmount: null,
      targetMissingReasons: ["缺少 2026-08 绩效参数"],
      color: "#465fff",
    }],
  } as TeamPerformance;

  expect(hrefs(TeamPerformanceSection({ data, header })))
    .toContain("/settings?team=7#performance-parameters");
});
