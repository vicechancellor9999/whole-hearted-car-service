import { describe, expect, it } from "vitest";
import {
  calculateCompletionRate,
  calculatePerformanceTargets,
} from "@formal/modules/performance/performance-target";

describe("calculatePerformanceTargets", () => {
  it("calculates the literal monthly target from salary, commission rate and exchange rate", () => {
    expect(calculatePerformanceTargets({
      month: "2026-08",
      commissionRate: 0.25,
      cnyToJmdRate: 22,
      members: [{
        teamId: 7,
        teamName: "维修一组",
        memberId: 3,
        memberName: "张三",
        salaryCnyMinor: 200_000,
      }],
    })).toEqual({
      targetStatus: "configured",
      targetPerformanceMinor: 17_600_000,
      targetMissingReasons: [],
      teams: [{
        teamId: 7,
        teamName: "维修一组",
        targetStatus: "configured",
        targetPerformanceMinor: 17_600_000,
        targetMissingReasons: [],
        members: [{
          teamId: 7,
          teamName: "维修一组",
          memberId: 3,
          memberName: "张三",
          salaryCnyMinor: 200_000,
          targetPerformanceMinor: 17_600_000,
        }],
      }],
    });
  });

  it("reports the exact month when no effective payroll parameter exists", () => {
    expect(calculatePerformanceTargets({
      month: "2026-08",
      commissionRate: null,
      cnyToJmdRate: null,
      members: [{
        teamId: 7,
        teamName: "维修一组",
        memberId: 3,
        memberName: "张三",
        salaryCnyMinor: 200_000,
      }],
    })).toMatchObject({
      targetStatus: "not_configured",
      targetPerformanceMinor: null,
      targetMissingReasons: ["缺少 2026-08 绩效参数"],
      teams: [{
        targetStatus: "not_configured",
        targetMissingReasons: ["缺少 2026-08 绩效参数"],
      }],
    });
  });

  it("names every team member whose effective monthly salary is missing", () => {
    expect(calculatePerformanceTargets({
      month: "2026-08",
      commissionRate: 0.1,
      cnyToJmdRate: 22,
      members: [{
        teamId: 7,
        teamName: "维修一组",
        memberId: 3,
        memberName: "张三",
        salaryCnyMinor: null,
      }],
    })).toMatchObject({
      targetStatus: "not_configured",
      targetPerformanceMinor: null,
      targetMissingReasons: ["维修一组：张三缺少月标准工资"],
      teams: [{
        targetStatus: "not_configured",
        targetPerformanceMinor: null,
        targetMissingReasons: ["维修一组：张三缺少月标准工资"],
      }],
    });
  });

  it("keeps a zero salary as a configured zero target", () => {
    expect(calculatePerformanceTargets({
      month: "2026-08",
      commissionRate: 0.2,
      cnyToJmdRate: 20,
      members: [{
        teamId: 7,
        teamName: "维修一组",
        memberId: 3,
        memberName: "张三",
        salaryCnyMinor: 0,
      }],
    })).toMatchObject({
      targetStatus: "configured",
      targetPerformanceMinor: 0,
      teams: [{ targetStatus: "configured", targetPerformanceMinor: 0 }],
    });
  });

  it("calculates a two-decimal completion rate and leaves a zero target empty", () => {
    expect(calculateCompletionRate(8_800_000, 17_600_000)).toBe(50);
    expect(calculateCompletionRate(2_000_000, 17_600_000)).toBe(11.36);
    expect(calculateCompletionRate(0, 0)).toBeNull();
  });

  it("rounds each member to JMD minor units and sums separate teams", () => {
    expect(calculatePerformanceTargets({
      month: "2026-08",
      commissionRate: 0.3,
      cnyToJmdRate: 21.5,
      members: [{
        teamId: 7,
        teamName: "维修一组",
        memberId: 3,
        memberName: "张三",
        salaryCnyMinor: 100_001,
      }, {
        teamId: 8,
        teamName: "维修二组",
        memberId: 4,
        memberName: "李四",
        salaryCnyMinor: 200_002,
      }],
    })).toEqual({
      targetStatus: "configured",
      targetPerformanceMinor: 21_500_215,
      targetMissingReasons: [],
      teams: [{
        teamId: 7,
        teamName: "维修一组",
        targetStatus: "configured",
        targetPerformanceMinor: 7_166_738,
        targetMissingReasons: [],
        members: [{
          teamId: 7,
          teamName: "维修一组",
          memberId: 3,
          memberName: "张三",
          salaryCnyMinor: 100_001,
          targetPerformanceMinor: 7_166_738,
        }],
      }, {
        teamId: 8,
        teamName: "维修二组",
        targetStatus: "configured",
        targetPerformanceMinor: 14_333_477,
        targetMissingReasons: [],
        members: [{
          teamId: 8,
          teamName: "维修二组",
          memberId: 4,
          memberName: "李四",
          salaryCnyMinor: 200_002,
          targetPerformanceMinor: 14_333_477,
        }],
      }],
    });
  });

  it("uses a team's effective special commission rate instead of the whole-shop default", () => {
    expect(calculatePerformanceTargets({
      month: "2026-08",
      commissionRate: 0.25,
      cnyToJmdRate: 22,
      teamCommissionRates: { 8: 0.2 },
      members: [{
        teamId: 7,
        teamName: "维修一组",
        memberId: 3,
        memberName: "张三",
        salaryCnyMinor: 200_000,
      }, {
        teamId: 8,
        teamName: "维修二组",
        memberId: 4,
        memberName: "李四",
        salaryCnyMinor: 200_000,
      }],
    })).toMatchObject({
      targetPerformanceMinor: 39_600_000,
      teams: [{ teamId: 7, targetPerformanceMinor: 17_600_000 }, {
        teamId: 8,
        targetPerformanceMinor: 22_000_000,
      }],
    });
  });
});
