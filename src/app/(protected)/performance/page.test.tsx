import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PerformanceView } from "@/app/(protected)/performance/page";

const result = {
  month: "2026-09",
  totalPerformanceMinor: -500_000,
  cancelledHandoffCount: 1,
  targetStatus: "not_configured" as const,
  targetPerformanceMinor: null,
  completionRate: null,
  targetMissingReasons: ["缺少 2026-09 绩效参数"],
  teams: [
    {
      teamId: 21,
      teamName: "维修一组",
      handoffCount: 1,
      cancelledHandoffCount: 1,
      performanceMinor: -2_000_000,
      targetStatus: "not_configured" as const,
      targetPerformanceMinor: null,
      completionRate: null,
      targetMissingReasons: ["缺少 2026-09 绩效参数"],
    },
    {
      teamId: 22,
      teamName: "维修二组",
      handoffCount: 1,
      cancelledHandoffCount: 0,
      performanceMinor: 1_500_000,
      targetStatus: "not_configured" as const,
      targetPerformanceMinor: null,
      completionRate: null,
      targetMissingReasons: ["缺少 2026-09 绩效参数"],
    },
  ],
  handoffs: [
    {
      id: 301,
      businessOrderId: 101,
      orderNo: "BO-20260824-0001",
      repairRoundNo: 2,
      teamId: 21,
      teamName: "维修一组",
      performanceMinor: -2_000_000,
      handedOffAt: new Date("2026-09-03T15:30:00Z"),
      plateDisplay: "7012 AB",
    },
    {
      id: 302,
      businessOrderId: 102,
      orderNo: "BO-20260904-0002",
      repairRoundNo: 1,
      teamId: 22,
      teamName: "维修二组",
      performanceMinor: 1_500_000,
      handedOffAt: new Date("2026-09-04T16:00:00Z"),
      plateDisplay: "4321 AB",
    },
  ],
};

describe("Performance PC page", () => {
  it("shows month selection, team totals and every effective formal handoff", () => {
    render(<PerformanceView result={result} />);

    expect(screen.getByRole("heading", { name: "绩效管理" })).toBeInTheDocument();
    expect(screen.getByLabelText("绩效月份")).toHaveValue("2026-09");
    expect(screen.getByText("JMD -5,000.00")).toBeInTheDocument();
    expect(screen.getByText("未设置目标")).toBeInTheDocument();

    const teams = screen.getByRole("region", { name: "班组绩效汇总" });
    expect(within(teams).getByText("维修一组")).toBeInTheDocument();
    expect(within(teams).getByText("JMD -20,000.00")).toBeInTheDocument();
    expect(within(teams).getByText("维修二组")).toBeInTheDocument();
    expect(within(teams).getByText("JMD 15,000.00")).toBeInTheDocument();

    const details = screen.getByRole("region", { name: "逐次交单绩效明细" });
    expect(within(details).getByText("BO-20260824-0001")).toBeInTheDocument();
    expect(within(details).getByText("7012 AB")).toBeInTheDocument();
    expect(within(details).getByText("第 2 轮维修")).toBeInTheDocument();
    expect(within(details).getByText("JMD -20,000.00")).toBeInTheDocument();
  });

  it("shows a clear empty month without inventing data", () => {
    render(<PerformanceView result={{ ...result, totalPerformanceMinor: 0, teams: [], handoffs: [] }} />);

    expect(screen.getByText("本月没有有效的正式交单绩效记录。")).toBeInTheDocument();
  });
});
