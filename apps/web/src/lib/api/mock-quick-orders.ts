/**
 * 快速工单 store 动作（schema v5）。
 * 状态机与规则见 src/lib/orders/quick-order-types.ts 头注（2026-08-16 老板口述）。
 */
import {
  QUICK_ORDER_SHARED_CHARGE_CONTRACT,
  isSharedChargeQuickOrder,
  legacyQuickOrderFinance,
  quickBoFlowIndex,
  quickOrderCanonicalChargeLines,
  quickOrderFinance,
  quickOrderTotals,
  QUICK_BO_MAIN_FLOW,
  type QuickBoStatus,
  type QuickBoStatusEvent,
  type QuickOrder,
  type QuickOrderChargeLine,
  type QuickOrderItem,
  type QuickOrderKind,
  type QuickPayment,
  type QuickPaymentReceiptChargeLine,
  type QuickPaymentReceiptHistoryEntry,
  type QuickPaymentReceiptSnapshot,
  type QuickPickupChannelRecord,
  type QuickRefund,
  type QuickRefundDocumentSnapshot,
  type QuickRefundEvidence,
  type QuickRefundOriginalDocumentStatus,
  type QuickRefundSignature,
  type QuickRefundMethod,
} from "../orders/quick-order-types";
import {
  calculateQuotedChargeTotals,
  validateQuotedChargeLine,
  type FixedTotalChargeLine,
  type UnitPricedChargeLine,
} from "../billing/quoted-charges";
import { previewOrdinaryLineRefund } from "../billing/refunds";
import {
  assertQuickOrderFinancialListResponse,
  assertQuickOrderFinancialReadModel,
  type QuickOrderFinancialGates,
  type QuickOrderFinancialLedger,
  type QuickOrderFinancialListResponse,
  type QuickOrderFinancialReadModel,
  type QuickOrderFinancialSource,
} from "../billing/quick-order-financial";
import {
  assertQuickOrderFinancialStatement,
  type QuickOrderFinancialStatement,
  type QuickOrderStatementCanonicalLine,
  type QuickOrderStatementEntry,
  type QuickOrderStatementSharedLine,
} from "../billing/quick-order-financial-statement";
import {
  assertQuickOrderFinancialLedgerResponse,
  type QuickOrderFinancialLedgerItem,
  type QuickOrderFinancialLedgerResponse,
} from "../billing/quick-order-financial-ledger";
import {
  QUICK_ORDER_LIFECYCLE_KIND_ORDER,
  assertQuickOrderLifecyclePreflight,
  assertQuickOrderLifecycleMutationInput,
  assertQuickOrderLifecycleMutationResult,
  type QuickOrderLifecycleKind,
  type QuickOrderLifecycleMutationInput,
  type QuickOrderLifecyclePreflight,
  type QuickOrderLifecycleMutationResult,
} from "../billing/quick-order-lifecycle";
import {
  isSharedChargeInvoice,
  isModernInvoicePaymentFact,
  type SharedChargeInvoice,
  type SharedChargeInvoiceVersion,
} from "../billing/types";
import {
  discountApprovalRequirement,
  discountSignatureStrokeDigest,
  validateDiscountApprovalEvidence,
  type DiscountApprovalEvidence,
} from "../billing/discount-approval";
import { businessDateInJamaica, formatBusinessOrderNo, jamaicaMonthKey } from "../orders/document-number";
import { methodIsKnown } from "../payments/method-dictionary";
import { calculateParkingAccrual } from "../parking/calculations";
import { teamById } from "../teams/team-dictionary";
import {
  canonicalBillingActorIdentity,
  billingSnapshotCommitment,
  deriveLinkedInvoiceFinancialSummary,
  getMockLinkedOperationsStore,
  isModernParkingSourceFact,
  isTask8ReservedChildMutationId,
  latestReceiptBackedQuickOrderVoidLifecycleFacts,
  LinkedApiDomainError,
  parkingSourceOriginCommitment,
  validateLinkedOperationsState,
  type LinkedParkingSourceCreationOrigin,
  type LinkedParkingInvoiceReprojectionAudit,
  type LinkedOperationsState,
  type MockLinkedOperationsStore,
} from "./mock-orders";
import { canonicalMockIdentitySnapshot } from "./mock-data";

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export function listMockQuickOrders(
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): QuickOrder[] {
  return store.read((state) => state.quickOrders.map(cloneOrder), "quickOrders.list.read");
}

export function getMockQuickOrder(
  orderId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): QuickOrder {
  return store.read((state) => {
    const order = state.quickOrders.find((item) => item.id === orderId);
    if (!order) throw new LinkedApiDomainError("工单不存在", 404);
    return cloneOrder(order);
  }, "quickOrders.detail.read");
}

export async function countMockQuickOrdersByTeam(
  teamId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<number> {
  await store.ready();
  return store.read(
    (state) => state.quickOrders.filter((order) => order.teamId === teamId).length,
    "quickOrders.teamUsage.read",
  );
}

/**
 * Replace the current team reference on every Quick BO before a dictionary
 * team is removed. Payment, Invoice and lifecycle facts are untouched; the
 * organizational transfer is appended to the BO content audit.
 */
export async function replaceMockQuickOrderTeam(
  fromTeamId: string,
  toTeamId: string,
  actorName = "超级管理员",
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<number> {
  if (!fromTeamId || !toTeamId || fromTeamId === toTeamId) throw new LinkedApiDomainError("继承班组无效", 400);
  const successor = teamById(toTeamId);
  if (!successor) throw new LinkedApiDomainError("继承班组不存在", 400);
  await store.ready();
  const recordedAt = new Date(store.nowMs()).toISOString();
  return store.mutate((state) => {
    let count = 0;
    for (const current of state.quickOrders) {
      if (current.teamId !== fromTeamId) continue;
      const order = MUTABLE(current);
      order.teamId = toTeamId;
      const editHistory = order.editHistory as QuickOrder["editHistory"][number][];
      editHistory.push({
        id: `${order.id}-edit-${editHistory.length + 1}`,
        by: actorName,
        at: recordedAt,
        note: `班组删除继承：${fromTeamId} → ${toTeamId}（${successor.name}）`,
      });
      count += 1;
    }
    if (count > 0) state.revision += 1;
    return count;
  }, { action: "quickOrders.teamReplacement.write" });
}

interface QuickOrderFinancialBase {
  readonly source: QuickOrderFinancialSource;
  readonly ledger: QuickOrderFinancialLedger;
  readonly canRefund: boolean;
}

const SHARED_INVOICE_VERSION_FIELDS = new Set([
  "id",
  "version",
  "chargeContract",
  "snapshot",
  "snapshotCommitment",
  "issuedAt",
]);

function assertClosedFinancialDataObject(
  value: unknown,
  fields: ReadonlySet<string>,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LinkedApiDomainError(`${label}必须为普通对象`, 409);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new LinkedApiDomainError(`${label}必须为普通对象`, 409);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.size) throw new LinkedApiDomainError(`${label}字段不闭合`, 409);
  for (const key of keys) {
    if (typeof key !== "string" || !fields.has(key)) {
      throw new LinkedApiDomainError(`${label}存在未知字段`, 409);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor) || descriptor.value === undefined) {
      throw new LinkedApiDomainError(`${label}.${key}必须为 own enumerable data field`, 409);
    }
  }
}

function financialSafeSum(values: ReadonlyArray<number>, label: string): number {
  let sum = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new LinkedApiDomainError(`${label}必须为非负安全整数`, 409);
    }
    sum += value;
    if (!Number.isSafeInteger(sum)) {
      throw new LinkedApiDomainError(`${label}超过安全整数范围`, 409);
    }
  }
  return sum;
}

function financialPaymentStatus(
  netPaidJmd: number,
  receivableJmd: number,
): QuickOrderFinancialLedger["paymentStatus"] {
  return netPaidJmd <= 0
    ? "unpaid"
    : netPaidJmd < receivableJmd
      ? "partially_paid"
      : "paid";
}

function financialSettlementStatus(
  balanceJmd: number,
): QuickOrderFinancialLedger["settlementStatus"] {
  return balanceJmd > 0 ? "due" : balanceJmd < 0 ? "overpaid" : "settled";
}

function financialOrderById(state: LinkedOperationsState, orderId: string): QuickOrder {
  const matches = state.quickOrders.filter((candidate) => candidate.id === orderId);
  if (matches.length === 0) throw new LinkedApiDomainError("工单不存在", 404);
  if (matches.length !== 1) throw new LinkedApiDomainError("QuickOrder ID 重复，无法确定财务归属", 409);
  return matches[0]!;
}

function canonicalInvoiceHasRefundableLine(
  state: LinkedOperationsState,
  invoice: SharedChargeInvoice,
  effectiveVersion: SharedChargeInvoiceVersion,
  receivableReductionJmd: number,
  receivableJmd: number,
  netPaidJmd: number,
): boolean {
  const modernRefunds = state.refunds.filter((refund): refund is Extract<
    LinkedOperationsState["refunds"][number],
    { refundContract: "ordinary_line_v1" }
  > => (
    refund.refundContract === "ordinary_line_v1" && refund.logicalInvoiceId === invoice.id
  ));
  const assignedLegacyOccupancies = state.legacyRefundOccupancies.filter((occupancy) => (
    occupancy.invoiceId === invoice.id && occupancy.status === "line"
  ));
  const unassignedLegacyOccupancyJmd = financialSafeSum(
    state.legacyRefundOccupancies
      .filter((occupancy) => occupancy.invoiceId === invoice.id && occupancy.status === "unassigned")
      .map((occupancy) => occupancy.amountJmd),
    "Invoice unassigned legacy refund occupancy",
  );
  const legacyOccupancyJmd = financialSafeSum(
    state.legacyRefundOccupancies
      .filter((occupancy) => occupancy.invoiceId === invoice.id)
      .map((occupancy) => occupancy.amountJmd),
    "Invoice legacy refund occupancy",
  );
  const remainingInvoiceCreditJmd = effectiveVersion.snapshot.totals.grandTotalJmd
    - receivableReductionJmd
    - legacyOccupancyJmd;
  if (!Number.isSafeInteger(remainingInvoiceCreditJmd) || remainingInvoiceCreditJmd <= 0) return false;

  return effectiveVersion.snapshot.lines.some((line) => {
    if (line.pricingMode === "parking_projection") return false;
    const lineAmountJmd = line.pricingMode === "unit" ? line.finalLineJmd : line.amountJmd;
    const modernReductionJmd = financialSafeSum(
      modernRefunds
        .filter((refund) => refund.chargeLineId === line.chargeLineId)
        .map((refund) => refund.receivableReductionJmd),
      "Invoice line refund",
    );
    const legacyLineOccupancyJmd = financialSafeSum(
      assignedLegacyOccupancies
        .filter((occupancy) => occupancy.chargeLineId === line.chargeLineId)
        .map((occupancy) => occupancy.amountJmd),
      "Invoice line legacy refund occupancy",
    );
    const remainingLineJmd = lineAmountJmd - modernReductionJmd - legacyLineOccupancyJmd;
    if (!Number.isSafeInteger(remainingLineJmd) || remainingLineJmd < 0) {
      throw new LinkedApiDomainError("Invoice line refund 超过行金额", 409);
    }
    try {
      previewOrdinaryLineRefund({
        line,
        ...(line.pricingMode === "unit" ? { refundQuantity: 1 } : { wholeLine: true as const }),
        receivableBeforeRefundJmd: receivableJmd,
        netPaidBeforeJmd: netPaidJmd,
        remainingInvoiceCreditJmd,
        remainingLineCreditJmd: remainingLineJmd,
        priorRefunds: modernRefunds.map((refund) => ({
          chargeLineId: refund.chargeLineId,
          ...(refund.refundQuantity !== undefined ? { quantity: refund.refundQuantity } : {}),
          receivableReductionJmd: refund.receivableReductionJmd,
        })),
        legacyOccupancies: assignedLegacyOccupancies.map((occupancy) => ({
          chargeLineId: occupancy.chargeLineId,
          amountJmd: occupancy.amountJmd,
          quantityUnknown: occupancy.quantityUnknown,
          ...(occupancy.legacyRefundQuantity !== undefined ? { quantity: occupancy.legacyRefundQuantity } : {}),
        })),
        legacyUnassignedOccupancyJmd: unassignedLegacyOccupancyJmd,
      });
      return true;
    } catch {
      return false;
    }
  });
}

function deriveQuickOrderFinancialBase(
  state: LinkedOperationsState,
  order: QuickOrder,
  nowMs: number,
): QuickOrderFinancialBase {
  if (!Number.isFinite(nowMs)) throw new LinkedApiDomainError("财务读取时钟无效", 503);
  const shared = isSharedChargeQuickOrder(order);
  if (shared) {
    if (
      order.items.length !== 0
      || order.chargeLines.length === 0
      || order.laborDiscountJmd !== 0
      || order.partsDiscountJmd !== 0
      || order.chargeLines.some((line) => (
        (line as { readonly pricingMode: string }).pricingMode === "parking_projection"
        || line.sourceId !== undefined
      ))
    ) {
      throw new LinkedApiDomainError("shared QuickOrder 收费数据不一致", 409);
    }
  } else if (order.chargeContract !== undefined || order.chargeLines !== undefined) {
    throw new LinkedApiDomainError("QuickOrder charge contract 与收费来源不一致", 409);
  }

  const directOwners = state.invoices.filter((invoice) => invoice.businessOrderId === order.id);
  const snapshotOwners = state.invoices.filter((invoice) => (
    isSharedChargeInvoice(invoice)
    && invoice.versions.some((version) => version.snapshot.sourceBusinessOrderId === order.id)
  ));

  if (!shared) {
    if (directOwners.length > 0 || snapshotOwners.length > 0) {
      throw new LinkedApiDomainError("legacy QuickOrder 不得挂载 canonical Invoice owner", 409);
    }
    const finance = legacyQuickOrderFinance(order);
    const grossPaidJmd = financialSafeSum(order.payments.map((payment) => payment.amountJmd), "QuickOrder payment");
    const cashRefundedJmd = financialSafeSum(order.refunds.map((refund) => refund.amountJmd), "QuickOrder refund");
    const netPaidJmd = grossPaidJmd - cashRefundedJmd;
    const invoiceTotalJmd = finance.receivableJmd;
    const receivableJmd = invoiceTotalJmd;
    const balanceJmd = receivableJmd - netPaidJmd;
    const ledger: QuickOrderFinancialLedger = {
      invoiceTotalJmd,
      receivableJmd,
      grossPaidJmd,
      cashRefundedJmd,
      receivableReductionJmd: 0,
      netPaidJmd,
      balanceJmd,
      paymentStatus: financialPaymentStatus(netPaidJmd, receivableJmd),
      settlementStatus: financialSettlementStatus(balanceJmd),
      hasPaymentHistory: order.payments.length > 0,
    };
    const submittedThisMonth = order.status === "submitted" && (
      order.submittedAt === null
      || jamaicaMonthKey(order.submittedAt) === jamaicaMonthKey(new Date(nowMs).toISOString())
    );
    return {
      source: { kind: "legacy_quick" },
      ledger,
      canRefund: order.voidedAt === null,
    };
  }

  if (directOwners.length > 1) {
    throw new LinkedApiDomainError("shared QuickOrder 存在多个 Invoice owner", 409);
  }
  if (directOwners.length === 0) {
    if (snapshotOwners.length > 0) {
      throw new LinkedApiDomainError("shared Invoice snapshot owner 与 BusinessOrder 归属不一致", 409);
    }
    const receivableJmd = calculateQuotedChargeTotals(order.chargeLines).grandTotalJmd;
    const grossPaidJmd = financialSafeSum(order.payments.map((payment) => payment.amountJmd), "Business Order payment");
    const cashRefundedJmd = financialSafeSum(order.refunds.map((refund) => refund.amountJmd), "Business Order refund");
    const netPaidJmd = grossPaidJmd - cashRefundedJmd;
    const balanceJmd = receivableJmd - netPaidJmd;
    return {
      source: { kind: "shared_uninvoiced" },
      ledger: {
        invoiceTotalJmd: null,
        receivableJmd,
        grossPaidJmd,
        cashRefundedJmd,
        receivableReductionJmd: 0,
        netPaidJmd,
        balanceJmd,
        paymentStatus: financialPaymentStatus(netPaidJmd, receivableJmd),
        settlementStatus: financialSettlementStatus(balanceJmd),
        hasPaymentHistory: order.payments.length > 0,
      },
      canRefund: order.voidedAt === null,
    };
  }

  const invoice = directOwners[0]!;
  if (!isSharedChargeInvoice(invoice)) {
    throw new LinkedApiDomainError("shared QuickOrder Invoice owner contract 不是 shared_v1", 409);
  }
  if (
    state.invoices.filter((candidate) => candidate.id === invoice.id).length !== 1
    || snapshotOwners.length !== 1
    || snapshotOwners[0] !== invoice
  ) {
    throw new LinkedApiDomainError("shared QuickOrder snapshot 被多个、别名或错位 Invoice owner 引用", 409);
  }
  if (invoice.versions.length === 0 || invoice.financiallyEffectiveVersionId === null) {
    throw new LinkedApiDomainError("canonical Invoice 缺少财务生效版本", 409);
  }
  const versionIds = new Set<string>();
  for (let index = 0; index < invoice.versions.length; index += 1) {
    const version = invoice.versions[index]!;
    assertClosedFinancialDataObject(version, SHARED_INVOICE_VERSION_FIELDS, "canonical Invoice shared version");
    if (version.chargeContract !== "shared_v1") {
      throw new LinkedApiDomainError("canonical Invoice version contract 不是 shared_v1", 409);
    }
    if (versionIds.has(version.id) || version.version !== index + 1) {
      throw new LinkedApiDomainError("canonical Invoice version 顺序或 ID 无效", 409);
    }
    versionIds.add(version.id);
    if (version.snapshot.sourceBusinessOrderId !== order.id) {
      throw new LinkedApiDomainError("canonical Invoice snapshot source BusinessOrder 归属无效", 409);
    }
    if (billingSnapshotCommitment(version.snapshot) !== version.snapshotCommitment) {
      throw new LinkedApiDomainError("canonical Invoice snapshot commitment 不匹配", 409);
    }
  }
  const effectiveVersion = invoice.versions.find((version) => version.id === invoice.financiallyEffectiveVersionId);
  if (!effectiveVersion) {
    throw new LinkedApiDomainError("canonical Invoice effective version 不存在", 409);
  }
  if (invoice.versions.at(-1)?.id !== effectiveVersion.id) {
    throw new LinkedApiDomainError("canonical Invoice effective version 不是最新版本", 409);
  }
  const financial = deriveLinkedInvoiceFinancialSummary(state, invoice);
  const businessOrderGrossPaidJmd = financialSafeSum(order.payments.map((payment) => payment.amountJmd), "Business Order payment");
  const businessOrderCashRefundedJmd = financialSafeSum(order.refunds.map((refund) => refund.amountJmd), "Business Order refund");
  const grossPaidJmd = financial.grossPaidJmd + businessOrderGrossPaidJmd;
  const cashRefundedJmd = financial.cashRefundedJmd + businessOrderCashRefundedJmd;
  const netPaidJmd = grossPaidJmd - cashRefundedJmd;
  const balanceJmd = financial.receivableJmd - netPaidJmd;
  const ledger: QuickOrderFinancialLedger = {
    invoiceTotalJmd: financial.invoiceTotalJmd,
    receivableJmd: financial.receivableJmd,
    grossPaidJmd,
    cashRefundedJmd,
    receivableReductionJmd: financial.receivableReductionJmd,
    netPaidJmd,
    balanceJmd,
    paymentStatus: financialPaymentStatus(netPaidJmd, financial.receivableJmd),
    settlementStatus: financialSettlementStatus(balanceJmd),
    hasPaymentHistory: financial.hasPaymentHistory || order.payments.length > 0,
  };
  return {
    source: {
      kind: "canonical_invoice",
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      effectiveVersionId: effectiveVersion.id,
      versionNo: effectiveVersion.version,
      snapshotCommitment: effectiveVersion.snapshotCommitment,
    },
    ledger,
    canRefund: order.voidedAt === null,
  };
}

/** Pure one-state selector shared by read APIs and locked mutations. */
export function selectQuickOrderFinancialReadModel(
  state: LinkedOperationsState,
  orderId: string,
  nowMs: number,
): QuickOrderFinancialReadModel {
  const order = financialOrderById(state, orderId);
  const base = deriveQuickOrderFinancialBase(state, order, nowMs);
  const active = order.voidedAt === null;
  const submitted = order.status === "submitted";
  const hasPaidFullMarker = order.paidInFullAt !== null;
  const cascadeHasPaymentHistory = active && state.quickOrders
    .filter((candidate) => (
      candidate.id === order.id
      || (candidate.linkedOrderId === order.id && candidate.voidedAt === null)
    ))
    .some((candidate) => deriveQuickOrderFinancialBase(state, candidate, nowMs).ledger.hasPaymentHistory);
  const sourceKind = base.source.kind;
  const canonicalPaidAndSettled = sourceKind === "canonical_invoice"
    && base.ledger.paymentStatus === "paid"
    && base.ledger.settlementStatus === "settled";
  const gates: QuickOrderFinancialGates = active
    ? {
        canCollectPayment: base.ledger.balanceJmd > 0,
        canRefund: base.canRefund,
        canVoid: !cascadeHasPaymentHistory,
        canRecordPaidFull: submitted && !hasPaidFullMarker && (
          sourceKind === "legacy_quick" || canonicalPaidAndSettled
        ),
        canCancelPaidFull: submitted && hasPaidFullMarker,
        completed: submitted
          && order.pickedUpAt !== null
          && hasPaidFullMarker
          && (sourceKind === "legacy_quick" || canonicalPaidAndSettled),
      }
    : {
        canCollectPayment: false,
        canRefund: false,
        canVoid: false,
        canRecordPaidFull: false,
        canCancelPaidFull: false,
        completed: false,
      };
  const model: QuickOrderFinancialReadModel = {
    contract: "quick_order_financial_read_model_v1",
    revision: state.revision,
    order: {
      id: order.id,
      businessOrderNo: order.businessOrderNo,
      customerId: order.customerId,
      vehicleId: order.vehicleId,
      status: order.status,
      voidedAt: order.voidedAt,
      pickedUpAt: order.pickedUpAt,
      paidInFullAt: order.paidInFullAt,
    },
    source: base.source,
    ledger: base.ledger,
    gates,
  };
  assertQuickOrderFinancialReadModel(model);
  return model;
}

/** One clock read + one canonical state read. */
export function getMockQuickOrderFinancialReadModel(
  orderId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  readGuard?: () => void,
): QuickOrderFinancialReadModel {
  const nowMs = store.nowMs();
  return store.read(
    (state) => {
      readGuard?.();
      return selectQuickOrderFinancialReadModel(state, orderId, nowMs);
    },
    "quickOrders.financial.detail.read",
  );
}

export function listMockQuickOrderFinancialReadModels(
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  readGuard?: () => void,
): QuickOrderFinancialListResponse {
  const nowMs = store.nowMs();
  return store.read((state) => {
    readGuard?.();
    const response: QuickOrderFinancialListResponse = {
      revision: state.revision,
      items: state.quickOrders.map((order) => (
        selectQuickOrderFinancialReadModel(state, order.id, nowMs)
      )),
    };
    assertQuickOrderFinancialListResponse(response);
    return response;
  }, "quickOrders.financial.list.read");
}

function statementCanonicalLine(line: QuickOrderStatementCanonicalLine): QuickOrderStatementCanonicalLine {
  if (line.pricingMode === "unit") {
    return {
      pricingMode: "unit",
      chargeLineId: line.chargeLineId,
      category: line.category,
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      unit: line.unit,
      unitEn: line.unitEn,
      quantity: line.quantity,
      unitPriceJmd: line.unitPriceJmd,
      unitDiscountJmd: line.unitDiscountJmd,
      finalUnitPriceJmd: line.finalUnitPriceJmd,
      finalLineJmd: line.finalLineJmd,
    };
  }
  if (line.pricingMode === "fixed_total") {
    return {
      pricingMode: "fixed_total",
      chargeLineId: line.chargeLineId,
      category: "other_service",
      code: line.code,
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      amountJmd: line.amountJmd,
    };
  }
  return {
    pricingMode: "parking_projection",
    chargeLineId: line.chargeLineId,
    category: "other_service",
    code: "parking_overtime",
    descZh: line.descZh,
    descEn: line.descEn,
    remarkZh: line.remarkZh,
    remarkEn: line.remarkEn,
    parkingCaseId: line.parkingCaseId,
    sourceRevision: line.sourceRevision,
    asOf: line.asOf,
    amountJmd: line.amountJmd,
  };
}

function statementSharedLine(line: QuickOrderChargeLine): QuickOrderStatementSharedLine {
  if (line.pricingMode === "unit") {
    return {
      id: line.id,
      category: line.category,
      pricingMode: "unit",
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      unit: line.unit,
      unitEn: line.unitEn,
      quantity: line.quantity,
      unitPriceJmd: line.unitPriceJmd,
      unitDiscountJmd: line.unitDiscountJmd,
      pendingQuote: line.pendingQuote,
    };
  }
  if (line.pricingMode !== "fixed_total") {
    throw new LinkedApiDomainError("shared-uninvoiced statement 不得包含 parking projection", 409);
  }
  return {
    id: line.id,
    category: "other_service",
    pricingMode: "fixed_total",
    code: line.code,
    descZh: line.descZh,
    descEn: line.descEn,
    remarkZh: line.remarkZh,
    remarkEn: line.remarkEn,
    amountJmd: line.amountJmd,
  };
}

type UnsequencedStatementEntry = QuickOrderStatementEntry extends infer T
  ? T extends QuickOrderStatementEntry
    ? Omit<T, "sequence">
    : never
  : never;

function statementCanonicalEntries(
  state: LinkedOperationsState,
  invoice: SharedChargeInvoice,
): QuickOrderStatementEntry[] {
  const positioned: Array<Readonly<{
    committedRevision: number;
    entry: UnsequencedStatementEntry;
  }>> = [];
  for (const payment of state.payments.filter((candidate) => candidate.invoiceId === invoice.id)) {
    if (!isModernInvoicePaymentFact(payment)) {
      throw new LinkedApiDomainError("canonical Invoice 存在无私有提交坐标的 legacy payment", 409);
    }
    positioned.push({
      committedRevision: payment.committedRevision,
      entry: {
        kind: "payment",
        provenance: "canonical_invoice",
        paymentId: payment.id,
        invoiceVersionId: payment.invoiceVersionId,
        amountJmd: payment.amountJmd,
        occurredAt: payment.receivedAt,
        method: payment.method,
        actorName: payment.receivedBy,
        note: payment.note ?? null,
      },
    });
  }
  const ownerRefunds = state.refunds.filter((refund) => (
    refund.refundContract === "ordinary_line_v1"
      ? refund.logicalInvoiceId === invoice.id
      : refund.invoiceId === invoice.id
  ));
  for (const refund of ownerRefunds) {
    if (refund.refundContract !== "ordinary_line_v1") {
      throw new LinkedApiDomainError("canonical Invoice 不得混入 legacy refund fact", 409);
    }
    const receipts = state.mutationReceipts.filter((receipt) => (
      receipt.operation === "billing.invoice.lineRefund"
      && receipt.mutationId === refund.mutationId
    ));
    if (receipts.length !== 1) {
      throw new LinkedApiDomainError("canonical refund 缺少唯一私有提交坐标", 409);
    }
    const line = statementCanonicalLine(refund.lineSnapshot);
    if (line.pricingMode === "parking_projection") {
      throw new LinkedApiDomainError("parking projection 不得进入普通退款 statement", 409);
    }
    positioned.push({
      committedRevision: receipts[0]!.committedRevision,
      entry: {
        kind: "refund",
        accounting: "canonical_line_v1",
        refundId: refund.id,
        invoiceVersionId: refund.invoiceVersionId,
        line,
        refundQuantity: refund.refundQuantity ?? null,
        wholeLine: refund.wholeLine === true,
        receivableReductionJmd: refund.receivableReductionJmd,
        cashRefundJmd: refund.cashRefundJmd,
        occurredAt: refund.refundedAt,
        method: refund.method,
        actorName: refund.actorName,
        reason: refund.reason,
      },
    });
  }
  for (const correction of state.billingAuditEvents.filter((event): event is LinkedParkingInvoiceReprojectionAudit => (
    event.operation === "parking_invoice_reprojection"
      && event.reprojectionKind === "waiver_correction"
      && event.invoiceId === invoice.id
      && event.parkingCashRefundJmd > 0
  ))) {
    const receipt = state.mutationReceipts.find((candidate) => (
      candidate.operation === "parking.source.correct" && candidate.mutationId === correction.mutationId
    ));
    if (!receipt?.payloadCanonical) {
      throw new LinkedApiDomainError("parking correction 缺少唯一私有提交坐标", 409);
    }
    const payload = JSON.parse(receipt.payloadCanonical) as { refundMethod?: unknown; previewToken?: unknown };
    const token = typeof payload.previewToken === "string"
      ? state.parkingWaiverPreviews.find((candidate) => candidate.id === payload.previewToken)
      : undefined;
    if (typeof payload.refundMethod !== "string" || !token || token.previewContract !== "parking_correction_preview_v1") {
      throw new LinkedApiDomainError("parking correction 退款记录不完整", 409);
    }
    positioned.push({
      committedRevision: correction.committedRevision,
      entry: {
        kind: "refund",
        accounting: "parking_correction_v1",
        refundId: correction.id,
        invoiceVersionId: correction.invoiceVersionId,
        parkingCaseId: correction.parkingCaseId,
        chargeLineId: correction.chargeLineId,
        lineDescription: "停车费更正退款",
        receivableReductionJmd: 0,
        cashRefundJmd: correction.parkingCashRefundJmd,
        occurredAt: correction.recordedAt,
        method: payload.refundMethod,
        actorName: correction.actorName,
        reason: token.reason,
      },
    });
  }
  positioned.sort((left, right) => left.committedRevision - right.committedRevision);
  for (let index = 1; index < positioned.length; index += 1) {
    if (positioned[index - 1]!.committedRevision >= positioned[index]!.committedRevision) {
      throw new LinkedApiDomainError("canonical statement 私有提交坐标重复或倒序", 409);
    }
  }
  return positioned.map(({ entry }, index) => ({ ...entry, sequence: index + 1 } as QuickOrderStatementEntry));
}

function statementOrderEntries(
  order: QuickOrder,
  provenance: "business_order" | "legacy_quick",
): QuickOrderStatementEntry[] {
  const positioned: Array<Readonly<{
    occurredAt: string;
    family: number;
    sourceIndex: number;
    entry: UnsequencedStatementEntry;
  }>> = [];
  order.payments.forEach((payment, sourceIndex) => {
    positioned.push({
      occurredAt: payment.receivedAt,
      family: 0,
      sourceIndex,
      entry: {
        kind: "payment",
        provenance,
        paymentId: payment.id,
        invoiceVersionId: null,
        amountJmd: payment.amountJmd,
        occurredAt: payment.receivedAt,
        method: payment.method ?? null,
        actorName: payment.receivedBy ?? null,
        note: payment.note ?? null,
      },
    });
  });
  order.refunds.forEach((refund, sourceIndex) => {
    positioned.push({
      occurredAt: refund.refundedAt,
      family: 1,
      sourceIndex,
      entry: {
        kind: "refund",
        accounting: "legacy_cash_only",
        refundId: refund.id,
        invoiceVersionId: null,
        category: refund.category ?? null,
        lineDescription: null,
        receivableReductionJmd: null,
        cashRefundJmd: refund.amountJmd,
        occurredAt: refund.refundedAt,
        method: refund.method ?? null,
        actorName: refund.refundedBy ?? null,
        note: refund.note ?? null,
      },
    });
  });
  positioned.sort((left, right) => (
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    || left.family - right.family
    || left.sourceIndex - right.sourceIndex
  ));
  return positioned.map(({ entry }, index) => ({ ...entry, sequence: index + 1 } as QuickOrderStatementEntry));
}

/** Pure one-state, read-only statement selector. */
export function selectQuickOrderFinancialStatement(
  state: LinkedOperationsState,
  orderId: string,
  nowMs: number,
): QuickOrderFinancialStatement {
  validateLinkedOperationsState(state);
  const financial = selectQuickOrderFinancialReadModel(state, orderId, nowMs);
  const order = financialOrderById(state, orderId);
  let charges: QuickOrderFinancialStatement["charges"];
  let entries: QuickOrderStatementEntry[];
  if (financial.source.kind === "legacy_quick") {
    const gross = quickOrderTotals(order);
    const laborDiscountJmd = order.laborDiscountJmd ?? 0;
    const partsDiscountJmd = order.partsDiscountJmd ?? 0;
    charges = {
      kind: "legacy_quick",
      discountModel: "legacy_category_discount",
      items: order.items.map((item) => ({
        id: item.id,
        descZh: item.descZh,
        descEn: item.descEn,
        remarkZh: item.remarkZh ?? "",
        remarkEn: item.remarkEn ?? "",
        category: item.category,
        unit: item.unit,
        unitEn: item.unitEn ?? item.unit,
        unitPriceJmd: item.unitPriceJmd,
        quantity: item.quantity,
        pendingQuote: item.pendingQuote,
      })),
      totals: {
        laborGrossJmd: gross.laborJmd,
        partsGrossJmd: gross.partsJmd,
        laborDiscountJmd,
        partsDiscountJmd,
        totalDiscountJmd: laborDiscountJmd + partsDiscountJmd,
        grandTotalJmd: financial.ledger.invoiceTotalJmd!,
      },
    };
    entries = statementOrderEntries(order, "legacy_quick");
  } else if (financial.source.kind === "shared_uninvoiced") {
    if (!isSharedChargeQuickOrder(order)) {
      throw new LinkedApiDomainError("shared-uninvoiced statement source 不一致", 409);
    }
    charges = {
      kind: "shared_uninvoiced",
      status: "provisional",
      lines: order.chargeLines.map(statementSharedLine),
      totals: calculateQuotedChargeTotals(order.chargeLines),
    };
    entries = statementOrderEntries(order, "business_order");
  } else {
    const canonicalSource = financial.source;
    if (canonicalSource.kind !== "canonical_invoice") {
      throw new LinkedApiDomainError("canonical statement source 判别失败", 409);
    }
    const invoice = state.invoices.find((candidate) => candidate.id === canonicalSource.invoiceId);
    if (!invoice || !isSharedChargeInvoice(invoice)) {
      throw new LinkedApiDomainError("canonical statement Invoice owner 不存在", 409);
    }
    const version = invoice.versions.find((candidate) => candidate.id === canonicalSource.effectiveVersionId);
    if (!version) throw new LinkedApiDomainError("canonical statement effective version 不存在", 409);
    charges = {
      kind: "canonical_invoice",
      issuedAt: version.issuedAt,
      lines: version.snapshot.lines.map(statementCanonicalLine),
      totals: {
        laborGrossJmd: version.snapshot.totals.laborGrossJmd,
        laborDiscountJmd: version.snapshot.totals.laborDiscountJmd,
        laborNetJmd: version.snapshot.totals.laborNetJmd,
        partsGrossJmd: version.snapshot.totals.partsGrossJmd,
        partsDiscountJmd: version.snapshot.totals.partsDiscountJmd,
        partsNetJmd: version.snapshot.totals.partsNetJmd,
        otherFeeTotalJmd: version.snapshot.totals.otherFeeTotalJmd,
        parkingTotalJmd: version.snapshot.totals.parkingTotalJmd,
        totalDiscountJmd: version.snapshot.totals.totalDiscountJmd,
        chargeSubtotalJmd: version.snapshot.totals.chargeSubtotalJmd,
        adjustmentsJmd: version.snapshot.totals.adjustmentsJmd,
        grandTotalJmd: version.snapshot.totals.grandTotalJmd,
      },
    };
    entries = [...statementOrderEntries(order, "business_order"), ...statementCanonicalEntries(state, invoice)]
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.sequence - right.sequence)
      .map((entry, index) => ({ ...entry, sequence: index + 1 }));
  }
  const statement: QuickOrderFinancialStatement = {
    contract: "quick_order_financial_statement_v1",
    revision: financial.revision,
    order: {
      id: financial.order.id,
      businessOrderNo: financial.order.businessOrderNo,
      customerId: financial.order.customerId,
      vehicleId: financial.order.vehicleId,
      status: financial.order.status,
      voidedAt: financial.order.voidedAt,
      pickedUpAt: financial.order.pickedUpAt,
      paidInFullAt: financial.order.paidInFullAt,
    },
    source: financial.source.kind === "canonical_invoice"
      ? {
          kind: "canonical_invoice",
          invoiceId: financial.source.invoiceId,
          invoiceNo: financial.source.invoiceNo,
          effectiveVersionId: financial.source.effectiveVersionId,
          versionNo: financial.source.versionNo,
          snapshotCommitment: financial.source.snapshotCommitment,
        }
      : { kind: financial.source.kind },
    charges,
    ledger: {
      invoiceTotalJmd: financial.ledger.invoiceTotalJmd,
      receivableJmd: financial.ledger.receivableJmd,
      grossPaidJmd: financial.ledger.grossPaidJmd,
      cashRefundedJmd: financial.ledger.cashRefundedJmd,
      receivableReductionJmd: financial.ledger.receivableReductionJmd,
      netPaidJmd: financial.ledger.netPaidJmd,
      balanceJmd: financial.ledger.balanceJmd,
      paymentStatus: financial.ledger.paymentStatus,
      settlementStatus: financial.ledger.settlementStatus,
      hasPaymentHistory: financial.ledger.hasPaymentHistory,
    },
    entries,
  };
  assertQuickOrderFinancialStatement(statement);
  return statement;
}

/** One clock read + one canonical state read. */
export function getMockQuickOrderFinancialStatement(
  orderId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  readGuard?: () => void,
): QuickOrderFinancialStatement {
  const nowMs = store.nowMs();
  return store.read((state) => {
    readGuard?.();
    return selectQuickOrderFinancialStatement(state, orderId, nowMs);
  }, "quickOrders.financial.statement.read");
}

function financialLedgerSource(source: QuickOrderFinancialSource): QuickOrderFinancialSource {
  return source.kind === "canonical_invoice"
    ? {
        kind: "canonical_invoice",
        invoiceId: source.invoiceId,
        invoiceNo: source.invoiceNo,
        effectiveVersionId: source.effectiveVersionId,
        versionNo: source.versionNo,
        snapshotCommitment: source.snapshotCommitment,
      }
    : { kind: source.kind };
}

/** Pure current-state cross-order ledger. Every payment/refund becomes one row. */
export function selectQuickOrderFinancialLedger(
  state: LinkedOperationsState,
  nowMs: number,
): QuickOrderFinancialLedgerResponse {
  validateLinkedOperationsState(state);
  type PositionedLedgerItem =
    | Omit<Extract<QuickOrderFinancialLedgerItem, { kind: "payment" }>, "sequence">
    | Omit<Extract<QuickOrderFinancialLedgerItem, { kind: "refund" }>, "sequence">;
  const positioned: PositionedLedgerItem[] = [];
  let activeReceivableJmd = 0;
  let activeBalanceJmd = 0;
  for (const order of state.quickOrders) {
    const statement = selectQuickOrderFinancialStatement(state, order.id, nowMs);
    if (statement.order.voidedAt === null) {
      activeReceivableJmd += statement.ledger.receivableJmd;
      activeBalanceJmd += statement.ledger.balanceJmd;
    }
    for (const entry of statement.entries) {
      const common = {
        id: entry.kind === "payment" ? entry.paymentId : entry.refundId,
        orderId: statement.order.id,
        businessOrderNo: statement.order.businessOrderNo,
        customerId: statement.order.customerId,
        vehicleId: statement.order.vehicleId,
        source: financialLedgerSource(statement.source),
        occurredAt: entry.occurredAt,
        method: entry.method,
      } as const;
      if (entry.kind === "payment") {
        positioned.push({
          ...common,
          kind: "payment",
          amountJmd: entry.amountJmd,
          note: entry.note,
        });
      } else if (entry.accounting === "legacy_cash_only") {
        positioned.push({
          ...common,
          kind: "refund",
          category: entry.category,
          lineDescription: entry.lineDescription,
          receivableReductionJmd: 0,
          cashRefundJmd: entry.cashRefundJmd,
          reason: entry.note,
        });
      } else if (entry.accounting === "parking_correction_v1") {
        positioned.push({
          ...common,
          kind: "refund",
          category: null,
          lineDescription: entry.lineDescription,
          receivableReductionJmd: entry.receivableReductionJmd,
          cashRefundJmd: entry.cashRefundJmd,
          reason: entry.reason,
        });
      } else {
        positioned.push({
          ...common,
          kind: "refund",
          category: entry.line.category,
          lineDescription: entry.line.descZh,
          receivableReductionJmd: entry.receivableReductionJmd,
          cashRefundJmd: entry.cashRefundJmd,
          reason: entry.reason,
        });
      }
    }
  }
  positioned.sort((left, right) => (
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    || left.orderId.localeCompare(right.orderId)
    || left.id.localeCompare(right.id)
  ));
  const items: QuickOrderFinancialLedgerItem[] = positioned.map((item, index) => ({
    ...item,
    sequence: index + 1,
  }) as QuickOrderFinancialLedgerItem);
  const grossPaidJmd = items.reduce((sum, item) => sum + (item.kind === "payment" ? item.amountJmd : 0), 0);
  const cashRefundedJmd = items.reduce((sum, item) => sum + (item.kind === "refund" ? item.cashRefundJmd : 0), 0);
  const receivableReductionJmd = items.reduce((sum, item) => (
    sum + (item.kind === "refund" ? item.receivableReductionJmd : 0)
  ), 0);
  const response: QuickOrderFinancialLedgerResponse = {
    contract: "quick_order_financial_ledger_v1",
    revision: state.revision,
    items,
    totals: {
      grossPaidJmd,
      cashRefundedJmd,
      receivableReductionJmd,
      netPaidJmd: grossPaidJmd - cashRefundedJmd,
      activeReceivableJmd,
      activeBalanceJmd,
    },
  };
  assertQuickOrderFinancialLedgerResponse(response);
  return response;
}

/** One clock read + one canonical state read. */
export function getMockQuickOrderFinancialLedger(
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  readGuard?: () => void,
): QuickOrderFinancialLedgerResponse {
  const nowMs = store.nowMs();
  return store.read((state) => {
    readGuard?.();
    return selectQuickOrderFinancialLedger(state, nowMs);
  }, "quickOrders.financial.ledger.read");
}

function cloneOrder(order: QuickOrder): QuickOrder {
  const clone = JSON.parse(JSON.stringify(order)) as QuickOrder;
  // 旧存档缺新字段时补默认值（v5 无破坏性迁移）
  const withUnitItems = clone.items.map((item) => ({
    ...item,
    unit: item.unit ?? (item.category === "labor" ? "工时" : "个"),
  }));
  return Object.assign(clone, {
    noteZh: clone.noteZh ?? null,
    noteEn: clone.noteEn ?? null,
    editHistory: clone.editHistory ?? [],
    orderKind: clone.orderKind ?? "normal",
    linkedOrderId: clone.linkedOrderId ?? null,
    invoiceSignature: clone.invoiceSignature ?? null,
    laborDiscountJmd: clone.laborDiscountJmd ?? 0,
    partsDiscountJmd: clone.partsDiscountJmd ?? 0,
    pickupNotice: clone.pickupNotice ?? null,
    pickedUpAt: clone.pickedUpAt ?? null,
    pickedUpBy: clone.pickedUpBy ?? null,
    paidInFullAt: clone.paidInFullAt ?? null,
    paidInFullBy: clone.paidInFullBy ?? null,
    voidedAt: clone.voidedAt ?? null,
    voidedBy: clone.voidedBy ?? null,
    voidReason: clone.voidReason ?? null,
    etaDays: clone.etaDays ?? null,
    items: withUnitItems,
  });
}

function mustFind(state: LinkedOperationsState, orderId: string): QuickOrder {
  const order = (state.quickOrders as QuickOrder[]).find((item) => item.id === orderId);
  if (!order) throw new LinkedApiDomainError("工单不存在", 404);
  return order as QuickOrder & {
    -readonly [K in keyof QuickOrder]: QuickOrder[K];
  };
}

// ---------------------------------------------------------------------------
// 创建
// ---------------------------------------------------------------------------

export interface CreateQuickOrderInput {
  customerId: string;
  vehicleId: string;
  rawInput: string;
  noteZh?: string;
  noteEn?: string;
  items: ReadonlyArray<Omit<QuickOrderItem, "id" | "unit"> & { unit?: string }>;
  /** 整单工时优惠（8/18 老板：与配件优惠分开）。 */
  laborDiscountJmd?: number;
  /** 整单配件优惠。 */
  partsDiscountJmd?: number;
  /** 售后（不计绩效）／对冲（负绩效扣回原单）；缺省 normal。 */
  orderKind?: QuickOrderKind;
  /** 售后/对冲单关联的原工单。 */
  linkedOrderId?: string;
  /** 对冲金额（JMD，正数）：退款跨月对冲时按退款额对冲；缺省=原单绩效取负。 */
  hedgeAmountJmd?: number;
}

export interface SharedQuickOrderMutationActor {
  readonly id: string;
  readonly name: string;
  readonly role: "superadmin" | "frontdesk_admin";
}

export interface AppendSharedQuickOrderInput {
  readonly customerId: string;
  readonly vehicleId: string;
  readonly rawInput: string;
  readonly noteZh: string;
  readonly noteEn?: string;
  readonly chargeLines: ReadonlyArray<QuickOrderChargeLine>;
  readonly mutationId: string;
  readonly signature?: {
    readonly rawStrokes: DiscountApprovalEvidence["rawStrokes"];
  };
}

function nextQuickOrderIdentity(
  state: LinkedOperationsState,
  recordedAt: string,
): { id: string; sequence: number; businessOrderNo: string } {
  let highWater = 0;
  const occupiedOrderIds = new Set(state.quickOrders.map((order) => order.id));
  const occupiedBusinessOrderNos = new Set(state.quickOrders.map((order) => order.businessOrderNo));
  const occupiedLineIds = new Set(state.quickOrders.flatMap((order) => [
    ...order.items.map((item) => item.id),
    ...(order.chargeLines ?? []).map((line) => line.id),
  ]));
  for (const id of occupiedOrderIds) {
    const match = /^qbo-(\d+)$/u.exec(id);
    if (match) highWater = Math.max(highWater, Number(match[1]));
  }
  let sequence = highWater + 1;
  while (true) {
    if (sequence > 80_599) throw new LinkedApiDomainError("业务单编号序列已耗尽", 409);
    const id = `qbo-${String(sequence).padStart(4, "0")}`;
    const businessOrderNo = formatBusinessOrderNo({
      branchCode: "KGN",
      brandCode: "WH",
      businessDate: businessDateInJamaica(recordedAt),
      sequence: 19_400 + sequence,
    });
    const hasLineCollision = [...occupiedLineIds].some((lineId) => lineId.startsWith(`${id}-charge-`));
    if (!occupiedOrderIds.has(id) && !occupiedBusinessOrderNos.has(businessOrderNo) && !hasLineCollision) {
      return { id, sequence, businessOrderNo };
    }
    sequence += 1;
  }
}

function copiedSharedChargeLine(line: QuickOrderChargeLine, id: string): QuickOrderChargeLine {
  if (line.pricingMode === "fixed_total") {
    return {
      id,
      category: "other_service",
      pricingMode: "fixed_total",
      code: line.code,
      descZh: line.descZh.trim(),
      descEn: line.descEn.trim(),
      remarkZh: line.remarkZh.trim(),
      remarkEn: line.remarkEn.trim(),
      amountJmd: line.amountJmd,
    };
  }
  return {
    id,
    category: line.category,
    pricingMode: "unit",
    descZh: line.descZh.trim(),
    descEn: line.descEn.trim(),
    remarkZh: line.remarkZh.trim(),
    remarkEn: line.remarkEn.trim(),
    unit: line.unit.trim(),
    unitEn: line.unitEn.trim(),
    quantity: line.quantity,
    unitPriceJmd: line.unitPriceJmd,
    unitDiscountJmd: line.unitDiscountJmd,
    pendingQuote: line.pendingQuote,
  };
}

/**
 * Pure state append used by the IR bridge while it already owns the shared
 * lock. It deliberately performs no nested store mutation.
 */
export function appendSharedQuickOrderToState(
  state: LinkedOperationsState,
  input: AppendSharedQuickOrderInput,
  actor: SharedQuickOrderMutationActor,
  recordedAt: string,
): QuickOrder {
  if (!input.customerId.trim() || !input.vehicleId.trim()) throw new LinkedApiDomainError("客户与车辆必选", 400);
  if (!state.customers.some((customer) => customer.id === input.customerId)) throw new LinkedApiDomainError("客户不存在", 400);
  if (!state.vehicles.some((vehicle) => vehicle.id === input.vehicleId && vehicle.customerId === input.customerId)) {
    throw new LinkedApiDomainError("车辆与客户不匹配", 400);
  }
  if (input.chargeLines.length === 0) throw new LinkedApiDomainError("至少一条收费项目", 400);
  if (!input.mutationId.trim()) throw new LinkedApiDomainError("mutationId 无效", 400);
  if (!actor.id.trim() || !actor.name.trim() || (actor.role !== "superadmin" && actor.role !== "frontdesk_admin")) {
    throw new LinkedApiDomainError("业务单操作账号无效", 403);
  }

  const identity = nextQuickOrderIdentity(state, recordedAt);
  const occupiedLineIds = new Set(state.quickOrders.flatMap((order) => [
    ...order.items.map((item) => item.id),
    ...(order.chargeLines ?? []).map((line) => line.id),
  ]));
  const chargeLines = input.chargeLines.map((line, index) => {
    const id = `${identity.id}-charge-${index + 1}`;
    if (occupiedLineIds.has(id)) throw new LinkedApiDomainError("业务单收费行 ID 冲突", 409);
    const copied = copiedSharedChargeLine(line, id);
    try {
      validateQuotedChargeLine(copied);
    } catch (error) {
      throw new LinkedApiDomainError(error instanceof Error ? error.message : "业务单收费行无效", 400);
    }
    return copied;
  });
  const requirement = discountApprovalRequirement(chargeLines);
  let signatureEvidence: DiscountApprovalEvidence | null = null;
  if (input.signature) {
    signatureEvidence = {
      document: { kind: "business_order", id: identity.id },
      operationAccount: { id: actor.id.trim(), name: actor.name.trim() },
      rawStrokes: input.signature.rawStrokes,
      signedAt: recordedAt,
      mutationId: input.mutationId.trim(),
      categoryRatios: { labor: requirement.labor, parts: requirement.parts },
    };
    try {
      validateDiscountApprovalEvidence(signatureEvidence);
    } catch (error) {
      throw new LinkedApiDomainError(error instanceof Error ? error.message : "业务单优惠签字笔迹无效", 400);
    }
  }
  if (requirement.required && !signatureEvidence) {
    throw new LinkedApiDomainError("目标业务单工时或配件优惠超过门槛，需要一份新的非空原始笔迹签字", 400);
  }
  if (requirement.required && signatureEvidence) {
    const digest = discountSignatureStrokeDigest(signatureEvidence.rawStrokes);
    if (state.discountSignatureEvents.some((event) => discountSignatureStrokeDigest(event.rawStrokes) === digest)) {
      throw new LinkedApiDomainError("该原始笔迹已被另一笔收费写入消费，请为业务单重新签字", 409);
    }
  }

  const totals = calculateQuotedChargeTotals(chargeLines);
  const order: QuickOrder = {
    id: identity.id,
    businessOrderNo: identity.businessOrderNo,
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    createdAt: recordedAt,
    createdBy: actor.name.trim(),
    rawInput: input.rawInput,
    noteZh: input.noteZh.trim() || null,
    noteEn: input.noteEn?.trim() || null,
    editHistory: [],
    orderKind: "normal",
    linkedOrderId: null,
    items: [],
    chargeContract: QUICK_ORDER_SHARED_CHARGE_CONTRACT,
    chargeLines,
    status: "pending_assign",
    statusHistory: [{ id: `${identity.id}-ev-1`, from: null, to: "pending_assign", by: actor.name.trim(), byRole: "frontdesk", at: recordedAt }],
    teamId: null,
    mechanicName: null,
    assignedAt: null,
    acceptedAt: null,
    returnedAt: null,
    submittedAt: null,
    submittedBy: null,
    startMileageKm: null,
    startMileageRecordedAt: null,
    startMileageRecordedBy: null,
    stallReason: null,
    performanceValueJmd: totals.laborGrossJmd,
    performanceAdjusts: [],
    laborDiscountJmd: 0,
    partsDiscountJmd: 0,
    payments: [],
    refunds: [],
    invoiceSignature: null,
    pickupNotice: null,
    pickedUpAt: null,
    pickedUpBy: null,
    paidInFullAt: null,
    paidInFullBy: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    etaDays: null,
  };
  state.quickOrders.push(order);
  if (requirement.required && signatureEvidence) state.discountSignatureEvents.push(signatureEvidence);
  return order;
}

export function createMockQuickOrder(
  input: CreateQuickOrderInput,
  actorName: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  return store.mutate((state) => {
    if (!input.customerId || !input.vehicleId) throw new LinkedApiDomainError("客户与车辆必选", 400);
    if (!input.rawInput.trim()) throw new LinkedApiDomainError("自然语言原文不能为空", 400);
    const orderKind = input.orderKind ?? "normal";
    if (orderKind === "normal" && input.items.length === 0) throw new LinkedApiDomainError("至少一条收费项目", 400);
    if (orderKind !== "normal" && !input.linkedOrderId) throw new LinkedApiDomainError("售后/对冲单必须关联原工单", 400);
    for (const item of input.items) {
      if (!item.descZh.trim()) throw new LinkedApiDomainError("收费项目描述不能为空", 400);
      if (!item.descEn.trim()) throw new LinkedApiDomainError("英文翻译不能为空（客户大多是英语母语）", 400);
      if (!Number.isSafeInteger(item.unitPriceJmd) || item.unitPriceJmd < 0) throw new LinkedApiDomainError("单价必须是非负整数", 400);
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new LinkedApiDomainError("数量必须大于 0", 400);
    }
    // 整单优惠：分工时/配件两个口径，各不能超过该类合计（8/18 老板）
    const laborTotal = input.items.filter((item) => item.category === "labor" && !item.pendingQuote).reduce((sum, item) => sum + item.unitPriceJmd * item.quantity, 0);
    const partsTotal = input.items.filter((item) => item.category === "parts" && !item.pendingQuote).reduce((sum, item) => sum + item.unitPriceJmd * item.quantity, 0);
    const laborDiscount = input.laborDiscountJmd ?? 0;
    const partsDiscount = input.partsDiscountJmd ?? 0;
    if (!Number.isSafeInteger(laborDiscount) || laborDiscount < 0 || !Number.isSafeInteger(partsDiscount) || partsDiscount < 0) throw new LinkedApiDomainError("优惠金额必须是非负整数", 400);
    if (laborDiscount > laborTotal) throw new LinkedApiDomainError("工时优惠不能超过工时合计", 400);
    if (partsDiscount > partsTotal) throw new LinkedApiDomainError("配件优惠不能超过配件合计", 400);
    // 对冲单：绩效值 = 原单绩效取负（扣回）；售后单：0（无绩效要求）
    let performanceValueJmd: number;
    if (orderKind === "hedge") {
      const original = state.quickOrders.find((candidate) => candidate.id === input.linkedOrderId);
      if (!original) throw new LinkedApiDomainError("关联的原工单不存在", 400);
      if (original.status !== "submitted") throw new LinkedApiDomainError("只能对已交单的原工单开对冲单", 400);
      const hedgeAmount = input.hedgeAmountJmd ?? original.performanceValueJmd;
      if (!Number.isSafeInteger(hedgeAmount) || hedgeAmount < 0) throw new LinkedApiDomainError("对冲金额必须是非负整数", 400);
      performanceValueJmd = -hedgeAmount;
    } else if (orderKind === "aftersales") {
      performanceValueJmd = 0;
    } else {
      performanceValueJmd = 0; // 占位，下面按合计重算
    }
    const sequence = state.quickOrders.length + 1;
    const id = `qbo-${String(sequence).padStart(4, "0")}`;
    const now = new Date(store.nowMs()).toISOString();
    const items: QuickOrderItem[] = input.items.map((item, index) => ({
      ...item,
      descZh: item.descZh.trim(),
      descEn: item.descEn.trim(),
      unit: item.unit?.trim() || (item.category === "labor" ? "工时" : "个"),
      id: `${id}-item-${index + 1}`,
    }));
    const { laborJmd } = quickOrderTotals({ items });
    const order: QuickOrder = {
      id,
      businessOrderNo: formatBusinessOrderNo({
        branchCode: "KGN",
        brandCode: "WH",
        businessDate: businessDateInJamaica(now),
        sequence: 19_400 + state.quickOrders.length + 1,
      }),
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      createdAt: now,
      createdBy: actorName,
      rawInput: input.rawInput,
      noteZh: input.noteZh?.trim() || null,
      noteEn: input.noteEn?.trim() || null,
      editHistory: [],
      orderKind,
      linkedOrderId: orderKind === "normal" ? null : (input.linkedOrderId ?? null),
      items,
      status: "pending_assign",
      statusHistory: [{ id: `${id}-ev-1`, from: null, to: "pending_assign", by: actorName, byRole: "frontdesk", at: now }],
      teamId: null,
      mechanicName: null,
      assignedAt: null,
      acceptedAt: null,
      returnedAt: null,
      submittedAt: null,
      submittedBy: null,
      startMileageKm: null,
      startMileageRecordedAt: null,
      startMileageRecordedBy: null,
      stallReason: null,
      // 绩效值：独立计算值，默认 = 工时合计，配件不算（8/18 老板修正；原来误把配件算进去了）
      performanceValueJmd: orderKind === "normal" ? laborJmd : performanceValueJmd,
      performanceAdjusts: [],
      laborDiscountJmd: input.laborDiscountJmd ?? 0,
      partsDiscountJmd: input.partsDiscountJmd ?? 0,
      payments: [],
      refunds: [],
      invoiceSignature: null,
      pickupNotice: null,
      pickedUpAt: null,
      pickedUpBy: null,
      paidInFullAt: null,
      paidInFullBy: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      etaDays: null,
    };
    (state.quickOrders as QuickOrder[]).push(order);
    state.revision += 1;
    return cloneOrder(order);
  }, { action: "quickOrders.create.write" });
}

// ---------------------------------------------------------------------------
// 状态动作
// ---------------------------------------------------------------------------

export type QuickOrderAction =
  | { kind: "assign"; teamId: string; mechanicName?: string; etaDays?: number }
  | { kind: "accept"; mechanicName?: string; startMileageKm?: number; etaDays?: number }
  | { kind: "return" }
  | { kind: "stall"; reason: string }
  | { kind: "resume"; reason?: string }
  | { kind: "submit"; performanceValueJmd?: number; teamId?: string }
  | { kind: "record_mileage"; startMileageKm: number }
  | { kind: "unsubmit"; reason: string }
  | { kind: "start_aftersales_round"; reason: string }
  | { kind: "rollback"; reason: string }
  | { kind: "adjust"; to: QuickBoStatus; reason: string }
  // 绩效值内联修改（2026-08-18 老板：详情页直接改，未交单随时可改、记操作人）
  | { kind: "set_performance"; performanceValueJmd: number }
  // 最终完结三件事（2026-08-18 老板）：交单之外的两件 + 撤销保护（点错可回退）
  | { kind: "record_pickup" }
  | { kind: "cancel_pickup" }
  | { kind: "record_paid_full" }
  | { kind: "cancel_paid_full" }
  // 废除/恢复（2026-08-18 老板）：不删除；废除=全部数据无效不参与计算；可恢复
  | { kind: "void"; reason: string }
  | { kind: "restore" };

const MUTABLE = (order: QuickOrder) => order as {
  -readonly [K in keyof QuickOrder]: QuickOrder[K];
};

export type QuickOrderLifecycleActorRole =
  | "superadmin"
  | "frontdesk_admin"
  | "finance"
  | "mechanic";

export interface QuickOrderLifecycleActor {
  readonly id: string;
  readonly name: string;
  readonly role: QuickOrderLifecycleActorRole;
}

interface QuickOrderLifecycleCoordinate {
  readonly status: QuickBoStatus;
  readonly voidedAt: string | null;
  readonly voidedBy: string | null;
  readonly voidReason: string | null;
  readonly paidInFullAt: string | null;
  readonly paidInFullBy: string | null;
}

interface QuickOrderLifecycleReceiptEvent {
  readonly id: string;
  readonly from: QuickBoStatus | null;
  readonly to: QuickBoStatus;
  readonly by: string;
  readonly byRole: "frontdesk" | "mechanic";
  readonly at: string;
  readonly reason: string | null;
}

interface QuickOrderLifecycleReceiptChange {
  readonly orderId: string;
  readonly before: QuickOrderLifecycleCoordinate;
  readonly after: QuickOrderLifecycleCoordinate;
  readonly event: QuickOrderLifecycleReceiptEvent;
}

interface LegacyQuickOrderLifecycleMutationResultV1 {
  readonly contract: "quick_order_lifecycle_mutation_result_v1";
  readonly revision: number;
  readonly kind: QuickOrderLifecycleKind;
  readonly orderId: string;
  readonly affectedOrderIds: ReadonlyArray<string>;
  readonly committedAt: string;
  readonly financial: QuickOrderFinancialReadModel;
}

interface QuickOrderLifecycleReceiptResultV1 {
  readonly receiptContract: "quick_order_lifecycle_receipt_v1";
  readonly actor: QuickOrderLifecycleActor;
  readonly changes: ReadonlyArray<QuickOrderLifecycleReceiptChange>;
  readonly publicResult: LegacyQuickOrderLifecycleMutationResultV1;
}

interface QuickOrderLifecycleReceiptResultV2 {
  readonly receiptContract: "quick_order_lifecycle_receipt_v2";
  readonly actor: QuickOrderLifecycleActor;
  readonly changes: ReadonlyArray<QuickOrderLifecycleReceiptChange>;
  readonly financialSnapshot: QuickOrderFinancialReadModel;
  readonly publicResult: QuickOrderLifecycleMutationResult;
}

const QUICK_ORDER_LIFECYCLE_ACTOR_FIELDS = new Set(["id", "name", "role"]);
const QUICK_ORDER_LIFECYCLE_KINDS = new Set<string>([
  "void", "restore", "record_paid_full", "cancel_paid_full",
]);

function normalizeQuickOrderLifecycleInput(raw: unknown): QuickOrderLifecycleMutationInput {
  try {
    assertQuickOrderLifecycleMutationInput(raw);
  } catch (error) {
    throw new LinkedApiDomainError(
      error instanceof Error ? error.message : "QuickOrder lifecycle 请求格式错误",
      400,
    );
  }
  if (isTask8ReservedChildMutationId(raw.mutationId)) {
    throw new LinkedApiDomainError("mutationId 使用了系统保留命名空间", 400);
  }
  return raw.kind === "void"
    ? {
        contract: "quick_order_lifecycle_mutation_v1",
        kind: "void",
        orderId: raw.orderId,
        expectedRevision: raw.expectedRevision,
        mutationId: raw.mutationId,
        reason: raw.reason.trim(),
      }
    : {
        contract: "quick_order_lifecycle_mutation_v1",
        kind: raw.kind,
        orderId: raw.orderId,
        expectedRevision: raw.expectedRevision,
        mutationId: raw.mutationId,
      };
}

function lifecycleRoleAllowed(kind: QuickOrderLifecycleKind, role: QuickOrderLifecycleActorRole): boolean {
  if (kind === "void" || kind === "restore") {
    return role === "superadmin" || role === "frontdesk_admin" || role === "finance" || role === "mechanic";
  }
  return role === "superadmin" || role === "frontdesk_admin" || role === "finance";
}

function normalizeQuickOrderLifecycleActorIdentity(raw: unknown): QuickOrderLifecycleActor {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new LinkedApiDomainError("QuickOrder lifecycle 操作账号无效", 403);
  }
  const prototype = Object.getPrototypeOf(raw);
  const keys = Reflect.ownKeys(raw);
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== QUICK_ORDER_LIFECYCLE_ACTOR_FIELDS.size) {
    throw new LinkedApiDomainError("QuickOrder lifecycle 操作账号无效", 403);
  }
  const values: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== "string" || !QUICK_ORDER_LIFECYCLE_ACTOR_FIELDS.has(key)) {
      throw new LinkedApiDomainError("QuickOrder lifecycle 操作账号无效", 403);
    }
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor) || descriptor.value === undefined) {
      throw new LinkedApiDomainError("QuickOrder lifecycle 操作账号无效", 403);
    }
    values[key] = descriptor.value;
  }
  if (typeof values.id !== "string" || !values.id.trim()
    || typeof values.name !== "string" || !values.name.trim()
    || (values.role !== "superadmin" && values.role !== "frontdesk_admin"
      && values.role !== "finance" && values.role !== "mechanic")) {
    throw new LinkedApiDomainError("QuickOrder lifecycle 操作账号无效", 403);
  }
  const canonical = canonicalMockIdentitySnapshot(values.id);
  if (!canonical || canonical.name !== values.name || canonical.role !== values.role) {
    throw new LinkedApiDomainError("QuickOrder lifecycle 操作账号无权限", 403);
  }
  return { id: canonical.id, name: canonical.name, role: values.role };
}

function normalizeQuickOrderLifecycleActor(
  raw: unknown,
  kind: QuickOrderLifecycleKind,
): QuickOrderLifecycleActor {
  const actor = normalizeQuickOrderLifecycleActorIdentity(raw);
  if (!lifecycleRoleAllowed(kind, actor.role)) {
    throw new LinkedApiDomainError("QuickOrder lifecycle 操作账号无权限", 403);
  }
  return actor;
}

function assertQuickOrderLifecycleActorStillAuthorized(
  state: LinkedOperationsState,
  actor: QuickOrderLifecycleActor,
): void {
  if (!state.trustedIdentities.some((identity) => (
    identity.id === actor.id && identity.role === actor.role
  ))) {
    throw new LinkedApiDomainError("QuickOrder lifecycle 操作账号权限已变化，请重新登录", 403);
  }
}

function lifecycleCoordinate(order: QuickOrder): QuickOrderLifecycleCoordinate {
  return {
    status: order.status,
    voidedAt: order.voidedAt,
    voidedBy: order.voidedBy,
    voidReason: order.voidReason,
    paidInFullAt: order.paidInFullAt,
    paidInFullBy: order.paidInFullBy,
  };
}

function lifecycleEvent(
  order: QuickOrder,
  actor: QuickOrderLifecycleActor,
  committedAt: string,
  reason: string,
): QuickOrderLifecycleReceiptEvent {
  const byRole = actor.role === "mechanic" ? "mechanic" as const : "frontdesk" as const;
  const event: QuickBoStatusEvent = {
    id: `${order.id}-ev-${order.statusHistory.length + 1}`,
    from: order.status,
    to: order.status,
    by: actor.name,
    byRole,
    at: committedAt,
    reason,
  };
  (order.statusHistory as QuickBoStatusEvent[]).push(event);
  return {
    id: event.id,
    from: event.from,
    to: event.to,
    by: event.by,
    byRole,
    at: event.at,
    reason: event.reason ?? null,
  };
}

function isCurrentLifecycleCascadeVoid(
  order: QuickOrder,
  parentOrderId: string,
  cascadeReason: string,
): boolean {
  if (
    order.linkedOrderId !== parentOrderId
    || order.voidedAt === null
    || order.voidedBy === null
    || order.voidReason !== cascadeReason
  ) return false;
  const event = order.statusHistory.at(-1);
  return event !== undefined
    && event.reason === cascadeReason
    && event.at === order.voidedAt
    && event.by === order.voidedBy
    && event.from === order.status
    && event.to === order.status;
}

function projectQuickOrderLifecyclePublicResult(
  receiptResult: QuickOrderLifecycleReceiptResultV1 | QuickOrderLifecycleReceiptResultV2,
): QuickOrderLifecycleMutationResult {
  const publicResult = receiptResult.publicResult;
  if (publicResult.contract === "quick_order_lifecycle_mutation_result_v2") {
    assertQuickOrderLifecycleMutationResult(publicResult);
    return publicResult;
  }
  const projected: QuickOrderLifecycleMutationResult = {
    contract: "quick_order_lifecycle_mutation_result_v2",
    revision: publicResult.revision,
    kind: publicResult.kind,
    orderId: publicResult.orderId,
    affectedOrderIds: [...publicResult.affectedOrderIds],
    committedAt: publicResult.committedAt,
  };
  assertQuickOrderLifecycleMutationResult(projected);
  return projected;
}

export function getMockQuickOrderLifecyclePreflight(
  orderId: string,
  rawActor: unknown,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  readGuard?: () => void,
): QuickOrderLifecyclePreflight {
  if (typeof orderId !== "string" || orderId.trim().length === 0) {
    throw new LinkedApiDomainError("QuickOrder lifecycle orderId 无效", 400);
  }
  const actor = normalizeQuickOrderLifecycleActorIdentity(rawActor);
  const nowMs = store.nowMs();
  return store.read((state) => {
    readGuard?.();
    assertQuickOrderLifecycleActorStillAuthorized(state, actor);
    const financial = selectQuickOrderFinancialReadModel(state, orderId, nowMs);
    const allowedKinds = QUICK_ORDER_LIFECYCLE_KIND_ORDER.filter((kind) => {
      if (!lifecycleRoleAllowed(kind, actor.role)) return false;
      if (kind === "void") return financial.gates.canVoid;
      if (kind === "restore") return financial.order.voidedAt !== null;
      if (kind === "record_paid_full") return financial.gates.canRecordPaidFull;
      return financial.gates.canCancelPaidFull;
    });
    const result: QuickOrderLifecyclePreflight = {
      contract: "quick_order_lifecycle_preflight_v1",
      revision: state.revision,
      orderId,
      allowedKinds,
    };
    assertQuickOrderLifecyclePreflight(result);
    return result;
  }, "quickOrders.lifecycle.preflight.read");
}

/**
 * Closed, idempotent lifecycle writer. Financial eligibility and cascade
 * payment history are selected again from the locked canonical draft.
 */
export async function recordMockQuickOrderLifecycleMutation(
  rawInput: unknown,
  rawActor: unknown,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  requestGuard?: () => void,
): Promise<QuickOrderLifecycleMutationResult> {
  const input = normalizeQuickOrderLifecycleInput(rawInput);
  const actor = normalizeQuickOrderLifecycleActor(rawActor, input.kind);
  const committedAt = new Date(store.nowMs()).toISOString();
  const operation = `quickOrders.lifecycle.${input.kind}`;
  const committed = await store.mutateIdempotently<
    QuickOrderLifecycleReceiptResultV1 | QuickOrderLifecycleReceiptResultV2
  >({
    mutationId: input.mutationId,
    operation,
    actorId: actor.id,
    payload: input,
    recordedAt: committedAt,
  }, (state) => {
    assertQuickOrderLifecycleActorStillAuthorized(state, actor);
    if (state.revision !== input.expectedRevision) {
      throw new LinkedApiDomainError("收费工作区 revision 已变化，请刷新", 409);
    }
    // The strict selector establishes a unique target and validates its full
    // relevant financial owner chain before any draft field is changed.
    const financialBefore = selectQuickOrderFinancialReadModel(state, input.orderId, Date.parse(committedAt));
    const target = MUTABLE(mustFind(state, input.orderId));
    const cascadeReason = `关联单废除（原单 ${target.businessOrderNo}）`;
    let affectedOrderIds: string[];
    if (input.kind === "void") {
      if (target.voidedAt) throw new LinkedApiDomainError("本单已废除", 400);
      if (!financialBefore.gates.canVoid) {
        throw new LinkedApiDomainError("本单或关联单已有付款记录，不能作废；请走退款/对冲处理", 400);
      }
      affectedOrderIds = state.quickOrders.filter((order) => (
        order.id === target.id || (order.linkedOrderId === target.id && order.voidedAt === null)
      )).map((order) => order.id);
    } else if (input.kind === "restore") {
      if (!target.voidedAt) throw new LinkedApiDomainError("本单未废除", 400);
      const latestVoidFacts = latestReceiptBackedQuickOrderVoidLifecycleFacts(state);
      affectedOrderIds = state.quickOrders.filter((order) => (
        order.id === target.id
        || (() => {
          const latestFact = latestVoidFacts.get(order.id);
          if (latestFact === undefined) {
            return isCurrentLifecycleCascadeVoid(order, target.id, cascadeReason);
          }
          return latestFact.kind === "void"
            && latestFact.targetOrderId === target.id
            && latestFact.after.voidedAt === order.voidedAt
            && latestFact.after.voidedBy === order.voidedBy
            && latestFact.after.voidReason === order.voidReason;
        })()
      )).map((order) => order.id);
    } else {
      affectedOrderIds = [target.id];
      if (input.kind === "record_paid_full" && !financialBefore.gates.canRecordPaidFull) {
        throw new LinkedApiDomainError(
          "当前财务来源未达到可记录付清状态（shared 需 canonical Invoice 已付且 settled）",
          400,
        );
      }
      if (input.kind === "cancel_paid_full" && !financialBefore.gates.canCancelPaidFull) {
        throw new LinkedApiDomainError("当前工单未处于可撤销付清标记的 submitted 状态", 400);
      }
    }

    const beforeById = new Map(affectedOrderIds.map((orderId) => {
      const order = mustFind(state, orderId);
      return [orderId, lifecycleCoordinate(order)] as const;
    }));
    const eventById = new Map<string, QuickOrderLifecycleReceiptEvent>();
    for (const orderId of affectedOrderIds) {
      const order = MUTABLE(mustFind(state, orderId));
      let eventReason: string;
      if (input.kind === "void") {
        const isTarget = order.id === target.id;
        order.voidedAt = committedAt;
        order.voidedBy = actor.name;
        order.voidReason = isTarget ? input.reason.trim() : cascadeReason;
        eventReason = isTarget ? `废除本单：${input.reason.trim()}` : cascadeReason;
      } else if (input.kind === "restore") {
        const isTarget = order.id === target.id;
        order.voidedAt = null;
        order.voidedBy = null;
        order.voidReason = null;
        eventReason = isTarget ? "恢复本单" : "恢复本单（随原单恢复）";
      } else if (input.kind === "record_paid_full") {
        order.paidInFullAt = committedAt;
        order.paidInFullBy = actor.name;
        eventReason = "记录付完全款";
      } else {
        order.paidInFullAt = null;
        order.paidInFullBy = null;
        eventReason = "撤销付完全款记录";
      }
      eventById.set(orderId, lifecycleEvent(order, actor, committedAt, eventReason));
    }
    state.revision += 1;
    const changes = affectedOrderIds.map((orderId): QuickOrderLifecycleReceiptChange => {
      const order = mustFind(state, orderId);
      return {
        orderId,
        before: beforeById.get(orderId)!,
        after: lifecycleCoordinate(order),
        event: eventById.get(orderId)!,
      };
    });
    const financialSnapshot = selectQuickOrderFinancialReadModel(
      state,
      input.orderId,
      Date.parse(committedAt),
    );
    const publicResult: QuickOrderLifecycleMutationResult = {
      contract: "quick_order_lifecycle_mutation_result_v2",
      revision: state.revision,
      kind: input.kind,
      orderId: input.orderId,
      affectedOrderIds,
      committedAt,
    };
    assertQuickOrderLifecycleMutationResult(publicResult);
    return {
      receiptContract: "quick_order_lifecycle_receipt_v2",
      actor,
      changes,
      financialSnapshot,
      publicResult,
    };
  }, {
    action: `${operation}.write`,
    preReceiptGuard: (state) => {
      requestGuard?.();
      assertQuickOrderLifecycleActorStillAuthorized(state, actor);
    },
  });
  store.read(() => null, `${operation}.response`);
  return projectQuickOrderLifecyclePublicResult(committed.result);
}

export async function applyMockQuickOrderAction(
  orderId: string,
  action: QuickOrderAction,
  actorName: string,
  actorRole: "frontdesk" | "mechanic",
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  if (([
    "record_pickup",
    "cancel_pickup",
    "record_paid_full",
    "cancel_paid_full",
    "void",
    "restore",
  ] as ReadonlyArray<string>).includes(action.kind)) {
    throw new LinkedApiDomainError(
      QUICK_ORDER_LIFECYCLE_KINDS.has(action.kind)
        ? "QuickOrder lifecycle 动作已退休；请使用 quick_order_lifecycle_mutation_v1 contract"
        : "QuickOrder 取车动作已退休；请使用 canonical parking pickup contract",
      410,
    );
  }
  return store.mutate((state) => {
    const order = MUTABLE(mustFind(state, orderId));
    const actionNowMs = store.nowMs();
    const now = new Date(actionNowMs).toISOString();
    const events = order.statusHistory as QuickBoStatusEvent[];
    const pushEvent = (from: QuickBoStatus | null, to: QuickBoStatus, reason?: string) => {
      events.push({
        id: `${orderId}-ev-${events.length + 1}`,
        from,
        to,
        by: actorName,
        byRole: actorRole,
        at: now,
        reason: reason?.trim() || undefined,
      });
    };
    const fail = (msg: string): never => { throw new LinkedApiDomainError(msg, 400); };
    // 废除单：除了恢复，一切操作都被拦（所有数据无效）
    if (order.voidedAt && action.kind !== "restore") {
      fail("本单已废除（" + (order.voidReason ?? "无原因") + "），先恢复才能继续操作");
    }

    switch (action.kind) {
      case "assign": {
        // 待派单→已派单；交单前（assigned/in_repair/stalled/returned）可随时改派班组
        if (order.status === "submitted") fail("已交单，不能再改派班组");
        if (!teamById(action.teamId)) fail("班组不存在，请先在基础字典中新增班组");
        const from = order.status;
        const previousTeamId = order.teamId;
        order.teamId = action.teamId;
        if (action.mechanicName?.trim()) {
          order.mechanicName = action.mechanicName.trim();
        } else if (previousTeamId !== action.teamId) {
          order.mechanicName = null;
        }
        if (action.etaDays !== undefined) {
          if (!Number.isInteger(action.etaDays) || action.etaDays < 1 || action.etaDays > 90) fail("预计工期必须是 1~90 天的整数");
          order.etaDays = action.etaDays;
        }
        if (order.status === "pending_assign") {
          order.status = "assigned";
          order.assignedAt = now;
        }
        pushEvent(from, order.status, from === "pending_assign" ? undefined : `改派班组`);
        break;
      }
      case "start_aftersales_round": {
        if (actorRole !== "frontdesk") fail("只有超级管理员或前台可以开始售后维修轮次");
        if (order.status !== "submitted") fail("只有已交单的 Business Order 才能开始售后维修轮次");
        if (!action.reason.trim()) fail("请填写售后回厂原因");
        const priorSubmittedEvents = events.filter((event) => event.to === "submitted");
        const previousSubmission = priorSubmittedEvents.at(-1) as (QuickBoStatusEvent & {
          teamId?: string | null;
          performanceValueJmd?: number;
          roundNumber?: number;
        }) | undefined;
        if (!order.teamId || !order.assignedAt || !order.acceptedAt || !order.returnedAt || !order.submittedAt
          || !previousSubmission || previousSubmission.cancelledAt !== undefined
          || previousSubmission.teamId !== order.teamId
          || previousSubmission.performanceValueJmd !== order.performanceValueJmd
          || previousSubmission.at !== order.submittedAt) {
          fail("上一轮没有完整的维修班组、派单、接单、回单和交单事实，不能开始下一轮");
        }
        const nextRound = priorSubmittedEvents.length + 1;
        order.status = "pending_assign";
        order.teamId = null;
        order.mechanicName = null;
        order.assignedAt = null;
        order.acceptedAt = null;
        order.returnedAt = null;
        order.submittedAt = null;
        order.submittedBy = null;
        order.stallReason = null;
        order.etaDays = null;
        order.performanceValueJmd = 0;
        pushEvent("submitted", "pending_assign", `售后回厂第 ${nextRound} 轮：${action.reason.trim()}`);
        const startedEvent = events.at(-1) as (QuickBoStatusEvent & { roundNumber?: number });
        startedEvent.roundNumber = nextRound;
        break;
      }
      case "accept": {
        if (order.status !== "assigned") fail("只有已派单的单才能接车接单");
        order.status = "in_repair";
        order.acceptedAt = now;
        if (action.mechanicName?.trim()) order.mechanicName = action.mechanicName.trim();
        if (action.etaDays !== undefined) {
          if (!Number.isInteger(action.etaDays) || action.etaDays < 1 || action.etaDays > 90) fail("预计工期必须是 1~90 天的整数");
          order.etaDays = action.etaDays;
        }
        // 入场里程：维修工接车时记录（每单开始前）；可后补，不硬拦
        if (action.startMileageKm !== undefined) {
          if (!Number.isSafeInteger(action.startMileageKm) || action.startMileageKm < 0) fail("里程必须是非负整数");
          order.startMileageKm = action.startMileageKm;
          order.startMileageRecordedAt = now;
          order.startMileageRecordedBy = actorName;
        }
        pushEvent("assigned", "in_repair");
        break;
      }
      case "return": {
        if (order.status !== "in_repair") fail("只有维修中的单才能回单");
        order.status = "returned";
        order.returnedAt = now;
        pushEvent("in_repair", "returned");
        break;
      }
      case "stall": {
        if (order.status !== "in_repair" && order.status !== "returned") fail("只有接单后、交单前才能标停滞");
        if (!action.reason?.trim()) fail("停滞必须填原因");
        const from = order.status;
        order.status = "stalled";
        order.stallReason = action.reason.trim();
        pushEvent(from, "stalled", action.reason);
        break;
      }
      case "resume": {
        if (order.status !== "stalled") fail("当前不在停滞状态");
        order.status = "in_repair";
        order.stallReason = null;
        pushEvent("stalled", "in_repair", action.reason);
        break;
      }
      case "submit": {
        // 交单：前台核对绩效值（可改记操作人）+ 施工班组（可改派）；交单时间定绩效归属月
        if (order.status !== "returned") fail("只有回单待审核的单才能交单");
        if (action.teamId && action.teamId !== order.teamId) {
          if (!teamById(action.teamId)) fail("班组不存在（请在基础字典中维护维修班组）");
          order.teamId = action.teamId;
        }
        if (!order.teamId) fail("正式交单前必须选择维修班组；没有班组就没有绩效归属");
        const isLaterRepairRound = events.some((event) => event.from === "submitted" && event.to === "pending_assign");
        if (action.performanceValueJmd !== undefined && action.performanceValueJmd !== order.performanceValueJmd) {
          if (!Number.isSafeInteger(action.performanceValueJmd) || (!isLaterRepairRound && action.performanceValueJmd < 0)) {
            fail(isLaterRepairRound ? "本轮绩效值必须是安全整数" : "首轮绩效值必须是非负整数");
          }
          (order.performanceAdjusts as QuickOrder["performanceAdjusts"][number][]).push({
            id: `${orderId}-perf-${order.performanceAdjusts.length + 1}`,
            beforeJmd: order.performanceValueJmd,
            afterJmd: action.performanceValueJmd,
            by: actorName,
            at: now,
          });
          order.performanceValueJmd = action.performanceValueJmd;
        }
        order.status = "submitted";
        order.submittedAt = now;
        order.submittedBy = actorName;
        pushEvent("returned", "submitted");
        const submissionEvents = events.filter((event) => event.to === "submitted");
        const submittedEvent = events.at(-1) as (QuickBoStatusEvent & {
          roundNumber?: number;
          teamId?: string | null;
          performanceValueJmd?: number;
        });
        submittedEvent.roundNumber = Math.max(1, submissionEvents.length);
        submittedEvent.teamId = order.teamId;
        submittedEvent.performanceValueJmd = order.performanceValueJmd;
        break;
      }
      case "record_mileage": {
        if (!Number.isSafeInteger(action.startMileageKm) || action.startMileageKm < 0) fail("里程必须是非负整数");
        const mileageVerb = order.startMileageKm === null ? "记录" : "修改";
        order.startMileageKm = action.startMileageKm;
        order.startMileageRecordedAt = now;
        order.startMileageRecordedBy = actorName;
        pushEvent(order.status, order.status, `${mileageVerb}接车里程 ${action.startMileageKm} km`);
        break;
      }
      case "unsubmit": {
        // 当月可取消交单：审计记录保留，但该次交单事实从绩效统计中撤销。
        if (order.status !== "submitted") fail("只有已交单才能取消交单");
        if (!action.reason?.trim()) fail("取消交单必须填原因");
        const submittedAt = order.submittedAt ?? fail("本单没有交单时间，无法取消");
        const monthKey = (iso: string) => jamaicaMonthKey(iso);
        if (monthKey(submittedAt) !== monthKey(now)) fail("已跨月，不能取消交单；如车辆售后回厂，请在原 Business Order 开始下一维修轮次");
        if (order.pickedUpAt || order.paidInFullAt) fail("已记录取车/付完全款，不能取消交单；先撤销取车/付款记录");
        order.status = "returned";
        order.returnedAt = submittedAt;
        order.submittedAt = null;
        order.submittedBy = null;
        const cancelledSubmission = [...events].reverse().find((event) => event.to === "submitted" && event.cancelledAt === undefined) as (QuickBoStatusEvent & { cancelledAt?: string }) | undefined;
        if (cancelledSubmission) cancelledSubmission.cancelledAt = now;
        pushEvent("submitted", "returned", `取消交单：${action.reason.trim()}`);
        break;
      }
      case "rollback": {
        if (!action.reason?.trim()) fail("回退必须填原因");
        const from = order.status;
        if (from === "pending_assign") fail("待派单已是起点，无法回退");
        // 停滞 → 回维修中；其余沿主链退一步
        const to: QuickBoStatus = from === "stalled" ? "in_repair" : QUICK_BO_MAIN_FLOW[quickBoFlowIndex(from) - 1];
        order.status = to;
        if (to === "pending_assign") { order.assignedAt = null; }
        if (from === "stalled") order.stallReason = null;
        if (from === "submitted") { order.submittedAt = null; order.submittedBy = null; }
        if (from === "returned") order.returnedAt = null;
        if (from === "in_repair" || (from === "stalled" && to === "assigned")) order.acceptedAt = from === "in_repair" && to === "assigned" ? null : order.acceptedAt;
        pushEvent(from, to, action.reason);
        break;
      }
      case "adjust": {
        if (!action.reason?.trim()) fail("调整状态必须填原因");
        if (action.to === order.status) fail("状态未变化");
        const from = order.status;
        order.status = action.to;
        if (action.to !== "stalled") order.stallReason = null;
        pushEvent(from, action.to, action.reason);
        break;
      }
      case "set_performance": {
        // 绩效值：独立指标，默认=工时合计（配件不算）；未交单随时可改，记操作人（8/18 老板）
        if (order.status === "submitted") fail("已交单绩效已计入月份，不能改；当月可先取消交单再改");
        if (order.orderKind !== "normal") fail("只有普通工单能改绩效值（售后单为 0、对冲单为负扣回值）");
        const isLaterRepairRound = events.some((event) => event.from === "submitted" && event.to === "pending_assign");
        if (!Number.isSafeInteger(action.performanceValueJmd) || (!isLaterRepairRound && action.performanceValueJmd < 0)) {
          fail(isLaterRepairRound ? "本轮绩效值必须是安全整数" : "首轮绩效值必须是非负整数");
        }
        (order.performanceAdjusts as QuickOrder["performanceAdjusts"][number][]).push({
          id: `${orderId}-perf-${order.performanceAdjusts.length + 1}`,
          beforeJmd: order.performanceValueJmd,
          afterJmd: action.performanceValueJmd,
          by: actorName,
          at: now,
        });
        order.performanceValueJmd = action.performanceValueJmd;
        pushEvent(order.status, order.status, `调整绩效值为 ${action.performanceValueJmd} JMD`);
        break;
      }
      case "record_paid_full": {
        // 最终完结三件事之一：付完全款（8/18 老板）
        if (order.status !== "submitted") fail("只有已交单才能记录付完全款");
        if (order.paidInFullAt) fail("本单已记录付完全款");
        const financial = selectQuickOrderFinancialReadModel(state, orderId, actionNowMs);
        if (!financial.gates.canRecordPaidFull) {
          fail("当前财务来源未达到可记录付清状态（shared 需 canonical Invoice 已付且 settled）");
        }
        order.paidInFullAt = now;
        order.paidInFullBy = actorName;
        pushEvent("submitted", "submitted", "记录付完全款");
        break;
      }
      case "cancel_paid_full": {
        if (order.status !== "submitted") fail("只有已交单才能撤销付完全款记录");
        if (!order.paidInFullAt) fail("本单未记录付完全款");
        const financial = selectQuickOrderFinancialReadModel(state, orderId, actionNowMs);
        if (!financial.gates.canCancelPaidFull) {
          fail("当前工单未处于可撤销付清标记的 submitted 状态");
        }
        order.paidInFullAt = null;
        order.paidInFullBy = null;
        pushEvent("submitted", "submitted", "撤销付完全款记录");
        break;
      }
      case "void": {
        // 作废（8/18 老板）：不删除；本单所有数据无效、不参与计算；关联单（售后/对冲）一并作废；可恢复
        if (order.voidedAt) fail("本单已作废");
        if (!action.reason?.trim()) fail("作废必须填原因");
        // 资金门槛在同一 locked draft 内重选，覆盖本单与将被联动作废的全部直接关联单。
        const financial = selectQuickOrderFinancialReadModel(state, orderId, actionNowMs);
        if (!financial.gates.canVoid) {
          fail("本单或关联单已有付款记录，不能作废；请走退款/对冲处理");
        }
        order.voidedAt = now;
        order.voidedBy = actorName;
        order.voidReason = action.reason.trim();
        pushEvent(order.status, order.status, `废除本单：${action.reason.trim()}`);
        const cascadeReason = `关联单废除（原单 ${order.businessOrderNo}）`;
        for (const other of state.quickOrders as QuickOrder[]) {
          if (other.id === order.id || other.linkedOrderId !== order.id || other.voidedAt) continue;
          const mutable = MUTABLE(other);
          mutable.voidedAt = now;
          mutable.voidedBy = actorName;
          mutable.voidReason = cascadeReason;
          (mutable.statusHistory as QuickBoStatusEvent[]).push({
            id: `${other.id}-ev-${other.statusHistory.length + 1}`,
            from: other.status,
            to: other.status,
            by: actorName,
            byRole: actorRole,
            at: now,
            reason: cascadeReason,
          });
        }
        break;
      }
      case "restore": {
        // 恢复：本单恢复；被本单联动废除的关联单一并恢复
        if (!order.voidedAt) fail("本单未废除");
        order.voidedAt = null;
        order.voidedBy = null;
        order.voidReason = null;
        pushEvent(order.status, order.status, "恢复本单");
        const cascadeReason = `关联单废除（原单 ${order.businessOrderNo}）`;
        for (const other of state.quickOrders as QuickOrder[]) {
          if (other.id === order.id || other.linkedOrderId !== order.id) continue;
          if (!other.voidedAt || other.voidReason !== cascadeReason) continue;
          const mutable = MUTABLE(other);
          mutable.voidedAt = null;
          mutable.voidedBy = null;
          mutable.voidReason = null;
          (mutable.statusHistory as QuickBoStatusEvent[]).push({
            id: `${other.id}-ev-${other.statusHistory.length + 1}`,
            from: other.status,
            to: other.status,
            by: actorName,
            byRole: actorRole,
            at: now,
            reason: "恢复本单（随原单恢复）",
          });
        }
        break;
      }
    }
    state.revision += 1;
    return cloneOrder(order);
  }, { action: `quickOrders.${action.kind}.write` });
}

// ---------------------------------------------------------------------------
// 内容修订（收费项目/自然语言/备注）
// ---------------------------------------------------------------------------

export interface UpdateQuickOrderInput {
  rawInput: string;
  noteZh?: string;
  noteEn?: string;
  items: ReadonlyArray<Omit<QuickOrderItem, "id" | "unit"> & { unit?: string }>;
  /** 整单工时优惠（8/18 老板：与配件优惠分开）。 */
  laborDiscountJmd?: number;
  /** 整单配件优惠。 */
  partsDiscountJmd?: number;
  note?: string;
}

export interface UpdateQuickOrderNotesInput {
  readonly orderId: string;
  readonly expectedEditCount: number;
  readonly mutationId: string;
  readonly noteZh: string;
  readonly noteEn: string;
}

export type UpdateSharedQuickOrderChargeLineInput =
  | (Omit<UnitPricedChargeLine, "id" | "sourceId"> & { readonly id?: string })
  | (Omit<FixedTotalChargeLine, "id" | "sourceId"> & { readonly id?: string });

export interface UpdateSharedQuickOrderChargesInput {
  readonly orderId: string;
  readonly expectedEditCount: number;
  readonly mutationId: string;
  readonly lines: ReadonlyArray<UpdateSharedQuickOrderChargeLineInput>;
  readonly signature?: {
    readonly rawStrokes: DiscountApprovalEvidence["rawStrokes"];
  };
}

const SHARED_UPDATE_FIELDS = new Set(["orderId", "expectedEditCount", "mutationId", "lines", "signature"]);
const SHARED_UPDATE_SIGNATURE_FIELDS = new Set(["rawStrokes"]);
const SHARED_UPDATE_UNIT_FIELDS = new Set([
  "id", "category", "pricingMode", "descZh", "descEn", "remarkZh", "remarkEn",
  "unit", "unitEn", "quantity", "unitPriceJmd", "unitDiscountJmd", "pendingQuote",
]);
const SHARED_UPDATE_FIXED_FIELDS = new Set([
  "id", "category", "pricingMode", "code", "descZh", "descEn", "remarkZh", "remarkEn", "amountJmd",
]);
const SHARED_NOTES_FIELDS = new Set(["orderId", "expectedEditCount", "mutationId", "noteZh", "noteEn"]);

function assertSharedUpdateClosed(value: unknown, fields: ReadonlySet<string>, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LinkedApiDomainError(`${label}无效`, 400);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !fields.has(key)) {
      throw new LinkedApiDomainError(`${label}包含不允许的字段：${String(key)}`, 400);
    }
  }
}

function normalizeSharedUpdateLine(line: UpdateSharedQuickOrderChargeLineInput): UpdateSharedQuickOrderChargeLineInput {
  if (line === null || typeof line !== "object" || Array.isArray(line)) {
    throw new LinkedApiDomainError("业务单收费行无效", 400);
  }
  assertSharedUpdateClosed(
    line,
    line.pricingMode === "unit" ? SHARED_UPDATE_UNIT_FIELDS : SHARED_UPDATE_FIXED_FIELDS,
    "业务单收费行",
  );
  if (Object.prototype.hasOwnProperty.call(line, "id") && (typeof line.id !== "string" || !line.id.trim())) {
    throw new LinkedApiDomainError("业务单收费行 ID 无效", 400);
  }
  const id = line.id?.trim();
  if (line.pricingMode === "unit") {
    const candidate: UnitPricedChargeLine = {
      id: id ?? "new-shared-charge-validation-placeholder",
      category: line.category,
      pricingMode: "unit",
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      unit: line.unit,
      unitEn: line.unitEn,
      quantity: line.quantity,
      unitPriceJmd: line.unitPriceJmd,
      unitDiscountJmd: line.unitDiscountJmd,
      pendingQuote: line.pendingQuote,
    };
    try {
      validateQuotedChargeLine(candidate);
    } catch (error) {
      throw new LinkedApiDomainError(error instanceof Error ? error.message : "业务单收费行无效", 400);
    }
    if (candidate.category === "labor" && candidate.pendingQuote) {
      throw new LinkedApiDomainError("只有配件可以标记待报价", 400);
    }
    if (candidate.pendingQuote && candidate.unitPriceJmd !== 0) {
      throw new LinkedApiDomainError("待报价配件不能携带未确认价格", 400);
    }
    const normalized = {
      ...(id ? { id } : {}),
      category: candidate.category,
      pricingMode: "unit" as const,
      descZh: candidate.descZh.trim(),
      descEn: candidate.descEn.trim(),
      remarkZh: candidate.remarkZh.trim(),
      remarkEn: candidate.remarkEn.trim(),
      unit: candidate.unit.trim(),
      unitEn: candidate.unitEn.trim(),
      quantity: candidate.quantity,
      unitPriceJmd: candidate.unitPriceJmd,
      unitDiscountJmd: candidate.unitDiscountJmd,
      pendingQuote: candidate.pendingQuote,
    };
    return normalized;
  }
  if (line.pricingMode !== "fixed_total") {
    throw new LinkedApiDomainError("业务单不允许停车或未知计价模式", 400);
  }
  const candidate: FixedTotalChargeLine = {
    id: id ?? "new-shared-charge-validation-placeholder",
    category: line.category,
    pricingMode: "fixed_total",
    code: line.code,
    descZh: line.descZh,
    descEn: line.descEn,
    remarkZh: line.remarkZh,
    remarkEn: line.remarkEn,
    amountJmd: line.amountJmd,
  };
  try {
    validateQuotedChargeLine(candidate);
  } catch (error) {
    throw new LinkedApiDomainError(error instanceof Error ? error.message : "其他费用收费行无效", 400);
  }
  return {
    ...(id ? { id } : {}),
    category: "other_service",
    pricingMode: "fixed_total",
    code: candidate.code,
    descZh: candidate.descZh.trim(),
    descEn: candidate.descEn.trim(),
    remarkZh: candidate.remarkZh.trim(),
    remarkEn: candidate.remarkEn.trim(),
    amountJmd: candidate.amountJmd,
  };
}

function normalizeSharedQuickOrderUpdateInput(input: UpdateSharedQuickOrderChargesInput): UpdateSharedQuickOrderChargesInput {
  assertSharedUpdateClosed(input, SHARED_UPDATE_FIELDS, "shared 业务单收费修改请求");
  if (typeof input.orderId !== "string" || !input.orderId.trim()) throw new LinkedApiDomainError("业务单 ID 无效", 400);
  if (!Number.isSafeInteger(input.expectedEditCount) || input.expectedEditCount < 0) throw new LinkedApiDomainError("业务单编辑版本无效", 400);
  if (typeof input.mutationId !== "string" || !input.mutationId.trim()) throw new LinkedApiDomainError("mutationId 无效", 400);
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new LinkedApiDomainError("至少一条收费项目", 400);
  const lines = input.lines.map(normalizeSharedUpdateLine);
  const submittedIds = lines.flatMap((line) => line.id ? [line.id] : []);
  if (new Set(submittedIds).size !== submittedIds.length) throw new LinkedApiDomainError("业务单收费行 ID 重复", 400);
  if (input.signature !== undefined) {
    assertSharedUpdateClosed(input.signature, SHARED_UPDATE_SIGNATURE_FIELDS, "业务单优惠签字");
    if (!Array.isArray(input.signature.rawStrokes)) throw new LinkedApiDomainError("业务单优惠签字笔迹无效", 400);
  }
  return {
    orderId: input.orderId.trim(),
    expectedEditCount: input.expectedEditCount,
    mutationId: input.mutationId.trim(),
    lines,
    ...(input.signature ? { signature: { rawStrokes: structuredClone(input.signature.rawStrokes) } } : {}),
  };
}

function sharedUpdateJamaicaInstant(nowMs: number): string {
  const localClock = new Date(nowMs - 5 * 60 * 60 * 1_000).toISOString();
  return `${localClock.slice(0, -1)}-05:00`;
}

function normalizeSharedUpdateActor(actor: SharedQuickOrderMutationActor): SharedQuickOrderMutationActor {
  if (!actor || typeof actor !== "object" || typeof actor.id !== "string" || !actor.id.trim()
    || typeof actor.name !== "string" || !actor.name.trim()
    || (actor.role !== "superadmin" && actor.role !== "frontdesk_admin")) {
    throw new LinkedApiDomainError("业务单操作账号无效", 403);
  }
  return { id: actor.id.trim(), name: actor.name.trim(), role: actor.role };
}

function nextSharedUpdateLineId(orderId: string, occupied: Set<string>): string {
  const prefix = `${orderId}-charge-`;
  let highWater = 0;
  for (const id of occupied) {
    if (!id.startsWith(prefix)) continue;
    const suffix = id.slice(prefix.length);
    if (/^(0|[1-9]\d*)$/u.test(suffix)) highWater = Math.max(highWater, Number(suffix));
  }
  for (let sequence = highWater + 1; sequence <= 999_999; sequence += 1) {
    const candidate = `${prefix}${sequence}`;
    if (!occupied.has(candidate)) {
      occupied.add(candidate);
      return candidate;
    }
  }
  throw new LinkedApiDomainError("业务单收费行 ID 序列已耗尽", 409);
}

function sharedThresholdMoneyChanged(
  before: ReadonlyArray<QuickOrderChargeLine>,
  after: ReadonlyArray<QuickOrderChargeLine>,
): boolean {
  const previous = calculateQuotedChargeTotals(before);
  const next = calculateQuotedChargeTotals(after);
  return previous.laborGrossJmd !== next.laborGrossJmd
    || previous.laborDiscountJmd !== next.laborDiscountJmd
    || previous.partsGrossJmd !== next.partsGrossJmd
    || previous.partsDiscountJmd !== next.partsDiscountJmd;
}

/** Locked and idempotent canonical edit path for shared-charge Quick BOs. */
export async function updateMockSharedQuickOrderCharges(
  rawInput: UpdateSharedQuickOrderChargesInput,
  actor: SharedQuickOrderMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  const input = normalizeSharedQuickOrderUpdateInput(rawInput);
  const normalizedActor = normalizeSharedUpdateActor(actor);
  const recordedAt = sharedUpdateJamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<QuickOrder>({
    mutationId: input.mutationId,
    operation: "quickOrders.sharedCharges.update",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, (state) => {
    const found = mustFind(state, input.orderId);
    if (!isSharedChargeQuickOrder(found)) throw new LinkedApiDomainError("该业务单不是 shared 收费契约", 409);
    if (found.voidedAt) throw new LinkedApiDomainError("本单已废除，不能改收费项目；先恢复", 400);
    if (found.status === "submitted") throw new LinkedApiDomainError("已交单不能直接改收费项目", 400);
    if (found.editHistory.length !== input.expectedEditCount) throw new LinkedApiDomainError("业务单内容已变化，请刷新", 409);
    const previousIds = new Set(found.chargeLines.map((line) => line.id));
    const allOccupied = new Set(state.quickOrders.flatMap((order) => [
      ...order.items.map((item) => item.id),
      ...(order.chargeLines ?? []).map((line) => line.id),
    ]));
    // Successful mutation receipts retain prior canonical BO snapshots, so a
    // deleted charge ID stays reserved across later edits and reloads.
    for (const receipt of state.mutationReceipts) {
      const result = receipt.result as { chargeLines?: unknown } | null;
      if (!result || !Array.isArray(result.chargeLines)) continue;
      for (const line of result.chargeLines) {
        if (line && typeof line === "object" && typeof (line as { id?: unknown }).id === "string") {
          allOccupied.add((line as { id: string }).id);
        }
      }
    }
    const nextLines = input.lines.map((line): QuickOrderChargeLine => {
      if (line.id && !previousIds.has(line.id)) throw new LinkedApiDomainError("收费行不属于当前业务单", 400);
      const id = line.id ?? nextSharedUpdateLineId(found.id, allOccupied);
      return copiedSharedChargeLine({ ...line, id } as QuickOrderChargeLine, id);
    });
    const requirement = discountApprovalRequirement(nextLines);
    const needsSignature = sharedThresholdMoneyChanged(found.chargeLines, nextLines) && requirement.required;
    if (!needsSignature && input.signature) {
      throw new LinkedApiDomainError("本次修改未改变超门槛的工时/配件优惠金额，不应提交业务单签字", 400);
    }
    let signatureEvidence: DiscountApprovalEvidence | null = null;
    if (input.signature) {
      signatureEvidence = {
        document: { kind: "business_order", id: found.id },
        operationAccount: { id: normalizedActor.id, name: normalizedActor.name },
        rawStrokes: input.signature.rawStrokes,
        signedAt: recordedAt,
        mutationId: input.mutationId,
        categoryRatios: { labor: requirement.labor, parts: requirement.parts },
      };
      try {
        validateDiscountApprovalEvidence(signatureEvidence);
      } catch (error) {
        throw new LinkedApiDomainError(error instanceof Error ? error.message : "业务单优惠签字笔迹无效", 400);
      }
    }
    if (needsSignature && !signatureEvidence) {
      throw new LinkedApiDomainError("修改后的业务单工时或配件优惠超过门槛，需要一份新的非空原始笔迹签字", 400);
    }
    if (needsSignature && signatureEvidence) {
      const digest = discountSignatureStrokeDigest(signatureEvidence.rawStrokes);
      if (state.discountSignatureEvents.some((event) => discountSignatureStrokeDigest(event.rawStrokes) === digest)) {
        throw new LinkedApiDomainError("该原始笔迹已被另一笔收费写入消费，请重新签字", 409);
      }
    }
    const order = MUTABLE(found as QuickOrder);
    order.chargeLines = nextLines;
    order.items = [];
    order.laborDiscountJmd = 0;
    order.partsDiscountJmd = 0;
    const totals = calculateQuotedChargeTotals(nextLines);
    if (order.orderKind === "normal" && order.performanceAdjusts.length === 0) {
      order.performanceValueJmd = totals.laborGrossJmd;
    }
    const editHistory = order.editHistory as QuickOrder["editHistory"][number][];
    editHistory.push({
      id: `${order.id}-edit-${editHistory.length + 1}`,
      by: normalizedActor.name,
      at: recordedAt,
      note: "修改 shared 收费项目",
    });
    if (needsSignature && signatureEvidence) state.discountSignatureEvents.push(signatureEvidence);
    state.revision += 1;
    return order;
  }, { action: "quickOrders.sharedCharges.update.write" });
  return committed.result;
}

/**
 * Shared-charge BOs cannot pass through the legacy item editor, but their
 * ordinary notes still need an independent edit/delete path that never
 * rewrites canonical charge facts.
 */
export async function updateMockQuickOrderNotes(
  rawInput: UpdateQuickOrderNotesInput,
  actor: SharedQuickOrderMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new LinkedApiDomainError("备注请求格式错误", 400);
  }
  assertSharedUpdateClosed(rawInput, SHARED_NOTES_FIELDS, "业务单备注请求");
  if (typeof rawInput.orderId !== "string" || !rawInput.orderId.trim()
    || !Number.isSafeInteger(rawInput.expectedEditCount) || rawInput.expectedEditCount < 0
    || typeof rawInput.mutationId !== "string" || !rawInput.mutationId.trim()
    || typeof rawInput.noteZh !== "string" || typeof rawInput.noteEn !== "string") {
    throw new LinkedApiDomainError("备注请求格式错误", 400);
  }
  const input = {
    orderId: rawInput.orderId.trim(),
    expectedEditCount: rawInput.expectedEditCount,
    mutationId: rawInput.mutationId.trim(),
    noteZh: rawInput.noteZh.trim(),
    noteEn: rawInput.noteEn.trim(),
  };
  const normalizedActor = normalizeSharedUpdateActor(actor);
  const recordedAt = sharedUpdateJamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<QuickOrder>({
    mutationId: input.mutationId,
    operation: "quickOrders.notes.update",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, (state) => {
    const found = mustFind(state, input.orderId);
    if (!isSharedChargeQuickOrder(found)) {
      throw new LinkedApiDomainError("旧版业务单请使用收费项目编辑器修改备注", 409);
    }
    const order = MUTABLE(found as QuickOrder);
    if (order.voidedAt) throw new LinkedApiDomainError("本单已废除，不能改备注；先恢复", 400);
    if (order.status === "submitted") throw new LinkedApiDomainError("已交单不能直接改备注", 400);
    if (found.editHistory.length !== input.expectedEditCount) throw new LinkedApiDomainError("业务单内容已变化，请刷新", 409);
    order.noteZh = input.noteZh || null;
    order.noteEn = input.noteEn || null;
    const editHistory = order.editHistory as QuickOrder["editHistory"][number][];
    editHistory.push({
      id: `${input.orderId}-edit-${editHistory.length + 1}`,
      by: normalizedActor.name,
      at: recordedAt,
      note: "修改业务单备注",
    });
    state.revision += 1;
    return cloneOrder(order);
  }, { action: "quickOrders.notes.update.write" });
  store.read(() => null, "quickOrders.notes.update.response");
  return committed.result;
}

export function updateMockQuickOrder(
  orderId: string,
  input: UpdateQuickOrderInput,
  actorName: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  return store.mutate((state) => {
    const order = MUTABLE(mustFind(state, orderId));
    if (isSharedChargeQuickOrder(order)) {
      throw new LinkedApiDomainError("检查结果创建的业务单暂不支持用旧版收费项目编辑器修改", 409);
    }
    if (order.voidedAt) throw new LinkedApiDomainError("本单已废除，不能改内容；先恢复", 400);
    if (order.status === "submitted") throw new LinkedApiDomainError("已交单不能直接改内容；当月可先取消交单再改", 400);
    if (!input.rawInput.trim()) throw new LinkedApiDomainError("自然语言原文不能为空", 400);
    if (input.items.length === 0) throw new LinkedApiDomainError("至少一条收费项目", 400);
    for (const item of input.items) {
      if (!item.descZh.trim()) throw new LinkedApiDomainError("收费项目描述不能为空", 400);
      if (!item.descEn.trim()) throw new LinkedApiDomainError("英文翻译不能为空（客户大多是英语母语）", 400);
      if (!Number.isSafeInteger(item.unitPriceJmd) || item.unitPriceJmd < 0) throw new LinkedApiDomainError("单价必须是非负整数", 400);
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new LinkedApiDomainError("数量必须大于 0", 400);
    }
    // 整单优惠：分工时/配件两个口径，各不能超过该类合计（8/18 老板）
    const laborTotal = input.items.filter((item) => item.category === "labor" && !item.pendingQuote).reduce((sum, item) => sum + item.unitPriceJmd * item.quantity, 0);
    const partsTotal = input.items.filter((item) => item.category === "parts" && !item.pendingQuote).reduce((sum, item) => sum + item.unitPriceJmd * item.quantity, 0);
    const laborDiscount = input.laborDiscountJmd ?? 0;
    const partsDiscount = input.partsDiscountJmd ?? 0;
    if (!Number.isSafeInteger(laborDiscount) || laborDiscount < 0 || !Number.isSafeInteger(partsDiscount) || partsDiscount < 0) throw new LinkedApiDomainError("优惠金额必须是非负整数", 400);
    if (laborDiscount > laborTotal) throw new LinkedApiDomainError("工时优惠不能超过工时合计", 400);
    if (partsDiscount > partsTotal) throw new LinkedApiDomainError("配件优惠不能超过配件合计", 400);
    const now = new Date(store.nowMs()).toISOString();
    const items: QuickOrderItem[] = input.items.map((item, index) => ({
      ...item,
      descZh: item.descZh.trim(),
      descEn: item.descEn.trim(),
      unit: item.unit?.trim() || (item.category === "labor" ? "工时" : "个"),
      id: `${orderId}-item-${Date.now()}-${index + 1}`,
    }));
    order.rawInput = input.rawInput.trim();
    order.items = items;
    order.noteZh = input.noteZh?.trim() || null;
    order.noteEn = input.noteEn?.trim() || null;
    if (input.laborDiscountJmd !== undefined) order.laborDiscountJmd = input.laborDiscountJmd;
    if (input.partsDiscountJmd !== undefined) order.partsDiscountJmd = input.partsDiscountJmd;
    // 绩效值默认 = 工时合计（配件不算，8/18 老板修正），除非前台手动调过（保留手动值）；售后/对冲单不随内容重算
    if (order.orderKind === "normal" && order.performanceAdjusts.length === 0) {
      order.performanceValueJmd = quickOrderTotals({ items }).laborJmd;
    }
    const editHistory = order.editHistory as QuickOrder["editHistory"][number][];
    editHistory.push({
      id: `${orderId}-edit-${editHistory.length + 1}`,
      by: actorName,
      at: now,
      note: input.note?.trim() || undefined,
    });
    state.revision += 1;
    return cloneOrder(order);
  }, { action: "quickOrders.update.write" });
}

// ---------------------------------------------------------------------------
// 收退款
// ---------------------------------------------------------------------------

function nextQuickPaymentReceiptNo(state: LinkedOperationsState, nowMs: number): string {
  const prefix = `KGN-WH-RCPT-${businessDateInJamaica(nowMs)}-`;
  let highWater = 0;
  for (const order of state.quickOrders) {
    for (const payment of order.payments) {
      const receiptNo = payment.receipt?.receiptNo;
      if (!receiptNo?.startsWith(prefix)) continue;
      const suffix = receiptNo.slice(prefix.length);
      if (/^[0-9]{5}$/u.test(suffix)) highWater = Math.max(highWater, Number(suffix));
    }
  }
  if (highWater >= 99_999) throw new LinkedApiDomainError("当日 Receipt 编号已用尽", 409);
  return `${prefix}${String(highWater + 1).padStart(5, "0")}`;
}

function quickPaymentReceiptLines(order: QuickOrder): QuickPaymentReceiptChargeLine[] {
  return quickOrderCanonicalChargeLines(order).map((line) => {
    if (line.pricingMode === "fixed_total") {
      return {
        id: line.id,
        category: "other_service",
        descZh: line.descZh,
        descEn: line.descEn,
        remarkZh: line.remarkZh,
        remarkEn: line.remarkEn,
        unit: null,
        unitEn: null,
        quantity: null,
        unitPriceJmd: null,
        discountJmd: 0,
        lineTotalJmd: line.amountJmd,
        pendingQuote: false,
      };
    }
    const lineGrossJmd = line.pendingQuote ? 0 : line.unitPriceJmd * line.quantity;
    const discountJmd = line.pendingQuote ? 0 : line.unitDiscountJmd * line.quantity;
    return {
      id: line.id,
      category: line.category,
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      unit: line.unit,
      unitEn: line.unitEn ?? "",
      quantity: line.quantity,
      unitPriceJmd: line.unitPriceJmd,
      discountJmd,
      lineTotalJmd: lineGrossJmd - discountJmd,
      pendingQuote: line.pendingQuote,
    };
  });
}

function buildQuickPaymentReceipt(
  state: LinkedOperationsState,
  order: QuickOrder,
  payment: Omit<QuickPayment, "receipt">,
  receiptNo: string,
  balanceAfterJmd: number,
): QuickPaymentReceiptSnapshot {
  const customer = state.customers.find((candidate) => candidate.id === order.customerId);
  const vehicle = state.vehicles.find((candidate) => candidate.id === order.vehicleId);
  if (!customer || !vehicle || vehicle.customerId !== customer.id) {
    throw new LinkedApiDomainError("Receipt 的客户或车辆档案无法唯一对应", 409);
  }
  const chargeLines = quickPaymentReceiptLines(order);
  const grossJmd = chargeLines.reduce((sum, line) => sum + line.lineTotalJmd + line.discountJmd, 0);
  const discountJmd = chargeLines.reduce((sum, line) => sum + line.discountJmd, 0);
  const receivableJmd = grossJmd - discountJmd;
  const history: QuickPaymentReceiptHistoryEntry[] = [
    ...order.payments.map((existing) => ({
      paymentId: existing.id,
      receiptNo: existing.receipt.receiptNo,
      amountJmd: existing.amountJmd,
      method: existing.method,
      receivedBy: existing.receivedBy,
      receivedAt: existing.receivedAt,
      note: existing.note ?? null,
    })),
    {
      paymentId: payment.id,
      receiptNo,
      amountJmd: payment.amountJmd,
      method: payment.method,
      receivedBy: payment.receivedBy,
      receivedAt: payment.receivedAt,
      note: payment.note ?? null,
    },
  ];
  const paidToDateJmd = history.reduce((sum, entry) => sum + entry.amountJmd, 0);
  const refundedToDateJmd = order.refunds.reduce((sum, refund) => sum + refund.amountJmd, 0);
  return {
    contract: "quick_payment_receipt_v1",
    receiptNo,
    paymentId: payment.id,
    businessOrderId: order.id,
    businessOrderNo: order.businessOrderNo,
    customer: {
      id: customer.id,
      nameZh: customer.nameZh,
      nameEn: customer.nameEn ?? "",
      phone: customer.phone,
    },
    vehicle: {
      id: vehicle.id,
      plate: vehicle.plate,
      modelZh: vehicle.modelZh ?? "",
      modelEn: vehicle.modelEn ?? "",
    },
    issuedAt: payment.receivedAt,
    issuedBy: payment.receivedBy,
    amountJmd: payment.amountJmd,
    method: payment.method,
    note: payment.note ?? null,
    businessNoteZh: order.noteZh,
    businessNoteEn: order.noteEn,
    chargeLines,
    grossJmd,
    discountJmd,
    receivableJmd,
    gctIncludedJmd: Math.round(receivableJmd * 15 / 115),
    paidToDateJmd,
    refundedToDateJmd,
    balanceAfterJmd,
    paymentHistory: history,
  };
}

export function recordMockQuickPayment(
  orderId: string,
  input: { amountJmd: number; method: QuickPayment["method"]; note?: string },
  actorName: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  return store.mutate((state) => {
    const order = MUTABLE(mustFind(state, orderId));
    if (order.voidedAt) throw new LinkedApiDomainError("本单已废除，不能收款；先恢复", 400);
    if (!Number.isSafeInteger(input.amountJmd) || input.amountJmd <= 0) throw new LinkedApiDomainError("收款金额必须大于 0", 400);
    const nowMs = store.nowMs();
    const finance = selectQuickOrderFinancialReadModel(state, orderId, nowMs).ledger;
    if (finance.balanceJmd <= 0) throw new LinkedApiDomainError("本单已付清，无需再收款", 400);
    if (input.amountJmd > finance.balanceJmd) throw new LinkedApiDomainError(`收款金额不能超过余额 ${finance.balanceJmd}`, 400);
    const payments = order.payments as QuickPayment[];
    const payment: Omit<QuickPayment, "receipt"> = {
      id: `${orderId}-pay-${payments.length + 1}`,
      amountJmd: input.amountJmd,
      method: input.method,
      receivedBy: actorName,
      receivedAt: new Date(nowMs).toISOString(),
      note: input.note?.trim() || undefined,
    };
    const receiptNo = nextQuickPaymentReceiptNo(state, nowMs);
    payments.push({
      ...payment,
      receipt: buildQuickPaymentReceipt(
        state,
        order,
        payment,
        receiptNo,
        finance.balanceJmd - input.amountJmd,
      ),
    });
    state.revision += 1;
    return cloneOrder(order);
  }, { action: "quickOrders.payment.write" });
}

export interface RecordQuickRefundInput {
  readonly amountJmd: number;
  readonly method: QuickRefundMethod;
  readonly reason: string;
  readonly originalDocumentStatus: QuickRefundOriginalDocumentStatus;
  readonly originalDocumentNote?: string | null;
  readonly signerName?: string;
  readonly signatureDataUrl?: string;
  readonly signatureFileName?: string;
}

function nextQuickRefundReceiptNo(state: LinkedOperationsState, nowMs: number): string {
  const prefix = `KGN-WH-RFD-${businessDateInJamaica(nowMs)}-`;
  let highWater = 0;
  for (const order of state.quickOrders) {
    for (const refund of order.refunds) {
      if (!refund.receiptNo.startsWith(prefix)) continue;
      const suffix = refund.receiptNo.slice(prefix.length);
      if (/^[0-9]{5}$/u.test(suffix)) highWater = Math.max(highWater, Number(suffix));
    }
  }
  if (highWater >= 99_999) throw new LinkedApiDomainError("当日退款说明单编号已用尽", 409);
  return `${prefix}${String(highWater + 1).padStart(5, "0")}`;
}

function validateQuickRefundEvidence(value: QuickRefundEvidence): QuickRefundEvidence {
  const allowed = new Set<QuickRefundEvidence["mimeType"]>([
    "image/jpeg", "image/png", "image/webp", "application/pdf",
  ]);
  if (!value || typeof value !== "object" || !value.fileName?.trim() || !allowed.has(value.mimeType)) {
    throw new LinkedApiDomainError("请上传 JPG、PNG、WebP 或 PDF 退款凭证", 400);
  }
  const expectedPrefix = value.mimeType === "application/pdf"
    ? "data:application/pdf;base64,"
    : `data:${value.mimeType};base64,`;
  if (!value.dataUrl?.startsWith(expectedPrefix) || value.dataUrl.length > 35_000_000) {
    throw new LinkedApiDomainError("退款凭证内容无效或超过 25 MB", 400);
  }
  return { fileName: value.fileName.trim(), mimeType: value.mimeType, dataUrl: value.dataUrl };
}

function buildQuickRefundDocument(
  state: LinkedOperationsState,
  order: QuickOrder,
  refund: Omit<QuickRefund, "document">,
  financeBefore: QuickOrderFinancialLedger,
): QuickRefundDocumentSnapshot {
  const customer = state.customers.find((candidate) => candidate.id === order.customerId);
  const vehicle = state.vehicles.find((candidate) => candidate.id === order.vehicleId);
  if (!customer || !vehicle || vehicle.customerId !== customer.id) {
    throw new LinkedApiDomainError("退款说明单的客户或车辆档案无法唯一对应", 409);
  }
  const refundedToDateJmd = financeBefore.cashRefundedJmd + refund.amountJmd;
  return {
    contract: "quick_refund_document_v1",
    refundId: refund.id,
    receiptNo: refund.receiptNo,
    businessOrderId: order.id,
    businessOrderNo: order.businessOrderNo,
    customer: {
      id: customer.id,
      nameZh: customer.nameZh,
      nameEn: customer.nameEn ?? "",
      phone: customer.phone,
    },
    vehicle: {
      id: vehicle.id,
      plate: vehicle.plate,
      modelZh: vehicle.modelZh ?? "",
      modelEn: vehicle.modelEn ?? "",
    },
    amountJmd: refund.amountJmd,
    method: refund.method,
    reason: refund.reason,
    originalDocumentStatus: refund.originalDocumentStatus,
    originalDocumentNote: refund.originalDocumentNote,
    proof: refund.proof,
    proofAttachedBy: refund.proofAttachedBy,
    proofAttachedAt: refund.proofAttachedAt,
    signature: refund.signature,
    refundedBy: refund.refundedBy,
    refundedAt: refund.refundedAt,
    receivableJmd: financeBefore.receivableJmd,
    paidToDateJmd: financeBefore.grossPaidJmd,
    refundedToDateJmd,
    balanceAfterJmd: financeBefore.balanceJmd + refund.amountJmd,
  };
}

export async function recordMockQuickRefund(
  orderId: string,
  input: RecordQuickRefundInput,
  actorName: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  return store.mutate((state) => {
    const order = MUTABLE(mustFind(state, orderId));
    if (order.voidedAt) throw new LinkedApiDomainError("本单已废除，不能退款；先恢复", 400);
    if (!Number.isSafeInteger(input.amountJmd) || input.amountJmd <= 0) throw new LinkedApiDomainError("退款金额必须大于 0", 400);
    if (!methodIsKnown(input.method)) throw new LinkedApiDomainError("退款方式不在字典里", 400);
    if (!input.reason.trim()) throw new LinkedApiDomainError("请填写退款原因", 400);
    if (!["returned", "unavailable", "not_issued"].includes(input.originalDocumentStatus)) {
      throw new LinkedApiDomainError("请选择原发票处理情况", 400);
    }
    const originalDocumentNote = input.originalDocumentNote?.trim() || null;
    if (input.originalDocumentStatus === "unavailable" && !originalDocumentNote) {
      throw new LinkedApiDomainError("原单无法交回时必须填写说明", 400);
    }
    const nowMs = store.nowMs();
    const now = new Date(nowMs).toISOString();
    const financeBefore = selectQuickOrderFinancialReadModel(state, orderId, nowMs).ledger;
    const refunds = order.refunds as QuickRefund[];
    const refundWithoutDocument: Omit<QuickRefund, "document"> = {
      contract: "quick_refund_v2",
      id: `${orderId}-ref-${refunds.length + 1}`,
      amountJmd: input.amountJmd,
      category: null,
      receiptNo: nextQuickRefundReceiptNo(state, nowMs),
      method: input.method,
      refundedBy: actorName,
      refundedAt: now,
      reason: input.reason.trim(),
      note: input.reason.trim(),
      originalDocumentStatus: input.originalDocumentStatus,
      originalDocumentNote,
      proof: null,
      proofAttachedBy: null,
      proofAttachedAt: null,
      signature: null,
    };
    refunds.push({
      ...refundWithoutDocument,
      document: buildQuickRefundDocument(state, order, refundWithoutDocument, financeBefore),
    });
    state.revision += 1;
    return cloneOrder(order);
  }, { action: "quickOrders.refund.write" });
}

export interface RecordQuickRefundEvidenceInput {
  readonly refundId: string;
  readonly proof: QuickRefundEvidence;
}

/** 退款先成立，款项实际退回后再把银行回单等证据追加到该笔退款。 */
export function attachMockQuickRefundEvidence(
  orderId: string,
  input: RecordQuickRefundEvidenceInput,
  actorName: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  return store.mutate((state) => {
    const order = MUTABLE(mustFind(state, orderId));
    const refund = order.refunds.find((candidate) => candidate.id === input.refundId) as QuickRefund | undefined;
    if (!refund) throw new LinkedApiDomainError("退款记录不存在", 404);
    if (refund.proof !== null) throw new LinkedApiDomainError("这笔退款已经上传凭证，不能覆盖", 409);
    const proof = validateQuickRefundEvidence(input.proof);
    const attachedAt = new Date(store.nowMs()).toISOString();
    Object.assign(refund, {
      proof,
      proofAttachedBy: actorName,
      proofAttachedAt: attachedAt,
      document: {
        ...refund.document,
        proof,
        proofAttachedBy: actorName,
        proofAttachedAt: attachedAt,
      },
    });
    state.revision += 1;
    return cloneOrder(order);
  }, { action: "quickOrders.refundEvidence.write" });
}

export interface RecordQuickRefundSignatureInput {
  readonly refundId: string;
  readonly signerName: string;
  readonly photoDataUrl: string;
  readonly photoFileName: string;
}

/** 退款落账后，可把客户已经手写签字的纸质签收单照片追加归档；已归档证据不可覆盖。 */
export function recordMockQuickRefundSignature(
  orderId: string,
  input: RecordQuickRefundSignatureInput,
  actorName: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  return store.mutate((state) => {
    const order = MUTABLE(mustFind(state, orderId));
    if (order.voidedAt) throw new LinkedApiDomainError("本单已废除，不能补退款签字；先恢复", 400);
    if (!input.signerName.trim()) throw new LinkedApiDomainError("请填写客户签字人姓名", 400);
    if (!input.photoDataUrl.startsWith("data:image/") || input.photoDataUrl.length > 2_500_000) {
      throw new LinkedApiDomainError("签字照片必须是图片数据，且不能太大", 400);
    }
    const refund = order.refunds.find((candidate) => candidate.id === input.refundId);
    if (!refund) throw new LinkedApiDomainError("退款记录不存在", 400);
    if (refund.signature) throw new LinkedApiDomainError("退款签收单已归档，不能覆盖", 409);
    const signature = {
      signerName: input.signerName.trim(),
      photoDataUrl: input.photoDataUrl,
      photoFileName: input.photoFileName.trim() || "refund-signed-acknowledgement.png",
      signedBy: actorName,
      signedAt: new Date(store.nowMs()).toISOString(),
    };
    Object.assign(refund, {
      signature,
      document: {
        ...refund.document,
        signature,
      },
    });
    state.revision += 1;
    return cloneOrder(order);
  }, { action: "quickOrders.refundSignature.write" });
}

// ---------------------------------------------------------------------------
// 取车通知（交单后此车无其他可执行 BO → 提醒前台发信）
// ---------------------------------------------------------------------------

/** 此车还有没有"可执行"的快速工单（未交单的）。 */
export function vehicleHasOpenQuickOrders(state: LinkedOperationsState, vehicleId: string, exceptOrderId?: string): boolean {
  return state.quickOrders.some(
    (order) => order.vehicleId === vehicleId && order.id !== exceptOrderId && order.status !== "submitted" && order.voidedAt === null,
  );
}

export interface RecordQuickPickupInput {
  readonly orderId: string;
  readonly expectedRevision: number;
  readonly mutationId: string;
  readonly channels: ReadonlyArray<{
    readonly kind: QuickPickupChannelRecord["kind"];
    readonly language: "zh" | "en";
    readonly text: string;
  }>;
}

export interface RecordQuickPickupResult {
  readonly revision: number;
  readonly orderId: string;
  readonly pickupNotice: NonNullable<QuickOrder["pickupNotice"]>;
  readonly parkingSource: import("./mock-orders").LinkedModernParkingSourceFact;
}

const QUICK_PICKUP_FIELDS = new Set(["orderId", "expectedRevision", "mutationId", "channels"]);
const QUICK_PICKUP_CHANNEL_FIELDS = new Set(["kind", "language", "text"]);
const PARKING_DAILY_RATE_JMD = 2_500;

function assertClosedPickupRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LinkedApiDomainError(`${label}格式错误`, 400);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new LinkedApiDomainError(`${label}必须为普通对象`, 400);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new LinkedApiDomainError(`${label}包含不允许的字段：${String(key)}`, 400);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || descriptor.value === undefined) {
      throw new LinkedApiDomainError(`${label}字段 ${key} 不能是访问器、隐藏字段或 undefined`, 400);
    }
  }
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new LinkedApiDomainError(`${label}缺少字段 ${field}`, 400);
    }
  }
}

function normalizePickupChannels(value: unknown): RecordQuickPickupInput["channels"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new LinkedApiDomainError("至少完成一个通知渠道（短信/WhatsApp/Email）", 400);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length) {
      throw new LinkedApiDomainError(`取车通知渠道包含不允许的字段：${String(key)}`, 400);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || descriptor.value === undefined) {
      throw new LinkedApiDomainError(`取车通知渠道 ${key} 不能是访问器、隐藏字段或 undefined`, 400);
    }
  }
  const kinds = new Set<string>();
  return value.map((channel, index) => {
    assertClosedPickupRecord(channel, QUICK_PICKUP_CHANNEL_FIELDS, `取车通知渠道 ${index}`);
    if (channel.kind !== "sms" && channel.kind !== "whatsapp" && channel.kind !== "email") {
      throw new LinkedApiDomainError("通知渠道不合法", 400);
    }
    if (kinds.has(channel.kind)) throw new LinkedApiDomainError("同一通知渠道不能重复", 400);
    kinds.add(channel.kind);
    if (channel.language !== "zh" && channel.language !== "en") {
      throw new LinkedApiDomainError("通知语言不合法", 400);
    }
    if (typeof channel.text !== "string" || !channel.text.trim()) {
      throw new LinkedApiDomainError("通知文案不能为空", 400);
    }
    return { kind: channel.kind, language: channel.language, text: channel.text.trim() };
  });
}

function normalizeQuickPickupInput(raw: RecordQuickPickupInput): RecordQuickPickupInput {
  assertClosedPickupRecord(raw, QUICK_PICKUP_FIELDS, "取车通知请求");
  if (typeof raw.orderId !== "string" || !raw.orderId.trim()) throw new LinkedApiDomainError("业务单 ID 无效", 400);
  if (!Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0) {
    throw new LinkedApiDomainError("收费工作区 revision 无效", 400);
  }
  if (typeof raw.mutationId !== "string" || !raw.mutationId.trim()) throw new LinkedApiDomainError("mutationId 无效", 400);
  if (isTask8ReservedChildMutationId(raw.mutationId.trim())) {
    throw new LinkedApiDomainError("mutationId 使用了系统保留命名空间", 400);
  }
  return {
    orderId: raw.orderId.trim(),
    expectedRevision: raw.expectedRevision,
    mutationId: raw.mutationId.trim(),
    channels: normalizePickupChannels(raw.channels),
  };
}

function assertQuickPickupActorStillAuthorized(state: LinkedOperationsState, actor: SharedQuickOrderMutationActor): void {
  if (!state.trustedIdentities.some((identity) => identity.id === actor.id && identity.role === actor.role)) {
    throw new LinkedApiDomainError("取车通知操作账号权限已变化，请重新登录", 403);
  }
}

/**
 * 记录取车通知（§9.1）：前台人工执行渠道（短信/WhatsApp/Email），
 * 至少完成一项后提交 → 开始记时（notifiedAt）。
 */
export async function recordMockQuickPickup(
  rawInput: RecordQuickPickupInput,
  actor: SharedQuickOrderMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  internalRecordedAtMs?: number,
): Promise<RecordQuickPickupResult> {
  const input = normalizeQuickPickupInput(rawInput);
  const shapedActor = normalizeSharedUpdateActor(actor);
  const normalizedActor = canonicalBillingActorIdentity("parking.source.create", shapedActor.id);
  if (!normalizedActor || normalizedActor.name !== shapedActor.name || normalizedActor.role !== shapedActor.role) {
    throw new LinkedApiDomainError("取车通知操作账号无权限", 403);
  }
  const recordedAt = sharedUpdateJamaicaInstant(internalRecordedAtMs ?? store.nowMs());
  const committed = await store.mutateIdempotently<RecordQuickPickupResult>({
    mutationId: input.mutationId,
    operation: "parking.source.create",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, (state) => {
    assertQuickPickupActorStillAuthorized(state, normalizedActor);
    if (state.revision !== input.expectedRevision) {
      throw new LinkedApiDomainError("收费工作区 revision 已变化，请刷新", 409);
    }
    const order = MUTABLE(mustFind(state, input.orderId));
    if (!isSharedChargeQuickOrder(order)) {
      throw new LinkedApiDomainError("旧版业务单不能创建 canonical parking source", 409);
    }
    if (order.voidedAt) throw new LinkedApiDomainError("本单已废除，不能发取车通知；先恢复", 400);
    if (order.status !== "submitted") throw new LinkedApiDomainError("只有已交单的单才能发取车通知", 400);
    if (order.pickupNotice) throw new LinkedApiDomainError("该业务单已记录取车通知", 409);
    if (state.parkingCases.some((candidate) => (
      isModernParkingSourceFact(candidate)
        ? candidate.eligibleBusinessOrderIds.includes(order.id)
        : candidate.businessOrderId === order.id
    ))) {
      throw new LinkedApiDomainError("该业务单已存在停车来源", 409);
    }
    if (state.parkingCases.some((candidate) => (
      candidate.vehicleId === order.vehicleId && candidate.pickupDate === undefined
    ))) {
      throw new LinkedApiDomainError("该车辆已有未关闭的停车案件，不能重复开始计费", 409);
    }
    const channels: QuickPickupChannelRecord[] = input.channels.map((channel, index) => ({
      id: `${order.id}-pickup-${index + 1}`,
      kind: channel.kind,
      language: channel.language,
      text: channel.text,
      sentBy: normalizedActor.name,
      sentAt: recordedAt,
    }));
    const pickupNotice = { notifiedAt: recordedAt, notifiedBy: normalizedActor.name, channels };
    const notificationDate = recordedAt.slice(0, 10);
    const sourceId = `parking-source-${order.vehicleId}-r${state.revision + 1}`;
    if (state.parkingCases.some((candidate) => candidate.id === sourceId)) {
      throw new LinkedApiDomainError("parking source ID 冲突", 409);
    }
    const vehicleCohort = state.quickOrders.filter((candidate) => (
      candidate.vehicleId === order.vehicleId && candidate.voidedAt === null
    ));
    if (vehicleCohort.some((candidate) => candidate.status !== "submitted")) {
      throw new LinkedApiDomainError("该车辆仍有未交单的业务单，不能开始停车计费", 409);
    }
    const recordedAtMs = Date.parse(recordedAt);
    const eligibleBusinessOrderIds = vehicleCohort.filter((candidate) => (
      isSharedChargeQuickOrder(candidate)
      && candidate.customerId === order.customerId
      && Number.isFinite(Date.parse(candidate.createdAt)) && Date.parse(candidate.createdAt) <= recordedAtMs
      && candidate.submittedAt !== null
      && Number.isFinite(Date.parse(candidate.submittedAt)) && Date.parse(candidate.submittedAt) <= recordedAtMs
      && (candidate.voidedAt === null || Date.parse(candidate.voidedAt) > recordedAtMs)
    )).map((candidate) => candidate.id).sort((left, right) => left.localeCompare(right));
    if (!eligibleBusinessOrderIds.includes(order.id)) {
      throw new LinkedApiDomainError("取车通知业务单不属于可交车收费 cohort", 409);
    }
    const parkingSource: import("./mock-orders").LinkedModernParkingSourceFact = {
      id: sourceId,
      parkingContract: "parking_source_v1",
      originBusinessOrderId: order.id,
      eligibleBusinessOrderIds,
      vehicleId: order.vehicleId,
      notificationDate,
      accrual: calculateParkingAccrual({
        notificationDate,
        pickupDate: notificationDate,
        dailyRateJmd: PARKING_DAILY_RATE_JMD,
      }),
      dailyRateJmd: PARKING_DAILY_RATE_JMD,
      revision: 1,
      asOf: recordedAt,
      waiverHistory: [],
      waiverReasons: [],
    };
    (order as unknown as { pickupNotice: typeof pickupNotice }).pickupNotice = pickupNotice;
    state.parkingCases.push(parkingSource);
    state.revision += 1;
    const originWithoutCommitment: Omit<LinkedParkingSourceCreationOrigin, "commitment"> = {
      originContract: "parking_source_creation_v1",
      id: parkingSource.id,
      mutationId: input.mutationId,
      committedRevision: state.revision,
      committedAt: recordedAt,
      originBusinessOrderId: order.id,
      eligibleBusinessOrderIds,
      vehicleId: order.vehicleId,
      customerId: order.customerId,
      initialSource: structuredClone(parkingSource),
    };
    state.parkingSourceOrigins.push({
      ...originWithoutCommitment,
      commitment: parkingSourceOriginCommitment(originWithoutCommitment),
    });
    return {
      revision: state.revision,
      orderId: order.id,
      pickupNotice,
      parkingSource,
    };
  }, {
    action: "parking.source.create.write",
    preReceiptGuard: (state) => assertQuickPickupActorStillAuthorized(state, normalizedActor),
  });
  store.read(() => null, "parking.source.create.response");
  return committed.result;
}


// ---------------------------------------------------------------------------
// Invoice 客户签字（8/18 老板流程）：办公室联打印 → 客户签字 → 拍照回传保存
// ---------------------------------------------------------------------------

export interface RecordQuickInvoiceSignatureInput {
  readonly signerName: string;
  readonly photoDataUrl: string;
  readonly photoFileName: string;
}

const MAX_SIGNATURE_PHOTO_CHARS = 2_500_000; // dataURL 长度上限（约 1.9MB 图片）

export function recordMockQuickInvoiceSignature(
  orderId: string,
  input: RecordQuickInvoiceSignatureInput,
  actorName: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  return store.mutate((state) => {
    const order = MUTABLE(mustFind(state, orderId));
    if (order.voidedAt) throw new LinkedApiDomainError("本单已废除，不能补 Invoice 签字；先恢复", 400);
    if (!input.signerName.trim()) throw new LinkedApiDomainError("请填写客户签字人姓名", 400);
    if (!input.photoDataUrl.startsWith("data:image/")) throw new LinkedApiDomainError("请上传签字照片（图片）", 400);
    if (input.photoDataUrl.length > MAX_SIGNATURE_PHOTO_CHARS) throw new LinkedApiDomainError("签字照片过大，请压缩后再上传", 400);
    order.invoiceSignature = {
      signerName: input.signerName.trim(),
      photoDataUrl: input.photoDataUrl,
      photoFileName: input.photoFileName.trim() || "invoice-signature.png",
      signedBy: actorName,
      signedAt: new Date(store.nowMs()).toISOString(),
    };
    state.revision += 1;
    return cloneOrder(order);
  }, { action: "quickOrders.invoiceSignature.write" });
}
