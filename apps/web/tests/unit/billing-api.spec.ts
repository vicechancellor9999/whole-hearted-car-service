import { expect, test } from "@playwright/test";
import { api, ApiError, linkedApiError } from "../../src/lib/api/client";
import {
  createLinkedOperationsMutationCoordinator,
  createMockLinkedOperationsStore,
  getMockLinkedOperationsStore,
  LINKED_OPERATIONS_STORAGE_KEY,
  LinkedApiDomainError,
  validateLinkedOperationsState,
  type AdministratorSignatureEvidence,
  type LinkedOperationsState,
} from "../../src/lib/api/mock-orders";
import { recordMockInspectionCustomerResponse } from "../../src/lib/api/mock-inspection-reports";
import { isSharedChargeInvoice, type Invoice, type LegacyInvoice } from "../../src/lib/billing/types";
import { signMockCreditInvoice } from "../../src/lib/api/mock-billing";

function memoryStorage(
  values = new Map<string, string>(),
  shouldFailWrite: () => boolean = () => false,
  removeCalls?: string[],
): Storage {
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { removeCalls?.push(key); values.delete(key); },
    setItem: (key, value) => {
      if (shouldFailWrite()) throw new Error("真实 storage 写入失败");
      values.set(key, value);
    },
  };
}

const browserStorageByValues = new WeakMap<Map<string, string>, {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}>();

function installBrowser(
  session: unknown = null,
  scenario?: unknown,
  values = new Map<string, string>(),
): () => void {
  if (session !== null) values.set("wh_session", JSON.stringify(session));
  const storage = browserStorageByValues.get(values) ?? {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  browserStorageByValues.set(values, storage);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  return () => descriptor
    ? Object.defineProperty(globalThis, "window", descriptor)
    : void Reflect.deleteProperty(globalThis, "window");
}

const session = (id: string, role: string, name = "测试用户") => ({ identity: { id, role, name } });
const superadmin = session("emp-001", "superadmin", "LiJian");
const frontdesk = session("emp-003", "frontdesk_admin", "前台");
const finance = session("emp-002", "finance", "财务");

function legacyInvoice(invoice: Invoice): LegacyInvoice {
  if (isSharedChargeInvoice(invoice)) throw new Error("expected a seeded legacy Invoice");
  return invoice;
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

function administratorEvidence(input: {
  administratorId?: string;
  action: "parking_waiver" | "special_release";
  subjectId: string;
  sourceRevision: number;
  amountJmd: number;
  reason: string;
  signedAt?: string;
  payloadHash?: string;
}): AdministratorSignatureEvidence {
  const administratorId = input.administratorId ?? "emp-001";
  const signedAt = input.signedAt ?? "2026-08-10T12:00:00-05:00";
  const expectedHash = [
    "bound", input.action, administratorId, input.subjectId,
    input.sourceRevision, input.amountJmd, encodeURIComponent(input.reason), signedAt,
  ].join(":");
  return {
    signatureId: `signature-${input.action}-${input.subjectId}`,
    signatureHash: `sha256-${input.action}-${input.subjectId}`,
    blobRef: `mock-signatures/${input.action}/${input.subjectId}`,
    administratorId,
    action: input.action,
    subjectId: input.subjectId,
    sourceRevision: input.sourceRevision,
    amountJmd: input.amountJmd,
    reason: input.reason,
    signedAt,
    payloadHash: input.payloadHash ?? expectedHash,
  };
}

test("收费工作区和 BO 详情引用同一 Invoice/parking 来源且净额只计一次", async () => {
  const restore = installBrowser(superadmin);
  try {
    const workspace = await api.billing.workspace();
    expect(workspace.items).toHaveLength(300);
    const row = workspace.items.find((item) => item.orderId === "order-demo-03");
    const detail = await api.billing.businessOrder("order-demo-03");
    expect(row?.invoiceId).toBe(detail.invoice.id);
    expect(detail.invoice.businessOrderId).toBe(detail.businessOrder.id);
    const parkingLines = detail.invoice.version.lines.filter((line) => line.code === "parking_overtime");
    expect(parkingLines).toHaveLength(1);
    expect(parkingLines[0].sourceId).toBe(detail.parking?.caseId);
    expect(parkingLines[0].quantity * parkingLines[0].unitPriceJmd).toBe(detail.parking?.finalAmountJmd);
    expect(detail.payment.paymentStatus).toBe(row?.paymentStatus);
    expect(detail.release.status).not.toBe(detail.payment.paymentStatus);
  } finally {
    restore();
  }
});

test("挂账签名绑定 invoice/version/balance/edition/file/customer/payer/signature 并持久化", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const before = await api.billing.businessOrder("order-demo-01");
    const acknowledgement = await api.billing.signCreditInvoice({
      invoiceId: before.invoice.id,
      expectedRevision: before.revision,
      invoiceVersionId: before.invoice.version.id,
      balanceJmd: before.payment.balanceJmd,
      documentEdition: "bilingual",
      fileHash: before.invoice.version.fileHash,
      customerId: before.businessOrder.customerId,
      payerId: before.businessOrder.customerId,
      customerSignerId: "customer-signer-01",
      signatureEvidence: {
        signatureId: "signature-customer-01",
        signatureHash: "sha256-customer-01",
        blobRef: "mock-signatures/customer-01",
      },
    });
    expect(acknowledgement).toMatchObject({
      invoiceId: before.invoice.id,
      invoiceVersionId: before.invoice.version.id,
      balanceJmd: before.payment.balanceJmd,
      documentEdition: "bilingual",
      fileHash: before.invoice.version.fileHash,
      customerId: before.businessOrder.customerId,
      payerId: before.businessOrder.customerId,
    });
    expect((await api.billing.businessOrder(before.businessOrder.id)).acknowledgements).toContainEqual(acknowledgement);
  } finally {
    restore();
  }
});

test("特殊协商必须有完整现场授权且保持 Invoice 未付状态，失败不半写", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const before = await api.billing.businessOrder("order-demo-02");
    const unsigned = {
      orderId: before.businessOrder.id,
      invoiceId: before.invoice.id,
      expectedRevision: before.revision,
      expectedInvoiceVersionId: before.invoice.version.id,
      expectedBalanceJmd: before.payment.balanceJmd,
      reason: "客户承诺次日转账",
      expectedPaymentDate: "2026-08-11",
      administratorId: "emp-001",
      customerConfirmation: "customer-confirmation-02",
    };
    await expect(api.billing.authorizeSpecialRelease(unsigned as never)).rejects.toThrow(/签名|证据/);
    expect((await api.billing.businessOrder(before.businessOrder.id)).release.status).toBe("not_authorized");

    const authorization = await api.billing.authorizeSpecialRelease({
      ...unsigned,
      administratorSignature: administratorEvidence({
        action: "special_release",
        subjectId: before.businessOrder.id,
        sourceRevision: before.revision,
        amountJmd: before.payment.balanceJmd,
        reason: unsigned.reason,
      }),
    });
    const after = await api.billing.businessOrder(before.businessOrder.id);
    expect(authorization).toMatchObject({ balanceJmd: before.payment.balanceJmd, reason: unsigned.reason });
    expect(after.payment).toEqual(before.payment);
    expect(after.invoice.settlementArrangement).toBe("special_agreement");
    expect(after.release).toMatchObject({ status: "authorized", specialAgreementAuthorizationId: authorization.id });
  } finally {
    restore();
  }
});

test("returned 的 order-demo-04 特殊放车后 doc/assignment/workload 同步且保留改组历史并可 reload", async () => {
  const values = new Map<string, string>();
  const scenario = { nowMs: Date.parse("2026-08-10T12:00:00-05:00") };
  let restore = installBrowser(superadmin, scenario, values);
  try {
    await api.orders.reassign({
      orderId: "order-demo-04",
      expectedFromTeamId: "t1",
      toTeamId: "t2",
      reason: "放车前调整责任班组",
    });
    const before = await api.billing.businessOrder("order-demo-04");
    const beforeOverview = await api.orders.operationsOverview();
    const beforeState = JSON.parse(values.get(LINKED_OPERATIONS_STORAGE_KEY) ?? "null");
    const beforeAssignment = beforeState.operationsAssignments.find((item: { documentId: string }) => (
      item.documentId === "order-demo-04"
    ));
    expect(beforeState.operationsDocuments.find((item: { id: string }) => item.id === "order-demo-04")?.stage)
      .toBe("returned_awaiting_frontdesk");
    expect(beforeAssignment).toMatchObject({
      teamId: "t2",
      status: "returned",
      firstAssignedTeamId: "t1",
      reassignmentHistory: [{ fromTeamId: "t1", toTeamId: "t2" }],
    });
    expect(beforeOverview.workloads.find((item) => item.teamId === "t2")?.returnedAwaitingFrontdesk).toBe(1);

    await api.billing.authorizeSpecialRelease({
      orderId: before.businessOrder.id,
      invoiceId: before.invoice.id,
      expectedRevision: before.revision,
      expectedInvoiceVersionId: before.invoice.version.id,
      expectedBalanceJmd: before.payment.balanceJmd,
      reason: "客户承诺次日结清",
      expectedPaymentDate: "2026-08-11",
      administratorId: "emp-001",
      administratorSignature: administratorEvidence({
        action: "special_release",
        subjectId: before.businessOrder.id,
        sourceRevision: before.revision,
        amountJmd: before.payment.balanceJmd,
        reason: "客户承诺次日结清",
      }),
      customerConfirmation: "客户现场确认",
    });

    const afterOverview = await api.orders.operationsOverview();
    const afterState = JSON.parse(values.get(LINKED_OPERATIONS_STORAGE_KEY) ?? "null");
    const afterAssignment = afterState.operationsAssignments.find((item: { documentId: string }) => (
      item.documentId === "order-demo-04"
    ));
    expect(afterState.operationsDocuments.find((item: { id: string }) => item.id === "order-demo-04")?.stage)
      .toBe("awaiting_formal_handover");
    expect(afterAssignment).toMatchObject({
      teamId: "t2",
      status: "completed",
      firstAssignedTeamId: beforeAssignment.firstAssignedTeamId,
      firstAssignedAt: beforeAssignment.firstAssignedAt,
      assignedAt: beforeAssignment.assignedAt,
      reassignmentHistory: beforeAssignment.reassignmentHistory,
    });
    expect(afterOverview.workloads.find((item) => item.teamId === "t2")?.returnedAwaitingFrontdesk).toBe(0);
    expect(afterOverview.workloads.map((item) => item.activeTotal))
      .toEqual(beforeOverview.workloads.map((item) => item.activeTotal));
    expect(afterOverview.processCounts.returned_awaiting_frontdesk)
      .toBe(beforeOverview.processCounts.returned_awaiting_frontdesk - 1);
    expect(afterOverview.processCounts.awaiting_formal_handover)
      .toBe(beforeOverview.processCounts.awaiting_formal_handover + 1);
  } finally {
    restore();
  }

  restore = installBrowser(superadmin, scenario, values);
  try {
    const reloadedOverview = await api.orders.operationsOverview();
    const reloadedState = JSON.parse(values.get(LINKED_OPERATIONS_STORAGE_KEY) ?? "null");
    expect(reloadedState.operationsAssignments.find((item: { documentId: string }) => (
      item.documentId === "order-demo-04"
    ))).toMatchObject({ teamId: "t2", status: "completed", reassignmentHistory: [{ toTeamId: "t2" }] });
    expect(reloadedOverview.workloads.find((item) => item.teamId === "t2")?.returnedAwaitingFrontdesk).toBe(0);
  } finally {
    restore();
  }
});

test("财务只读不能执行签账写入", async () => {
  const restore = installBrowser(finance);
  try {
    const before = await api.billing.businessOrder("order-demo-01");
    await expect(api.billing.signCreditInvoice({
      invoiceId: before.invoice.id,
      expectedRevision: before.revision,
      invoiceVersionId: before.invoice.version.id,
      balanceJmd: before.payment.balanceJmd,
      documentEdition: "zh",
      fileHash: before.invoice.version.fileHash,
      customerId: before.businessOrder.customerId,
      payerId: before.businessOrder.customerId,
      customerSignerId: "customer-signer",
      signatureEvidence: { signatureId: "s", signatureHash: "h", blobRef: "b" },
    })).rejects.toThrow(/无权|前台/);
    expect((await api.billing.businessOrder(before.businessOrder.id)).acknowledgements).toHaveLength(0);
  } finally {
    restore();
  }
});

test("canonical seeds 守恒且 IR/QT/BO/Invoice/parking 引用无悬空或重复 ID", async () => {
  test.setTimeout(15_000);
  const restore = installBrowser(superadmin);
  try {
    const [orders, firstReportPage, billing, parking] = await Promise.all([
      api.orders.list({ lifecycle: "all", pageSize: 500 }),
      api.inspectionReports.list({ page: 1, pageSize: 100 }),
      api.billing.workspace(),
      api.parking.list(),
    ]);
    const secondReportPage = await api.inspectionReports.list({ page: 2, pageSize: 100 });
    const reports = {
      ...firstReportPage,
      items: [...firstReportPage.items, ...secondReportPage.items],
    };
    expect(orders.total).toBe(300);
    // 检查结果演示数据（2026-08-20 老板重做：一单一个阶段）共 3 份
    expect(reports.total).toBe(3);
    expect(new Set(orders.items.map((item) => item.id)).size).toBe(300);
    expect(new Set(reports.items.map((item) => item.id)).size).toBe(3);
    expect(new Set(billing.items.map((item) => item.invoiceId)).size).toBe(billing.items.length);
    expect(new Set(parking.items.map((item) => item.caseId)).size).toBe(parking.items.length);

    const reportDetails = await Promise.all(reports.items.map((item) => api.inspectionReports.detail(item.id)));
    const reportIds = new Set(reportDetails.map((item) => item.id));
    const quotationIds = new Set(reportDetails.map((item) => item.quotation.id));
    expect(quotationIds.size).toBe(3);
    const orderIds = new Set(orders.items.map((item) => item.id));
    const invoiceIds = new Set(billing.items.map((item) => item.invoiceId));
    const canonical = getMockLinkedOperationsStore().read((state) => ({
      businessOrders: structuredClone(state.businessOrders),
      invoices: structuredClone(state.invoices),
      quickOrders: structuredClone(state.quickOrders),
    }));
    const businessOrderById = new Map(canonical.businessOrders.map((item) => [item.id, item]));
    const invoiceById = new Map(canonical.invoices.map((item) => [item.id, item]));
    const quickOrderIds = new Set(canonical.quickOrders.map((item) => item.id));
    const ownerIds = new Set([...orderIds, ...quickOrderIds]);
    for (const row of billing.items) {
      const businessOrder = businessOrderById.get(row.orderId);
      const invoice = invoiceById.get(row.invoiceId);
      expect(invoice).toBeTruthy();
      expect(invoiceIds.has(invoice!.id)).toBe(true);
      expect(invoice!.businessOrderId).toBe(row.orderId);
      if (businessOrder) {
        expect(orderIds.has(businessOrder.id)).toBe(true);
        for (const businessItem of businessOrder.items) {
          expect(reportIds.has(businessItem.sourceProject.inspectionReportId)).toBe(true);
          expect(quotationIds.has(businessItem.sourceProject.quotationId)).toBe(true);
        }
      } else {
        expect(quickOrderIds.has(row.orderId)).toBe(true);
      }
    }
    for (const parkingCase of parking.items) {
      expect(ownerIds.has(parkingCase.originBusinessOrderId)).toBe(true);
      for (const eligibleOrderId of parkingCase.eligibleBusinessOrderIds) {
        expect(ownerIds.has(eligibleOrderId)).toBe(true);
      }
      if (parkingCase.billing.status === "claimed") {
        expect(invoiceById.has(parkingCase.billing.invoiceId)).toBe(true);
      }
    }
  } finally {
    restore();
  }
});

test("成功 mutation 写入 canonical storage，重新载入后签账事实保持一致", async () => {
  const persisted = new Map<string, string>();
  let restore = installBrowser(frontdesk, undefined, persisted);
  let acknowledgementId = "";
  try {
    const before = await api.billing.businessOrder("order-demo-01");
    const acknowledgement = await api.billing.signCreditInvoice({
      invoiceId: before.invoice.id,
      expectedRevision: before.revision,
      invoiceVersionId: before.invoice.version.id,
      balanceJmd: before.payment.balanceJmd,
      documentEdition: "en",
      fileHash: before.invoice.version.fileHash,
      customerId: before.businessOrder.customerId,
      payerId: before.businessOrder.customerId,
      customerSignerId: "customer-signer-reload",
      signatureEvidence: {
        signatureId: "signature-customer-reload",
        signatureHash: "sha256-customer-reload",
        blobRef: "mock-signatures/customer-reload",
      },
    });
    acknowledgementId = acknowledgement.id;
  } finally {
    restore();
  }

  restore = installBrowser(frontdesk, undefined, persisted);
  try {
    const reloaded = await api.billing.businessOrder("order-demo-01");
    expect(reloaded.acknowledgements.map((item) => item.id)).toContain(acknowledgementId);
  } finally {
    restore();
  }
});

test("overpayment 不被截断，orders 与 billing 都保留完整净收款和负余额", async () => {
  const restore = installBrowser(superadmin);
  try {
    const row = (await api.orders.list({ lifecycle: "all", pageSize: 500 })).items
      .find((item) => item.id === "order-demo-10");
    const detail = await api.billing.businessOrder("order-demo-10");
    expect(row).toMatchObject({
      receivableJmd: 50_000,
      netPaidJmd: 55_000,
      balanceJmd: -5_000,
      settlementStatus: "overpaid",
    });
    expect(detail.payment).toMatchObject({
      paidJmd: 55_000,
      balanceJmd: -5_000,
      paymentStatus: "paid",
    });
    expect(detail.settlementStatus).toBe("overpaid");
  } finally {
    restore();
  }
});

test("两个独立 store 共享 storage 并发同 revision 写入时不丢更新", async () => {
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const storeA = createMockLinkedOperationsStore(storage);
  const storeB = createMockLinkedOperationsStore(storage);
  await storeA.ready();
  await storeB.ready();
  const expectedRevision = storeA.read((state) => state.revision);
  const append = (label: string) => (state: LinkedOperationsState) => {
    if (state.revision !== expectedRevision) throw Object.assign(new Error("版本冲突"), { status: 409 });
    state.communications.push({
      id: `concurrent-${label}`,
      reportId: "inspection-report-demo-01",
      contentKind: "report",
      channel: "sms",
      target: "+1 876-555-0101",
      delivery: "sent",
      response: "no_response",
      note: label,
      actorId: "emp-003",
      recordedAt: "2026-08-10T12:00:00-05:00",
    });
    state.revision += 1;
    return label;
  };

  const results = await Promise.allSettled([
    storeA.mutate(append("A")),
    storeB.mutate(append("B")),
  ]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
  const reloadedStore = createMockLinkedOperationsStore(storage);
  await reloadedStore.ready();
  const reloaded = reloadedStore.read((state) => state);
  expect(reloaded.communications.filter((item) => item.id.startsWith("concurrent-"))).toHaveLength(1);
  expect(reloaded.revision).toBe(expectedRevision + 1);
});

test("无 Web Locks 时两个独立 coordinator 均 503 fail-closed 且 mutation/storage 零变化", async () => {
  const storage = memoryStorage();
  const coordinatorA = createLinkedOperationsMutationCoordinator(storage, {
    lockManager: null,
  });
  const coordinatorB = createLinkedOperationsMutationCoordinator(storage, {
    lockManager: null,
  });
  let sharedValue = 0;
  const increment = (coordinator: typeof coordinatorA) => coordinator.runExclusive(async () => {
    sharedValue += 1;
  });

  const results = await Promise.allSettled([increment(coordinatorA), increment(coordinatorB)]);
  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" ? result.reason : undefined).toMatchObject({ status: 503 });
  }
  expect(sharedValue).toBe(0);
  expect(storage.length).toBe(0);
});

test("两个独立 coordinator 注入同一 Web Locks 时同名互斥、完整 await callback、异常释放且不创建 Storage lease", async () => {
  const storage = memoryStorage();
  const requestedNames: string[] = [];
  const events: string[] = [];
  let tail = Promise.resolve();
  const lockManager = {
    request: <T>(name: string, action: () => T | Promise<T>): Promise<T> => {
      requestedNames.push(name);
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      return previous.then(action).finally(release);
    },
  };
  const coordinatorA = createLinkedOperationsMutationCoordinator(storage, { lockManager });
  const coordinatorB = createLinkedOperationsMutationCoordinator(storage, { lockManager });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = coordinatorA.runExclusive(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    return "first";
  });
  const second = coordinatorB.runExclusive(async () => {
    events.push("second:start");
    throw new Error("second failed");
  });
  const third = coordinatorA.runExclusive(async () => {
    events.push("third:start");
    await delay(1);
    events.push("third:end");
    return "third";
  });
  await delay(1);
  expect(events).toEqual(["first:start"]);
  releaseFirst();
  await expect(first).resolves.toBe("first");
  await expect(second).rejects.toThrow("second failed");
  await expect(third).resolves.toBe("third");
  expect(events).toEqual(["first:start", "first:end", "second:start", "third:start", "third:end"]);
  expect(requestedNames).toEqual([
    "wh-linked-operations-v2",
    "wh-linked-operations-v2",
    "wh-linked-operations-v2",
  ]);
  expect(storage.length).toBe(0);
});

test("跨 namespace 独立 store 并发写只提交一个并保留 canonical storage", async () => {
  const storage = memoryStorage();
  const storeA = createMockLinkedOperationsStore(storage);
  const storeB = createMockLinkedOperationsStore(storage);
  await storeA.ready();
  await storeB.ready();
  const state = storeA.read((value) => value);
  const invoice = legacyInvoice(state.invoices.find((item) => item.id === "invoice-demo-01")!);
  const version = invoice.versions[0];
  const balanceJmd = version.totals.totalJmd;
  const responseCountBefore = state.responseEvents.length;
  const acknowledgementCountBefore = state.invoiceAcknowledgements.length;
  const mutationActor = { id: "emp-003", name: "王建华", role: "frontdesk_admin" as const };

  const results = await Promise.allSettled([
    Promise.resolve().then(() => recordMockInspectionCustomerResponse({
      reportId: "inspection-report-demo-01",
      expectedRevision: state.revision,
      mutationId: "billing-cross-namespace-response",
      result: "interested",
      note: "跨 namespace 并发回应",
    }, mutationActor, storeA)),
    Promise.resolve().then(() => signMockCreditInvoice({
      invoiceId: invoice.id,
      expectedRevision: state.revision,
      invoiceVersionId: version.id,
      balanceJmd,
      documentEdition: "zh",
      fileHash: state.invoiceFileHashes[version.id],
      customerId: "customer-demo-01",
      payerId: "customer-demo-01",
      customerSignerId: "customer-concurrent",
      signatureEvidence: {
        signatureId: "signature-concurrent",
        signatureHash: "sha256-concurrent",
        blobRef: "mock-signatures/concurrent",
      },
    }, "emp-003", storeB)),
  ]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
  const reloadedStore = createMockLinkedOperationsStore(storage);
  await reloadedStore.ready();
  const reloaded = reloadedStore.read((value) => value);
  expect(reloaded.revision).toBe(state.revision + 1);
  expect(
    (reloaded.responseEvents.length - responseCountBefore)
      + (reloaded.invoiceAcknowledgements.length - acknowledgementCountBefore),
  ).toBe(1);
  expect(() => validateLinkedOperationsState(reloaded)).not.toThrow();
});

test("真实 storage 写失败保持 cache/storage 原子且同 mutation 可重试", async () => {
  let failWrite = false;
  const values = new Map<string, string>();
  const storage = memoryStorage(values, () => failWrite);
  const store = createMockLinkedOperationsStore(storage);
  await store.ready();
  const before = store.read((state) => state.revision);
  const beforeRaw = values.get(LINKED_OPERATIONS_STORAGE_KEY);
  const mutation = (state: LinkedOperationsState) => {
    if (state.revision !== before) throw Object.assign(new Error("版本冲突"), { status: 409 });
    state.revision += 1;
    return state.revision;
  };
  failWrite = true;
  await expect(Promise.resolve().then(() => store.mutate(mutation))).rejects.toThrow(/storage 写入失败/);
  expect(store.read((state) => state.revision)).toBe(before);
  expect(values.get(LINKED_OPERATIONS_STORAGE_KEY)).toBe(beforeRaw);
  failWrite = false;
  await expect(store.mutate(mutation)).resolves.toBe(before + 1);
});

test("void mutation 返回 undefined 且只提交一次，caller 不会见到提交后异常", async () => {
  const storage = memoryStorage();
  const store = createMockLinkedOperationsStore(storage);
  await store.ready();
  const before = store.read((state) => state.revision);
  await expect(store.mutate((state) => {
    state.revision += 1;
  })).resolves.toBeUndefined();
  expect(store.read((state) => state.revision)).toBe(before + 1);
  const reloadedStore = createMockLinkedOperationsStore(storage);
  await reloadedStore.ready();
  expect(reloadedStore.read((state) => state.revision)).toBe(before + 1);
});

test("canonical seed 本身通过精确 invariant validator", async () => {
  const seedStore = createMockLinkedOperationsStore(memoryStorage());
  await seedStore.ready();
  const seed = seedStore.read((state) => state);
  expect(() => validateLinkedOperationsState(seed)).not.toThrow();
});

test("特殊放车现场签名拒绝非管理员、错动作和错 payload，失败不创建授权", async () => {
  test.setTimeout(15_000);
  const restore = installBrowser(frontdesk, { nowMs: Date.parse("2026-08-10T12:00:00-05:00") });
  try {
    const before = await api.billing.businessOrder("order-demo-02");
    const base = {
      orderId: before.businessOrder.id,
      invoiceId: before.invoice.id,
      expectedRevision: before.revision,
      expectedInvoiceVersionId: before.invoice.version.id,
      expectedBalanceJmd: before.payment.balanceJmd,
      reason: "客户承诺次日转账",
      expectedPaymentDate: "2026-08-11",
      administratorId: "emp-004",
      customerConfirmation: "customer-confirmation-02",
    };
    await expect(api.billing.authorizeSpecialRelease({
      ...base,
      administratorSignature: administratorEvidence({
        administratorId: "emp-004", action: "special_release", subjectId: before.businessOrder.id,
        sourceRevision: before.revision, amountJmd: before.payment.balanceJmd, reason: base.reason,
      }),
    })).rejects.toThrow(/管理员身份|无权签名/);
    await expect(api.billing.authorizeSpecialRelease({
      ...base,
      administratorId: "emp-001",
      administratorSignature: administratorEvidence({
        action: "parking_waiver", subjectId: before.businessOrder.id,
        sourceRevision: before.revision, amountJmd: before.payment.balanceJmd, reason: base.reason,
      }),
    })).rejects.toThrow(/动作|签名.*不一致/);
    await expect(api.billing.authorizeSpecialRelease({
      ...base,
      administratorId: "emp-001",
      administratorSignature: administratorEvidence({
        action: "special_release", subjectId: before.businessOrder.id,
        sourceRevision: before.revision, amountJmd: before.payment.balanceJmd,
        reason: base.reason, payloadHash: "wrong-payload",
      }),
    })).rejects.toThrow(/payload|签名.*不一致/);
    const after = await api.billing.businessOrder(before.businessOrder.id);
    expect(after.specialReleaseAuthorizations).toHaveLength(0);
    expect(after.release.status).toBe("not_authorized");
  } finally {
    restore();
  }
});

test("收费 API 保留 404/409/400/503，scoped detail 故障不被 workspace 消费", async () => {
  const restore = installBrowser(frontdesk, {
    failNext: { byAction: { "billing.businessOrder.read": "收费详情短暂读取故障" } },
  });
  try {
    await expect(api.billing.workspace()).resolves.toBeTruthy();
    await expect(api.billing.businessOrder("order-demo-01")).rejects.toMatchObject({
      status: 503,
      message: "Business Order 收费详情读取失败",
    });
    const before = await api.billing.businessOrder("order-demo-01");
    await expect(api.billing.signCreditInvoice({
      invoiceId: before.invoice.id,
      expectedRevision: before.revision - 1,
      invoiceVersionId: before.invoice.version.id,
      balanceJmd: before.payment.balanceJmd,
      documentEdition: "zh",
      fileHash: before.invoice.version.fileHash,
      customerId: before.businessOrder.customerId,
      payerId: before.businessOrder.customerId,
      customerSignerId: "customer-signer",
      signatureEvidence: { signatureId: "s", signatureHash: "h", blobRef: "b" },
    })).rejects.toMatchObject({ status: 409 });
    await expect(api.billing.businessOrder("order-missing")).rejects.toMatchObject({ status: 404 });

    const special = await api.billing.businessOrder("order-demo-02");
    await expect(api.billing.authorizeSpecialRelease({
      orderId: special.businessOrder.id,
      invoiceId: special.invoice.id,
      expectedRevision: special.revision,
      expectedInvoiceVersionId: special.invoice.version.id,
      expectedBalanceJmd: special.payment.balanceJmd,
      reason: "无效日期",
      expectedPaymentDate: "2026-02-31",
      administratorId: "emp-001",
      administratorSignature: administratorEvidence({
        action: "special_release",
        subjectId: special.businessOrder.id,
        sourceRevision: special.revision,
        amountJmd: special.payment.balanceJmd,
        reason: "无效日期",
      }),
      customerConfirmation: "confirmed",
    })).rejects.toMatchObject({ status: 400 });
  } finally {
    restore();
  }
});

test("linked API 5xx/未知异常固定安全文案且已知 4xx 保留业务信息", () => {
  const fallback = "收费操作失败";
  const invariant = linkedApiError(
    new LinkedApiDomainError("canonical invariant $.invoices[0].secretToken", 500),
    fallback,
  );
  expect(invariant).toMatchObject({ status: 500, message: fallback });
  expect(invariant.message).not.toMatch(/canonical|invariant|\$\.|secret/i);

  const storage = linkedApiError(
    new LinkedApiDomainError("storage failed with secret customer path", 503),
    fallback,
  );
  expect(storage).toMatchObject({ status: 503, message: fallback });
  expect(storage.message).not.toMatch(/storage|secret|path/i);

  const unknown = linkedApiError(new Error("unexpected implementation detail"), fallback);
  expect(unknown).toMatchObject({ status: 500, message: fallback });
  expect(unknown.message).not.toContain("implementation detail");

  const wrappedApiError = linkedApiError(
    new ApiError("storage invariant leaked from ApiError", 503),
    fallback,
  );
  expect(wrappedApiError).toMatchObject({ status: 503, message: fallback });
  expect(wrappedApiError.message).not.toMatch(/storage|invariant|leaked/i);

  expect(linkedApiError(new LinkedApiDomainError("版本已变化，请刷新", 409), fallback)).toMatchObject({
    status: 409,
    message: "版本已变化，请刷新",
  });
});

test("首次 linked store 构造的 storage 5xx 也必须经过路由固定安全文案", async () => {
  const values = new Map([["wh_session", JSON.stringify(superadmin)]]);
  const storage = memoryStorage(values);
  const read = storage.getItem.bind(storage);
  storage.getItem = (key) => {
    if (key === LINKED_OPERATIONS_STORAGE_KEY) {
      throw new Error("storage secret leaked from $.canonical.path");
    }
    return read(key);
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  try {
    const error = await api.billing.workspace().then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({ status: 503, message: "收费工作区读取失败" });
    expect((error as Error).message).not.toMatch(/storage|secret|canonical|path/i);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
