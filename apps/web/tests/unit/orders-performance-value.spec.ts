import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";
import {
  createMockLinkedOperationsStore,
  LINKED_OPERATIONS_STORAGE_KEY,
  recordMockOrderReassignment,
} from "../../src/lib/api/mock-orders";
import {
  computeDefaultPerformanceValue,
  summarizeBusinessOrderPerformance,
  summarizeQuickOrderPerformance,
} from "../../src/lib/orders/performance-value";
import type { BusinessOrder } from "../../src/lib/orders/business-order-types";
import type { QuickOrder } from "../../src/lib/orders/quick-order-types";

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function installBrowser(
  session: unknown = null,
  scenario?: unknown,
  values = new Map<string, string>(),
): () => void {
  if (session !== null) values.set("wh_session", JSON.stringify(session));
  const storage: MemoryStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

const session = (id: string, role: string, name = "测试用户") => ({ identity: { id, role, name } });
const superadmin = session("emp-001", "superadmin", "LiJian");
const finance = session("emp-002", "finance");
const frontdesk = session("emp-003", "frontdesk_admin");
const parts = session("emp-004", "parts");

function fakeOrder(laborLines: number[], otherLines: number[] = []): BusinessOrder {
  return {
    id: "order-fake",
    businessOrderNo: "FAKE-001",
    customerId: "customer-fake",
    vehicleId: "vehicle-fake",
    executionStatus: "in_progress",
    executionTeamId: "t1",
    startMileage: null,
    items: [{
      id: "item-fake",
      sourceProject: {
        inspectionReportId: "ir-fake",
        inspectionItemId: "ir-item-fake",
        quotationId: "qt-fake",
        quotationVersionId: "qt-fake-v1",
        quotationItemId: "qt-item-fake",
        businessOrderId: "order-fake",
        businessOrderItemId: "item-fake",
        inspectorTeamId: "t1",
        executionTeamId: "t1",
        executionStatus: "in_progress",
      },
      chargeLines: [
        ...laborLines.map((unitPriceJmd, index) => ({
          id: `labor-${index}`,
          category: "labor" as const,
          code: "repair" as const,
          descriptionZh: "工时",
          descriptionEn: "Labor",
          quantity: 1,
          unitPriceJmd,
          sourceId: "src",
        })),
        ...otherLines.map((unitPriceJmd, index) => ({
          id: `parts-${index}`,
          category: "parts" as const,
          code: "part" as const,
          descriptionZh: "配件",
          descriptionEn: "Part",
          quantity: 1,
          unitPriceJmd,
          sourceId: "src",
        })),
      ],
    }],
    invoiceIds: [],
    vehicleReleaseFacts: [],
    performanceValueJmd: 0,
    performanceCountedAt: null,
    formalSubmittedAt: null,
    formalSubmittedBy: null,
  };
}

test("默认绩效值 = 工时费合计（1:1，8/18 老板定），忽略配件与其他服务", () => {
  expect(computeDefaultPerformanceValue(fakeOrder([12_000], [3_500]))).toBe(12_000);
  expect(computeDefaultPerformanceValue(fakeOrder([10_000, 8_000], [99_999]))).toBe(18_000);
  expect(computeDefaultPerformanceValue(fakeOrder([10_001]))).toBe(10_001);
  expect(computeDefaultPerformanceValue(fakeOrder([]))).toBe(0);
});

test("种子业务单全部带默认绩效值，月度汇总区分已计入与待计入并只归班组", async () => {
  const restore = installBrowser(superadmin);
  try {
    const expected = createMockLinkedOperationsStore().read((state) => ({
      orderCount: state.businessOrders.length,
      allValuesDerived: state.businessOrders.every((order) => (
        order.performanceValueJmd === computeDefaultPerformanceValue(order)
      )),
      summary: summarizeQuickOrderPerformance(state.quickOrders, "2026-08"),
    }));
    expect(expected.orderCount).toBe(300);
    expect(expected.allValuesDerived).toBe(true);

    const detail = await api.billing.businessOrder("order-demo-04");
    expect(detail.businessOrder.performanceValueJmd).toBe(10_000);
    expect(detail.businessOrder.performanceCountedAt).toBeNull();
    expect(detail.businessOrder.formalSubmittedAt).toBeNull();

    const submitted = await api.billing.businessOrder("order-demo-05");
    expect(submitted.businessOrder.performanceValueJmd).toBe(18_000);
    expect(submitted.businessOrder.formalSubmittedAt).toBe("2026-08-09T14:30:00-05:00");
    expect(submitted.businessOrder.performanceCountedAt).toBe("2026-08-09T14:30:00-05:00");

    const summary = await api.performance.ordersSummary("2026-08");
    expect(summary).toEqual({
      ...expected.summary,
      stateRevision: expect.any(Number),
    });
    expect(summary.byTeam.reduce((total, team) => total + team.countedOrderCount, 0))
      .toBe(summary.counted.orderCount);
    // 未派组的待计入单只进全局待计入，不归任何班组桶
    expect(summary.byTeam.reduce((total, team) => total + team.pendingValueJmd, 0))
      .toBeLessThanOrEqual(summary.pending.totalValueJmd);
  } finally {
    restore();
  }
});

test("正式交单成功：写入交单事实与计入时间、生命周期进入已交单未取车、记审计", async () => {
  const nowMs = Date.parse("2026-08-10T15:00:00.000Z");
  const values = new Map<string, string>();
  const restore = installBrowser(superadmin, { nowMs }, values);
  try {
    const before = await api.billing.businessOrder("order-demo-04");
    const summaryBefore = await api.performance.ordersSummary("2026-08");
    expect(before.businessOrder.performanceCountedAt).toBeNull();
    void summaryBefore;

    const result = await api.orders.formalSubmit({
      orderId: "order-demo-04",
      confirmedPerformanceValueJmd: 10_000,
      expectedRevision: before.revision,
    });
    expect(result).toMatchObject({
      orderId: "order-demo-04",
      performanceValueJmd: 10_000,
      formalSubmittedAt: "2026-08-10T15:00:00.000Z",
      formalSubmittedBy: "emp-001",
      performanceCountedAt: "2026-08-10T15:00:00.000Z",
      revision: before.revision + 1,
    });
    expect(result.audit).toMatchObject({
      orderId: "order-demo-04",
      kind: "formal_submitted",
      actorId: "emp-001",
      previousValueJmd: 10_000,
      newValueJmd: 10_000,
    });

    const list = await api.orders.list({ lifecycle: "all", pageSize: 500 });
    expect(list.items.find((item) => item.id === "order-demo-04")?.processingStatus)
      .toBe("submitted_awaiting_collection");

    const after = await api.billing.businessOrder("order-demo-04");
    expect(after.businessOrder.formalSubmittedAt).toBe("2026-08-10T15:00:00.000Z");
    expect(after.businessOrder.formalSubmittedBy).toBe("emp-001");
    expect(after.businessOrder.performanceCountedAt).toBe("2026-08-10T15:00:00.000Z");
    expect(after.revision).toBe(before.revision + 1);

    const persisted = JSON.parse(values.get(LINKED_OPERATIONS_STORAGE_KEY) ?? "null");
    expect(persisted.performanceAudits).toHaveLength(1);
    expect(persisted.performanceAudits[0]).toMatchObject({
      orderId: "order-demo-04",
      kind: "formal_submitted",
      actorId: "emp-001",
      actorName: "LiJian",
      at: "2026-08-10T15:00:00.000Z",
    });

    // 新 BO 口径：血统型 BO 的动作不改变快速工单汇总（2026-08-17 对齐版）
    const summary = await api.performance.ordersSummary("2026-08");
    expect(summary.counted).toEqual(summaryBefore.counted);
    expect(summary.pending).toEqual(summaryBefore.pending);
  } finally {
    restore();
  }
});

test("重复正式交单与非交单状态被拒绝且不落审计", async () => {
  const restore = installBrowser(superadmin);
  try {
    const submitted = await api.billing.businessOrder("order-demo-05");
    await expect(api.orders.formalSubmit({
      orderId: "order-demo-05",
      confirmedPerformanceValueJmd: 18_000,
      expectedRevision: submitted.revision,
    })).rejects.toMatchObject({ status: 409 });

    const dispatched = await api.billing.businessOrder("order-demo-01");
    await expect(api.orders.formalSubmit({
      orderId: "order-demo-01",
      confirmedPerformanceValueJmd: 12_000,
      expectedRevision: dispatched.revision,
    })).rejects.toMatchObject({ status: 409 });

    await expect(api.orders.formalSubmit({
      orderId: "order-missing",
      confirmedPerformanceValueJmd: 0,
      expectedRevision: 1,
    })).rejects.toMatchObject({ status: 404 });
  } finally {
    restore();
  }
});

test("交单确认的绩效值与单上不一致时返回 409 且不改变状态", async () => {
  const restore = installBrowser(superadmin);
  try {
    const before = await api.billing.businessOrder("order-demo-04");
    await expect(api.orders.formalSubmit({
      orderId: "order-demo-04",
      confirmedPerformanceValueJmd: 9_999,
      expectedRevision: before.revision,
    })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/绩效值已变化|未核对/) });

    const after = await api.billing.businessOrder("order-demo-04");
    expect(after.businessOrder.formalSubmittedAt).toBeNull();
    expect(after.businessOrder.performanceCountedAt).toBeNull();
    const list = await api.orders.list({ lifecycle: "all", pageSize: 500 });
    expect(list.items.find((item) => item.id === "order-demo-04")?.processingStatus)
      .toBe("returned_awaiting_frontdesk");
  } finally {
    restore();
  }
});

test("交单前可手工调整绩效值：只改绩效值、记审计、不动执行与财务状态", async () => {
  const restore = installBrowser(superadmin);
  try {
    const before = await api.billing.businessOrder("order-demo-03");
    const summaryBefore = await api.performance.ordersSummary("2026-08");
    const listBefore = await api.orders.list({ lifecycle: "all", pageSize: 500 });
    const itemBefore = listBefore.items.find((item) => item.id === "order-demo-03");

    const result = await api.orders.updatePerformanceValue({
      orderId: "order-demo-03",
      performanceValueJmd: 6_000,
      reason: "客户现场核减免费检测项目",
      expectedRevision: before.revision,
    });
    expect(result).toMatchObject({
      orderId: "order-demo-03",
      performanceValueJmd: 6_000,
      revision: before.revision + 1,
    });
    expect(result.audit).toMatchObject({
      kind: "performance_value_adjusted",
      actorId: "emp-001",
      previousValueJmd: 22_000,
      newValueJmd: 6_000,
      reason: "客户现场核减免费检测项目",
    });

    const after = await api.billing.businessOrder("order-demo-03");
    expect(after.businessOrder.performanceValueJmd).toBe(6_000);
    expect(after.businessOrder.executionTeamId).toBe(before.businessOrder.executionTeamId);
    expect(after.businessOrder.formalSubmittedAt).toBeNull();
    expect(after.settlementStatus).toBe(before.settlementStatus);

    const listAfter = await api.orders.list({ lifecycle: "all", pageSize: 500 });
    const itemAfter = listAfter.items.find((item) => item.id === "order-demo-03");
    expect(itemAfter?.processingStatus).toBe(itemBefore?.processingStatus);
    expect(itemAfter?.settlementStatus).toBe(itemBefore?.settlementStatus);
    expect(itemAfter?.receivableJmd).toBe(itemBefore?.receivableJmd);

    // 新 BO 口径：血统型 BO 的调整不改变快速工单汇总
    const summary = await api.performance.ordersSummary("2026-08");
    expect(summary.pending).toEqual(summaryBefore.pending);

    await expect(api.orders.updatePerformanceValue({
      orderId: "order-demo-03",
      performanceValueJmd: -1,
      reason: "非法值",
      expectedRevision: after.revision,
    })).rejects.toMatchObject({ status: 400 });
    await expect(api.orders.updatePerformanceValue({
      orderId: "order-demo-03",
      performanceValueJmd: 6_000,
      reason: "  ",
      expectedRevision: after.revision,
    })).rejects.toMatchObject({ status: 400 });
  } finally {
    restore();
  }
});

test("已正式交单的工单禁止调整绩效值", async () => {
  const restore = installBrowser(superadmin);
  try {
    const detail = await api.billing.businessOrder("order-demo-05");
    await expect(api.orders.updatePerformanceValue({
      orderId: "order-demo-05",
      performanceValueJmd: 9_999,
      reason: "交单后试图修改",
      expectedRevision: detail.revision,
    })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/交单|已计入/) });

    const after = await api.billing.businessOrder("order-demo-05");
    expect(after.businessOrder.performanceValueJmd).toBe(18_000);
  } finally {
    restore();
  }
});

test("正式交单后改组被锁定（沿用既有规则）", async () => {
  const restore = installBrowser(superadmin);
  try {
    const before = await api.billing.businessOrder("order-demo-04");
    await api.orders.formalSubmit({
      orderId: "order-demo-04",
      confirmedPerformanceValueJmd: 10_000,
      expectedRevision: before.revision,
    });
    await expect(api.orders.reassign({
      orderId: "order-demo-04",
      expectedFromTeamId: "t1",
      toTeamId: "t2",
      reason: "交单后试图改组",
    })).rejects.toThrow(/正式交单后|不允许改组/);
  } finally {
    restore();
  }
});

test("财务与配件身份无权交单或调整绩效值，无会话与 parts 无权读汇总", async () => {
  for (const denied of [finance, parts, null]) {
    const restore = installBrowser(denied);
    try {
      await expect(api.orders.formalSubmit({
        orderId: "order-demo-04",
        confirmedPerformanceValueJmd: 10_000,
        expectedRevision: 1,
      })).rejects.toMatchObject({ status: 403 });
      await expect(api.orders.updatePerformanceValue({
        orderId: "order-demo-04",
        performanceValueJmd: 10_000,
        reason: "越权调整",
        expectedRevision: 1,
      })).rejects.toMatchObject({ status: 403 });
    } finally {
      restore();
    }
  }

  for (const allowed of [superadmin, finance, frontdesk]) {
    const restore = installBrowser(allowed);
    try {
      await expect(api.performance.ordersSummary("2026-08")).resolves.toMatchObject({ month: "2026-08" });
    } finally {
      restore();
    }
  }
  for (const denied of [parts, null]) {
    const restore = installBrowser(denied);
    try {
      await expect(api.performance.ordersSummary("2026-08")).rejects.toMatchObject({ status: 403 });
    } finally {
      restore();
    }
  }
});

test("expectedRevision 乐观锁：过期版本 409，非法版本 400", async () => {
  const restore = installBrowser(superadmin);
  try {
    const before = await api.billing.businessOrder("order-demo-04");
    await api.orders.updatePerformanceValue({
      orderId: "order-demo-04",
      performanceValueJmd: 2_600,
      reason: "第一次调整",
      expectedRevision: before.revision,
    });
    await expect(api.orders.updatePerformanceValue({
      orderId: "order-demo-04",
      performanceValueJmd: 2_700,
      reason: "基于旧页面的并发调整",
      expectedRevision: before.revision,
    })).rejects.toMatchObject({ status: 409 });
    await expect(api.orders.formalSubmit({
      orderId: "order-demo-04",
      confirmedPerformanceValueJmd: 2_600,
      expectedRevision: before.revision,
    })).rejects.toMatchObject({ status: 409 });

    const current = await api.billing.businessOrder("order-demo-04");
    await expect(api.orders.formalSubmit({
      orderId: "order-demo-04",
      confirmedPerformanceValueJmd: 2_600,
      expectedRevision: 0,
    })).rejects.toMatchObject({ status: 400 });
    expect(current.businessOrder.performanceValueJmd).toBe(2_600);
  } finally {
    restore();
  }
});

test("新 BO 汇总口径：已计入按 submittedAt 归属月份，待计入不限月份且未派组不归班组桶；售后不计、对冲负值扣回", () => {
  const quick = (teamId: string | null, submittedAt: string | null, performanceValueJmd: number, orderKind: QuickOrder["orderKind"] = "normal"): Pick<QuickOrder, "teamId" | "submittedAt" | "performanceValueJmd" | "orderKind" | "voidedAt"> => ({
    teamId, submittedAt, performanceValueJmd, orderKind, voidedAt: null,
  });
  const orders = [
    quick("t1", null, 10_000),                                  // 待计入（未交单）
    quick("t1", "2026-08-15T10:00:00-05:00", 20_000),           // 8 月计入 t1
    quick("t2", "2026-09-02T10:00:00-05:00", 5_000),            // 9 月计入 t2
    quick(null, null, 7_000),                                    // 未派组，不计绩效
    quick("t1", "2026-08-20T10:00:00-05:00", 0, "aftersales"),  // 售后不计
    quick("t1", "2026-08-21T10:00:00-05:00", -20_000, "hedge"), // 对冲负值扣回
    { ...quick("t1", "2026-08-16T10:00:00-05:00", 88_000), voidedAt: "2026-08-18T09:00:00-05:00" }, // 废除单：全部无效，不参与
  ];

  const august = summarizeQuickOrderPerformance(orders, "2026-08");
  expect(august.counted).toEqual({ orderCount: 2, totalValueJmd: 0 }); // 20_000 − 20_000 对冲
  expect(august.pending).toEqual({ orderCount: 1, totalValueJmd: 10_000 });
  expect(august.byTeam.find((team) => team.teamId === "t1")).toMatchObject({
    countedOrderCount: 2, countedValueJmd: 0, pendingOrderCount: 1, pendingValueJmd: 10_000,
  });
  expect(august.byTeam.find((team) => team.teamId === "t2")).toMatchObject({
    countedOrderCount: 0, countedValueJmd: 0, pendingOrderCount: 0, pendingValueJmd: 0,
  });

  const september = summarizeQuickOrderPerformance(orders, "2026-09");
  expect(september.counted).toEqual({ orderCount: 1, totalValueJmd: 5_000 });
  expect(september.pending).toEqual({ orderCount: 1, totalValueJmd: 10_000 });

  expect(() => summarizeQuickOrderPerformance(orders, "2026-8")).toThrow();
  expect(() => summarizeQuickOrderPerformance(orders, "")).toThrow();
});
