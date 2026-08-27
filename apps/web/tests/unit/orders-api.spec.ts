import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";
import {
  createMockLinkedOperationsStore,
  dedupeCanonicalVehicleSnapshots,
  LINKED_OPERATIONS_STORAGE_KEY,
  LinkedStateInvariantError,
  validateLinkedOperationsState,
} from "../../src/lib/api/mock-orders";
import { buildOrdersOperationsOverview } from "../../src/lib/orders/operations-overview";
import { CANONICAL_OPERATIONS } from "../../src/lib/customers/canonical-identities";

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const browserStorageByValues = new WeakMap<Map<string, string>, MemoryStorage>();

function installBrowser(
  session: unknown = null,
  scenario?: unknown,
  values = new Map<string, string>(),
): () => void {
  if (session !== null) values.set("wh_session", JSON.stringify(session));
  const storage: MemoryStorage = browserStorageByValues.get(values) ?? {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  browserStorageByValues.set(values, storage);
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

test("工单 API 默认读取 business/open，并返回分页和固定四组摘要", async () => {
  const restore = installBrowser(superadmin);
  try {
    const response = await api.orders.list();
    expect(response.page).toBe(1);
    expect(response.pageSize).toBe(20);
    expect(response.total).toBe(89);
    expect(response.totalPages).toBe(5);
    expect(response.items.every((item) => item.lifecycle === "open")).toBe(true);
    expect(response.teams.map(({ id, name, activeCount }) => ({ id, name, activeCount }))).toEqual([
      { id: "t1", name: "车间一组", activeCount: 17 },
      { id: "t2", name: "车间二组", activeCount: 33 },
      { id: "t3", name: "工程机械组", activeCount: 35 },
      { id: "t4", name: "钣金喷漆组", activeCount: 1 },
    ]);
    const pageTwo = await api.orders.list({ page: 2, pageSize: 20 });
    expect(pageTwo.items).toHaveLength(20);
    const firstPageIds = new Set(response.items.map((item) => item.id));
    expect(pageTwo.items.some((item) => firstPageIds.has(item.id))).toBe(false);
    expect(response.items[0]?.id).toBe("order-demo-293");
    expect(response.items.at(-1)?.id).toBe("order-demo-238");
    expect(pageTwo.items[0]?.id).toBe("order-demo-233");
    expect(pageTwo.items.at(-1)?.id).toBe("order-demo-165");
  } finally {
    restore();
  }
});

test("fresh linked state deduplicates canonical identity snapshots while preserving all documents", async () => {
  const store = createMockLinkedOperationsStore();
  const state = store.read((value) => value, "test.read");
  const customerIds = new Set(CANONICAL_OPERATIONS.map((item) => item.customerId));
  const vehicleIds = new Set(CANONICAL_OPERATIONS.map((item) => item.vehicleId));

  expect(state.customers.map((item) => item.id)).toHaveLength(customerIds.size);
  expect(new Set(state.customers.map((item) => item.id))).toEqual(customerIds);
  expect(state.vehicles.map((item) => item.id)).toHaveLength(vehicleIds.size);
  expect(new Set(state.vehicles.map((item) => item.id))).toEqual(vehicleIds);
  expect(state.customers.filter((item) => item.id === "CUST-UAT-001")).toHaveLength(1);
  expect(state.vehicles.filter((item) => item.id === "VEH-UAT-001")).toHaveLength(1);
  expect(state.orderRecords).toHaveLength(300);
  expect(state.businessOrders).toHaveLength(300);
  expect(state.invoices).toHaveLength(300);
  // 2026-08-20 老板重做检查结果演示数据：3 份（一单一个阶段）
  expect(state.inspectionReports).toHaveLength(3);
  expect(state.quotations).toHaveLength(3);
  expect(state.businessOrders.filter((item) => item.customerId === "CUST-UAT-001").map((item) => item.id))
    .toEqual(Array.from({ length: 14 }, (_, index) => `order-demo-${index + 11}`));
  expect(() => validateLinkedOperationsState(state)).not.toThrow();

  await expect(store.mutate((draft) => {
    const index = draft.businessOrders.findIndex((item) => item.id === "order-demo-03");
    const order = draft.businessOrders[index]!;
    draft.businessOrders[index] = {
      ...order,
      executionTeamId: "t2",
      items: structuredClone(order.items),
    };
    draft.revision += 1;
  }, { action: "test.write" })).resolves.toBeUndefined();
});

test("fresh parking facts derive canonical vehicle IDs from their linked orders", () => {
  const state = createMockLinkedOperationsStore().read((value) => value, "test.read");
  for (const [caseId, orderId] of [["PARK-001", "order-demo-03"], ["PARK-002", "order-demo-08"]] as const) {
    const parking = state.parkingCases.find((item) => item.id === caseId)!;
    const order = state.orderRecords.find((item) => item.id === orderId)!;
    expect(parking.vehicleId).toBe(order.vehicle.id);
    expect(state.vehicles.some((item) => item.id === parking.vehicleId)).toBe(true);
  }
});

test("start mileage records the deterministic accepted fact while planned BOs have none", () => {
  const state = createMockLinkedOperationsStore().read((value) => value, "test.read");
  expect((state.businessOrders.find((order) => order.id === "order-demo-24") as typeof state.businessOrders[number] & {
    startMileage?: unknown;
  } | undefined)?.startMileage).toEqual({
    status: "recorded",
    value: 84_200,
    unit: "km",
    recordedAt: state.orderRecords.find((order) => order.id === "order-demo-24")?.acceptedAt,
    recordedById: expect.any(String),
    recordedByName: expect.any(String),
  });
  const plannedOrder = state.businessOrders.find((order) => order.executionStatus === "planned");
  expect((plannedOrder as typeof plannedOrder & { startMileage?: unknown } | undefined)?.startMileage).toBeNull();
});

test("state validator rejects invalid or unknown start mileage facts", () => {
  const acceptedOrderId = "order-demo-24";
  const cases = [
    ["negative mileage", { value: -1 }, "BO_START_MILEAGE_VALUE", "$.businessOrders[23].startMileage.value"],
    ["invalid unit", { unit: "metre" }, "BO_START_MILEAGE_UNIT", "$.businessOrders[23].startMileage.unit"],
    ["mismatched recordedAt", { recordedAt: "2026-08-10T09:00:00-05:00" }, "BO_START_MILEAGE_RECORDED_AT", "$.businessOrders[23].startMileage.recordedAt"],
    ["missing recorder identity", { recordedById: "" }, "BO_START_MILEAGE_RECORDER", "$.businessOrders[23].startMileage.recordedById"],
    ["unknown status", { status: "fabricated" }, "BO_START_MILEAGE_KIND", "$.businessOrders[23].startMileage.status"],
  ] as const;
  for (const [_name, invalid, code, path] of cases) {
    const state = structuredClone(createMockLinkedOperationsStore().read((value) => value, "test.read"));
    const index = state.businessOrders.findIndex((order) => order.id === acceptedOrderId);
    const order = state.businessOrders[index]! as typeof state.businessOrders[number] & {
      startMileage?: Record<string, unknown>;
    };
    state.businessOrders[index] = {
      ...order,
      startMileage: {
        status: "recorded",
        value: 84_200,
        unit: "km",
        recordedAt: state.orderRecords.find((record) => record.id === acceptedOrderId)?.acceptedAt,
        recordedById: "emp-005",
        recordedByName: "维修工",
        ...invalid,
      },
    } as typeof state.businessOrders[number];
    expectInvariant(() => validateLinkedOperationsState(state), code, path);
  }
});

test("vehicle master snapshots dedupe by intrinsic facts while retaining canonical current owner", () => {
  const sharedHistoricalVehicle = {
    id: "VEH-UAT-003",
    plate: "9154 DZ",
    modelZh: undefined,
    modelEn: "BMW X5",
  };
  expect(dedupeCanonicalVehicleSnapshots([
    { ...sharedHistoricalVehicle, customerId: "CUST-UAT-003" },
    { ...sharedHistoricalVehicle, customerId: "CUST-UAT-001" },
  ])).toEqual([{
    ...sharedHistoricalVehicle,
    customerId: "CUST-UAT-002",
  }]);
  expect(() => dedupeCanonicalVehicleSnapshots([
    sharedHistoricalVehicle,
    { ...sharedHistoricalVehicle, plate: "tampered plate" },
  ])).toThrow("canonical identity snapshot conflict: VEH-UAT-003");
});

function expectInvariant(action: () => void, code: string, path: string): void {
  try {
    action();
    throw new Error("expected invariant failure");
  } catch (error) {
    expect(error).toBeInstanceOf(LinkedStateInvariantError);
    expect(error).toMatchObject({ code, path });
  }
}

test("state validator rejects a submitted Business Order without an assigned repair team", () => {
  const state = structuredClone(createMockLinkedOperationsStore().read((value) => value, "test.read"));
  const order = state.quickOrders[0]!;
  const submittedAt = "2026-08-24T10:00:00-05:00";
  state.quickOrders[0] = {
    ...order,
    status: "submitted",
    submittedAt,
    submittedBy: "超级管理员",
    statusHistory: [
      ...order.statusHistory,
      {
        id: `${order.id}-invalid-submission`,
        from: "returned",
        to: "submitted",
        by: "超级管理员",
        byRole: "frontdesk",
        at: submittedAt,
        roundNumber: 1,
        teamId: "t1",
        performanceValueJmd: order.performanceValueJmd,
      },
    ],
  };

  expectInvariant(
    () => validateLinkedOperationsState(state),
    "QUICK_BO_SUBMITTED_TEAM",
    "$.quickOrders[0].teamId",
  );
});

test("state validator rejects an order snapshot customer that disagrees with its BO", () => {
  const state = structuredClone(createMockLinkedOperationsStore().read((value) => value, "test.read"));
  state.orderRecords[0]!.customer.id = state.customers[1]!.id;
  expectInvariant(
    () => validateLinkedOperationsState(state),
    "ORDER_RECORD_BO_CUSTOMER_MATCH",
    "$.orderRecords[0].customer.id",
  );
});

test("state validator rejects a BO vehicle that disagrees with its order snapshot", () => {
  const state = structuredClone(createMockLinkedOperationsStore().read((value) => value, "test.read"));
  state.businessOrders[0] = { ...state.businessOrders[0]!, vehicleId: state.vehicles[1]!.id };
  expectInvariant(
    () => validateLinkedOperationsState(state),
    "BO_RECORD_VEHICLE_MATCH",
    "$.businessOrders[0].vehicleId",
  );
});

test("state validator rejects a parking vehicle that disagrees with its BO and order snapshot", () => {
  const state = structuredClone(createMockLinkedOperationsStore().read((value) => value, "test.read"));
  state.parkingCases[0] = { ...state.parkingCases[0]!, vehicleId: state.vehicles[0]!.id };
  expectInvariant(
    () => validateLinkedOperationsState(state),
    "PARKING_VEHICLE_ORDER_MATCH",
    "$.parkingCases[0].vehicleId",
  );
});

test("运营概览独立返回今日首次派检均衡、四组实时负载和完整流程数量", async () => {
  const restore = installBrowser(superadmin);
  try {
    const overview = await api.orders.operationsOverview();
    expect(overview.businessDate).toBe("2026-08-09");
    expect(overview.firstInspectionDistribution).toEqual({
      distinctOrdinaryVehicles: 0,
      t1: 0,
      t2: 0,
      difference: 0,
    });
    expect(overview.workloads.find(({ teamId }) => teamId === "t1")).toMatchObject({
      inspectionAwaiting: 0,
      inspectionInProgress: 0,
      repairAwaiting: 12,
      repairInProgress: 6,
      activeTotal: 18,
    });
    expect(overview.workloads.find(({ teamId }) => teamId === "t2")).toMatchObject({
      inspectionAwaiting: 0,
      inspectionInProgress: 0,
      repairAwaiting: 15,
      repairInProgress: 18,
      blocked: 0,
      activeTotal: 33,
    });
    expect(Object.keys(overview.processCounts)).toHaveLength(14);
    expect(overview.processCounts).toMatchObject({
      inspection_awaiting_dispatch: 0,
      inspection_awaiting_acceptance: 0,
      inspection_in_progress: 0,
      inspection_awaiting_frontdesk: 1,
      quote_awaiting_customer: 1,
      quote_accepted_awaiting_order: 1,
      repair_awaiting_dispatch: 1,
      repair_awaiting_acceptance: 46,
      repair_in_progress: 40,
      returned_awaiting_frontdesk: 1,
      awaiting_formal_handover: 1,
      submitted_awaiting_collection: 211,
      vehicle_collected: 0,
    });
    expect(Object.values(overview.processCounts).reduce((sum, count) => sum + count, 0)).toBe(303);

    await api.orders.list({ search: "不存在的车辆", teamId: "t4" });
    await expect(api.orders.operationsOverview()).resolves.toEqual(overview);
  } finally {
    restore();
  }
});

test("工单 API 编码并组合搜索、生命周期、状态、班组与分页参数", async () => {
  const restore = installBrowser(superadmin);
  try {
    await expect(api.orders.list({ search: "陈美玲" })).resolves.toMatchObject({
      total: 1,
      items: [{ id: "order-demo-01" }],
    });
    await expect(api.orders.list({
      lifecycle: "all",
      status: "returned_awaiting_frontdesk",
      teamId: "t4",
      search: "Michael Smith",
    })).resolves.toMatchObject({
      total: 1,
      items: [{ id: "order-demo-10", settlementStatus: "overpaid" }],
    });
    const completed = await api.orders.list({ lifecycle: "completed" });
    expect(completed.total).toBeGreaterThan(1);
    expect(completed.items.every((item) => item.lifecycle === "completed")).toBe(true);
    await expect(api.orders.list({ page: 2, pageSize: 3 })).resolves.toMatchObject({
      page: 2,
      pageSize: 3,
      total: 89,
      totalPages: 30,
    });
  } finally {
    restore();
  }
});

test("工单 API 路由边界拒绝非法筛选与分页参数", async () => {
  const restore = installBrowser(superadmin);
  try {
    for (const invalid of [
      { scope: "quote" },
      { lifecycle: "archived" },
      { status: "unknown" },
      { teamId: "t9" },
      { page: 0 },
      { pageSize: 501 },
    ]) {
      await expect(api.orders.list(invalid as never)).rejects.toMatchObject({ status: 400 });
    }
  } finally {
    restore();
  }
});

test("工单 API 复用 dashboard 可见边界：三种允许身份可读，无会话和 parts 被拒绝", async () => {
  test.setTimeout(15_000);
  for (const allowed of [superadmin, finance, frontdesk]) {
    const restore = installBrowser(allowed);
    try {
      await expect(api.orders.list({ pageSize: 1 })).resolves.toMatchObject({ pageSize: 1 });
      await expect(api.orders.operationsOverview()).resolves.toMatchObject({
        businessDate: "2026-08-09",
      });
    } finally {
      restore();
    }
  }

  for (const denied of [null, parts]) {
    const restore = installBrowser(denied);
    try {
      await expect(api.orders.list()).rejects.toThrow(/无权访问/);
      await expect(api.orders.operationsOverview()).rejects.toThrow(/无权访问/);
    } finally {
      restore();
    }
  }
});

test("正式交单前改组由 Mock API 原子记录，列表、负载和审计刷新后保持一致", async () => {
  const restore = installBrowser(superadmin);
  try {
    const before = await api.orders.operationsOverview();
    const beforeT1 = before.workloads.find(({ teamId }) => teamId === "t1")!;
    const beforeT2 = before.workloads.find(({ teamId }) => teamId === "t2")!;

    const audit = await api.orders.reassign({
      orderId: "order-demo-03",
      expectedFromTeamId: "t1",
      toTeamId: "t2",
      reason: "根据当前实时负载人工调整",
    });
    expect(audit).toMatchObject({
      orderId: "order-demo-03",
      orderNo: "KGN-WH-2026080919424",
      fromTeamId: "t1",
      toTeamId: "t2",
      reason: "根据当前实时负载人工调整",
      actor: { id: "emp-001", name: "LiJian" },
    });
    expect(Number.isNaN(Date.parse(audit.changedAt))).toBe(false);

    const afterList = await api.orders.list({ lifecycle: "all", pageSize: 50 });
    expect(afterList.items.find(({ id }) => id === "order-demo-03")?.teamId).toBe("t2");
    const afterOverview = await api.orders.operationsOverview();
    expect(afterOverview.workloads.find(({ teamId }) => teamId === "t1")?.activeTotal).toBe(beforeT1.activeTotal - 1);
    expect(afterOverview.workloads.find(({ teamId }) => teamId === "t2")?.activeTotal).toBe(beforeT2.activeTotal + 1);
    await expect(api.orders.reassignmentHistory()).resolves.toEqual([audit]);

    await expect(api.orders.reassign({
      orderId: "order-demo-05",
      expectedFromTeamId: "t2",
      toTeamId: "t1",
      reason: "正式交单后不应允许",
    })).rejects.toThrow(/正式交单后|不允许改组/);
  } finally {
    restore();
  }
});

test("财务可查询工单但不能冒充前台执行人工改组", async () => {
  const restore = installBrowser(finance);
  try {
    await expect(api.orders.list({ pageSize: 1 })).resolves.toMatchObject({ pageSize: 1 });
    await expect(api.orders.reassign({
      orderId: "order-demo-03",
      expectedFromTeamId: "t1",
      toTeamId: "t2",
      reason: "越权改组",
    })).rejects.toThrow(/无权|前台/);
    await expect(api.orders.reassignmentHistory()).resolves.toEqual([]);
  } finally {
    restore();
  }
});

test("待接维修单改组也同步移动实时负载，不能只更新列表", async () => {
  const restore = installBrowser(superadmin);
  try {
    const before = await api.orders.operationsOverview();
    const beforeT1 = before.workloads.find(({ teamId }) => teamId === "t1")!;
    const beforeT2 = before.workloads.find(({ teamId }) => teamId === "t2")!;
    const audit = await api.orders.reassign({
      orderId: "order-demo-02",
      expectedFromTeamId: "t1",
      toTeamId: "t2",
      reason: "二组当前可以接检查后维修",
    });
    expect(audit).toMatchObject({ fromTeamId: "t1", toTeamId: "t2" });
    const list = await api.orders.list({ lifecycle: "all", pageSize: 50 });
    expect(list.items.find(({ id }) => id === "order-demo-02")?.teamId).toBe("t2");
    const overview = await api.orders.operationsOverview();
    expect(overview.workloads.find(({ teamId }) => teamId === "t1")).toMatchObject({
      repairAwaiting: beforeT1.repairAwaiting - 1,
      activeTotal: beforeT1.activeTotal - 1,
    });
    expect(overview.workloads.find(({ teamId }) => teamId === "t2")).toMatchObject({
      repairAwaiting: beforeT2.repairAwaiting + 1,
      activeTotal: beforeT2.activeTotal + 1,
    });
  } finally {
    restore();
  }
});

test("旧页面携带的原班组已过期时拒绝覆盖新审计", async () => {
  const restore = installBrowser(superadmin);
  try {
    await api.orders.reassign({
      orderId: "order-demo-03",
      expectedFromTeamId: "t1",
      toTeamId: "t2",
      reason: "第一次改组",
    });
    await expect(api.orders.reassign({
      orderId: "order-demo-03",
      expectedFromTeamId: "t1",
      toTeamId: "t3",
      reason: "基于旧页面的并发改组",
    })).rejects.toThrow(/原班组已变化|重新打开/);
    const history = await api.orders.reassignmentHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromTeamId: "t1", toTeamId: "t2" });
  } finally {
    restore();
  }
});

test("业务单 namespace 返回 300 个 canonical Business Order，不混入 IR", async () => {
  const restore = installBrowser(superadmin);
  try {
    const business = await api.orders.list({ lifecycle: "all", page: 1, pageSize: 50 });
    expect(business.total).toBe(300);
    expect(business.items).toHaveLength(50);
    expect(business.items.every((item) => item.orderNo.startsWith("KGN-WH-20"))).toBe(true);
    expect(business.items.some((item) => item.orderNo.includes("-IR-"))).toBe(false);
  } finally {
    restore();
  }
});

test("改组只同步 live BO/current assignment，SourceProject 历史与 inspector 跨 reload 不变", async () => {
  const values = new Map<string, string>();
  let restore = installBrowser(superadmin, undefined, values);
  try {
    const before = await api.billing.businessOrder("order-demo-03");
    const beforeOverview = await api.orders.operationsOverview();
    const beforeRepairInProgress = beforeOverview.workloads.find((item) => item.teamId === "t2")!.repairInProgress;
    const inspectorTeams = before.businessOrder.items.map((item) => item.sourceProject.inspectorTeamId);
    const sourceExecutionTeams = before.businessOrder.items.map((item) => item.sourceProject.executionTeamId);
    await api.orders.reassign({
      orderId: before.businessOrder.id,
      expectedFromTeamId: "t1",
      toTeamId: "t2",
      reason: "跨界面一致性测试",
    });
    const [list, billing, overview] = await Promise.all([
      api.orders.list({ lifecycle: "all", pageSize: 50 }),
      api.billing.businessOrder("order-demo-03"),
      api.orders.operationsOverview(),
    ]);
    expect(list.items.find((item) => item.id === "order-demo-03")?.teamId).toBe("t2");
    expect(billing.businessOrder.executionTeamId).toBe("t2");
    expect(billing.businessOrder.items.map((item) => item.sourceProject.executionTeamId)).toEqual(sourceExecutionTeams);
    expect(billing.businessOrder.items.map((item) => item.sourceProject.inspectorTeamId)).toEqual(inspectorTeams);
    expect(overview.workloads.find((item) => item.teamId === "t2")?.repairInProgress).toBe(beforeRepairInProgress + 1);
    const persisted = JSON.parse(values.get(LINKED_OPERATIONS_STORAGE_KEY) ?? "null");
    expect(persisted.operationsAssignments.find((item: { documentId: string }) => item.documentId === "order-demo-03"))
      .toMatchObject({ kind: "repair", teamId: "t2", reassignmentHistory: [{ fromTeamId: "t1", toTeamId: "t2" }] });
  } finally {
    restore();
  }

  restore = installBrowser(superadmin, undefined, values);
  try {
    const reloaded = await api.billing.businessOrder("order-demo-03");
    expect(reloaded.businessOrder.executionTeamId).toBe("t2");
    expect(reloaded.businessOrder.items.map((item) => item.sourceProject.executionTeamId)).toEqual(["t1"]);
    expect((await api.orders.operationsOverview()).workloads.find((item) => item.teamId === "t2")?.repairInProgress).toBe(19);
  } finally {
    restore();
  }
});

test("运营 overview 独立投影全部 IR 与 BO，旧 SourceProject 链不再决定文档是否存在", async () => {
  const restore = installBrowser(superadmin);
  try {
    const state = createMockLinkedOperationsStore().read((value) => value);
    const overview = await api.orders.operationsOverview();
    const businessSources = new Map(state.businessOrders.map((order) => [order.id, order.vehicleId] as const));
    const allSources = new Map([
      ...state.inspectionReports.map((report) => [report.id, report.vehicleId] as const),
      ...businessSources,
    ]);
    // 旧 source graph 仍可读，但三份 IR 均作为自己的当前文档存在。
    expect(state.businessOrders.some((order) => order.items[0]?.sourceProject.inspectionReportId)).toBe(true);
    expect(state.operationsDocuments).toHaveLength(303);
    expect(state.operationsAssignments).toHaveLength(303);
    expect(new Set(state.operationsDocuments.map((document) => document.id)))
      .toEqual(new Set(allSources.keys()));
    for (const document of state.operationsDocuments) {
      expect(document.vehicleId).toBe(allSources.get(document.id));
    }
    for (const assignment of state.operationsAssignments) {
      expect(assignment.vehicleId).toBe(allSources.get(assignment.documentId));
      if (assignment.status !== "completed") {
        expect(state.operationsDocuments.some((document) => document.id === assignment.documentId)).toBe(true);
      }
    }
    expect(overview.firstInspectionDistribution).toEqual({
      distinctOrdinaryVehicles: 0,
      t1: 0,
      t2: 0,
      difference: 0,
    });
    expect(Object.values(overview.processCounts).reduce((sum, count) => sum + count, 0)).toBe(303);
    for (const [stage, count] of Object.entries(overview.processCounts)) {
      expect(state.operationsDocuments.filter((document) => document.stage === stage)).toHaveLength(count);
    }
  } finally {
    restore();
  }
});

test("未转换 active IR 的 stage、inspection workload 与 activeTotal 必须守恒", async () => {
  // 2026-08-20 演示数据：active 检查结果文档是 demo-03（待前台审核）；把它推进到 inspection_in_progress 验证守恒
  const store = createMockLinkedOperationsStore();
  const state = store.read((value) => value);
  const docIndex = state.operationsDocuments.findIndex((document) => (
    document.id === "inspection-report-demo-03"
  ));
  expect(docIndex).toBeGreaterThanOrEqual(0);
  const documents = state.operationsDocuments.map((document, index) => (
    index === docIndex ? { ...document, stage: "inspection_in_progress" as const } : document
  ));
  const assignments = state.operationsAssignments.map((assignment) => (
    assignment.documentId === "inspection-report-demo-03"
      ? { ...assignment, kind: "inspection" as const, status: "in_progress" as const }
      : assignment
  ));

  const overview = buildOrdersOperationsOverview(
    documents,
    assignments,
    "2026-08-09",
  );
  expect(overview.processCounts.inspection_in_progress).toBe(1);
  const t3 = overview.workloads.find((workload) => workload.teamId === "t3")!;
  expect(t3).toMatchObject({
    inspectionInProgress: 1,
  });
  expect(t3.activeTotal).toBe(
    t3.inspectionAwaiting + t3.inspectionInProgress + t3.repairAwaiting + t3.repairInProgress + t3.blocked,
  );
});

test("独立 IR→QT version item→BO source link 链逐层归属同一来源", () => {
  const state = createMockLinkedOperationsStore().read((value) => value);
  for (const order of state.businessOrders) {
    for (const item of order.items) {
      const link = item.sourceProject;
      const reportItem = state.inspectionItems.find((candidate) => candidate.id === link.inspectionItemId);
      const quotation = state.quotations.find((candidate) => candidate.id === link.quotationId);
      const version = quotation?.versions.find((candidate) => candidate.id === link.quotationVersionId);
      const quotationItem = state.quotationItems.find((candidate) => candidate.id === link.quotationItemId);
      expect(reportItem?.inspectionReportId).toBe(link.inspectionReportId);
      expect(quotation?.inspectionReportId).toBe(link.inspectionReportId);
      expect(version?.quotationItemIds).toContain(link.quotationItemId);
      expect(quotationItem?.sourceInspectionItemId).toBe(link.inspectionItemId);
      expect(link.businessOrderId).toBe(order.id);
    }
  }
});

test("工单错误保留 404/409/503 状态，scoped overview 故障不被 orders list 提前消费", async () => {
  const restore = installBrowser(superadmin, {
    failNext: { byAction: { "orders.overview.read": "可重试 overview 读取故障" } },
  });
  try {
    await expect(api.orders.list()).resolves.toBeTruthy();
    await expect(api.orders.operationsOverview()).rejects.toMatchObject({ status: 503 });
    await expect(api.orders.operationsOverview()).resolves.toBeTruthy();
    await expect(api.orders.reassign({
      orderId: "order-missing",
      expectedFromTeamId: "t1",
      toTeamId: "t2",
      reason: "不存在案件",
    })).rejects.toMatchObject({ status: 404 });
    await api.orders.reassign({
      orderId: "order-demo-03",
      expectedFromTeamId: "t1",
      toTeamId: "t2",
      reason: "首次改组",
    });
    await expect(api.orders.reassign({
      orderId: "order-demo-03",
      expectedFromTeamId: "t1",
      toTeamId: "t3",
      reason: "旧版本改组",
    })).rejects.toMatchObject({ status: 409 });
  } finally {
    restore();
  }
});
