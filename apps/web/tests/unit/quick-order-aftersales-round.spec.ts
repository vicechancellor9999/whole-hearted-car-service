import { expect, test } from "@playwright/test";
import { createMockLinkedOperationsStore } from "../../src/lib/api/mock-orders";
import { applyMockQuickOrderAction } from "../../src/lib/api/mock-quick-orders";
import { summarizeQuickOrderPerformance } from "../../src/lib/orders/performance-value";

test("售后回厂在原 Business Order 开始下一轮并保留上一轮交单事实", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => key === "wh_teams_v2"
          ? JSON.stringify([{ id: "t1", name: "第一维修班组", engineering: false, builtin: false }])
          : null,
        setItem: () => undefined,
      },
    },
  });
  const store = createMockLinkedOperationsStore();
  await store.ready();
  try {
    const id = "demo-v2-parking-unclaimed";
    await applyMockQuickOrderAction(id, { kind: "assign", teamId: "t1" }, "超级管理员", "frontdesk", store);
    await applyMockQuickOrderAction(id, { kind: "accept", mechanicName: "维修工甲" }, "维修工甲", "mechanic", store);
    await applyMockQuickOrderAction(id, { kind: "return" }, "维修工甲", "mechanic", store);
    const before = await applyMockQuickOrderAction(id, { kind: "submit" }, "超级管理员", "frontdesk", store);
    const priorEvents = structuredClone(before.statusHistory);

    const after = await applyMockQuickOrderAction(
      before.id,
      { kind: "start_aftersales_round", reason: "客户反馈维修问题，车辆售后回厂" },
      "超级管理员",
      "frontdesk",
      store,
    );

    expect(after.id).toBe(before.id);
    expect(after.status).toBe("pending_assign");
    expect(after.submittedAt).toBeNull();
    expect(after.teamId).toBeNull();
    expect(after.performanceValueJmd).toBe(0);
    expect(after.statusHistory.slice(0, priorEvents.length)).toMatchObject([...priorEvents]);
    expect(after.statusHistory.at(-1)).toMatchObject({
      from: "submitted",
      to: "pending_assign",
      reason: "售后回厂第 2 轮：客户反馈维修问题，车辆售后回厂",
    });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("同一 Business Order 的每次交单按各自时间、班组和绩效独立统计", () => {
  const order = {
    teamId: "t2",
    performanceValueJmd: 10_000,
    submittedAt: "2026-08-20T12:00:00-05:00",
    orderKind: "normal" as const,
    voidedAt: null,
    statusHistory: [
      { id: "s1", from: "returned" as const, to: "submitted" as const, by: "超级管理员", byRole: "frontdesk" as const, at: "2026-07-20T12:00:00-05:00", roundNumber: 1, teamId: "t1", performanceValueJmd: 20_000 },
      { id: "r2", from: "submitted" as const, to: "pending_assign" as const, by: "超级管理员", byRole: "frontdesk" as const, at: "2026-08-10T12:00:00-05:00", roundNumber: 2 },
      { id: "s2", from: "returned" as const, to: "submitted" as const, by: "超级管理员", byRole: "frontdesk" as const, at: "2026-08-12T12:00:00-05:00", roundNumber: 2, teamId: "t1", performanceValueJmd: -20_000 },
      { id: "r3", from: "submitted" as const, to: "pending_assign" as const, by: "超级管理员", byRole: "frontdesk" as const, at: "2026-08-15T12:00:00-05:00", roundNumber: 3 },
      { id: "s3", from: "returned" as const, to: "submitted" as const, by: "超级管理员", byRole: "frontdesk" as const, at: "2026-08-20T12:00:00-05:00", roundNumber: 3, teamId: "t2", performanceValueJmd: 10_000 },
    ],
  };

  expect(summarizeQuickOrderPerformance([order], "2026-07").counted).toEqual({ orderCount: 1, totalValueJmd: 20_000 });
  expect(summarizeQuickOrderPerformance([order], "2026-08").counted).toEqual({ orderCount: 2, totalValueJmd: -10_000 });
});
