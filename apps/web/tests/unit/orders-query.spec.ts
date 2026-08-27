import { expect, test } from "@playwright/test";
import { queryOrders } from "../../src/lib/orders/query";
import { ORDER_DEMO_SEED, ORDER_DEMO_SEED_META } from "../../src/lib/orders/seed";
import type { OrderRecord } from "../../src/lib/orders/types";

function order(id: string, overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id,
    orderNo: `WO-${id}`,
    createdAt: "2026-08-08T08:00:00-05:00",
    updatedAt: "2026-08-08T12:00:00-05:00",
    updatedBy: "王建华",
    customer: { id: `customer-${id}`, nameZh: `客户${id}`, phone: `876-555-${id}` },
    vehicle: { id: `vehicle-${id}`, plate: `PLATE-${id}` },
    laborItems: [{ id: `labor-${id}`, name: "基础检测", amountJmd: 100 }],
    partItems: [],
    parkingFeeJmd: 0,
    payments: [],
    refunds: [],
    mechanics: [],
    ...overrides,
  };
}

test("默认 business/open，按 updatedAt 再 createdAt 倒序并支持分页", () => {
  const records = [
    order("a", {
      createdAt: "2026-08-08T08:00:00-05:00",
      updatedAt: "2026-08-08T12:00:00-05:00",
    }),
    order("b", {
      createdAt: "2026-08-08T07:00:00-05:00",
      updatedAt: "2026-08-08T13:00:00-05:00",
    }),
    order("c", {
      createdAt: "2026-08-08T09:00:00-05:00",
      updatedAt: "2026-08-08T12:00:00-05:00",
    }),
    order("completed", {
      laborItems: [{ id: "labor-completed", name: "完工检测", amountJmd: 100 }],
      payments: [{ id: "payment-completed", amountJmd: 100 }],
      submittedAt: "2026-08-08T13:00:00-05:00",
      pickedUpAt: "2026-08-08T14:00:00-05:00",
    }),
  ];

  const firstPage = queryOrders(records, { pageSize: 2 });
  const secondPage = queryOrders(records, { page: 2, pageSize: 2 });

  expect(firstPage).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  expect(firstPage.items.map((item) => item.id)).toEqual(["b", "c"]);
  expect(secondPage.items.map((item) => item.id)).toEqual(["a"]);
  expect(firstPage.items.every((item) => item.lifecycle === "open")).toBe(true);
});

test("搜索覆盖单号、客户中英名、电话、车牌、车型和工时配件项目", () => {
  const target = order("target", {
    orderNo: "WH-2026-0888",
    customer: {
      id: "customer-target",
      nameZh: "陈美玲",
      nameEn: "Meiling Chen",
      phone: "+1 (876) 555-0188",
    },
    vehicle: {
      id: "vehicle-target",
      plate: "8765 JZ",
      modelZh: "丰田海狮",
      modelEn: "Toyota Hiace",
    },
    laborItems: [{ id: "labor-target", name: "变速箱深度检测", amountJmd: 500 }],
    partItems: [{ id: "part-target", name: "自动变速箱油", amountJmd: 400 }],
  });
  const records = [target, order("other")];

  for (const term of [
    "0888", "陈美玲", "MEILING chen", "555-0188", "18765550188",
    "8765 jz", "8765JZ",
    "丰田海狮", "toyota hiace", "深度检测", "自动变速箱油",
  ]) {
    expect(queryOrders(records, { search: term }).items.map((item) => item.id), term)
      .toEqual(["target"]);
  }
});

test("生命周期、派生状态和班组筛选可组合", () => {
  const records = [
    order("awaiting", { teamId: "t1" }),
    order("working", {
      teamId: "t1",
      acceptedAt: "2026-08-08T09:00:00-05:00",
    }),
    order("returned", {
      teamId: "t2",
      acceptedAt: "2026-08-08T09:00:00-05:00",
      returnedAt: "2026-08-08T10:00:00-05:00",
    }),
    order("completed", {
      teamId: "t2",
      laborItems: [{ id: "labor-completed", name: "完工检测", amountJmd: 100 }],
      payments: [{ id: "payment-completed", amountJmd: 100 }],
      submittedAt: "2026-08-08T13:00:00-05:00",
      pickedUpAt: "2026-08-08T14:00:00-05:00",
    }),
  ];

  expect(queryOrders(records, {
    lifecycle: "open",
    status: "in_progress",
    teamId: "t1",
  }).items.map((item) => item.id)).toEqual(["working"]);
  expect(queryOrders(records, { lifecycle: "completed" }).items.map((item) => item.id))
    .toEqual(["completed"]);
  expect(new Set(queryOrders(records, { lifecycle: "all", teamId: "t2" }).items.map((item) => item.id)))
    .toEqual(new Set(["completed", "returned"]));
});

test("固定四组大数只计算待接单和正在办理，不包含回单待前台", () => {
  const response = queryOrders([
    order("awaiting", { teamId: "t1" }),
    order("working", { teamId: "t1", acceptedAt: "2026-08-08T09:00:00-05:00" }),
    order("returned", {
      teamId: "t1",
      acceptedAt: "2026-08-08T09:00:00-05:00",
      returnedAt: "2026-08-08T10:00:00-05:00",
    }),
    order("t3-working", { teamId: "t3", acceptedAt: "2026-08-08T09:00:00-05:00" }),
  ]);

  expect(response.teams).toEqual([
    {
      id: "t1",
      name: "车间一组",
      activeCount: 2,
      awaitingAcceptanceCount: 1,
      inProgressCount: 1,
      returnedAwaitingFrontdeskCount: 1,
      openCount: 3,
    },
    {
      id: "t2",
      name: "车间二组",
      activeCount: 0,
      awaitingAcceptanceCount: 0,
      inProgressCount: 0,
      returnedAwaitingFrontdeskCount: 0,
      openCount: 0,
    },
    {
      id: "t3",
      name: "工程机械组",
      activeCount: 1,
      awaitingAcceptanceCount: 0,
      inProgressCount: 1,
      returnedAwaitingFrontdeskCount: 0,
      openCount: 1,
    },
    {
      id: "t4",
      name: "钣金喷漆组",
      activeCount: 0,
      awaitingAcceptanceCount: 0,
      inProgressCount: 0,
      returnedAwaitingFrontdeskCount: 0,
      openCount: 0,
    },
  ]);
});

test("查询边界拒绝非 business、非法生命周期及非法分页", () => {
  expect(() => queryOrders([], { scope: "quote" as never })).toThrow(/仅支持 business/);
  expect(() => queryOrders([], { lifecycle: "archived" as never })).toThrow(/生命周期无效/);
  expect(() => queryOrders([], { page: 0 })).toThrow(/页码/);
  expect(() => queryOrders([], { pageSize: 500 })).not.toThrow();
  expect(() => queryOrders([], { pageSize: 501 })).toThrow(/每页数量/);
});

test("canonical seed 覆盖五种 BO 状态与固定四组，取车事实不冒充 BO 状态", () => {
  const response = queryOrders(ORDER_DEMO_SEED, { lifecycle: "all", pageSize: 500 });
  expect(new Set(response.items.map((item) => item.processingStatus))).toEqual(new Set([
    "awaiting_dispatch",
    "awaiting_acceptance",
    "in_progress",
    "returned_awaiting_frontdesk",
    "submitted_awaiting_collection",
  ]));
  expect(ORDER_DEMO_SEED.filter((item) => item.pickedUpAt).every(
    (item) => response.items.find((candidate) => candidate.id === item.id)?.processingStatus
      === "submitted_awaiting_collection",
  )).toBe(true);
  expect(new Set(ORDER_DEMO_SEED.flatMap((item) => item.teamId ? [item.teamId] : [])))
    .toEqual(new Set(["t1", "t2", "t3", "t4"]));
  expect(ORDER_DEMO_SEED_META).toEqual({
    id: "orders-demo-v1",
    kind: "canonical_catalog",
    dashboardReconciled: false,
  });
  expect(ORDER_DEMO_SEED).toHaveLength(300);
});

test("demo 业务单全部带有正式检查报告来源并保留到查询结果", () => {
  const response = queryOrders(ORDER_DEMO_SEED, { lifecycle: "all", pageSize: 500 });
  const sources = response.items.map((item) => item.sourceInspection);

  expect(sources).toHaveLength(ORDER_DEMO_SEED.length);
  expect(sources.every(Boolean)).toBe(true);
  for (const source of sources) {
    expect(source?.reportNo).toMatch(/^KGN-WH-IR-\d{13}$/);
    expect(["V1", "V2", "V3"]).toContain(source?.version);
    expect(["t1", "t2", "t3", "t4"]).toContain(source?.inspectorTeamId);
  }
});
