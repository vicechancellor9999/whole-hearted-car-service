import {
  activateMockQuickInvoiceSnapshot,
  recordMockInvoicePayment,
} from "./mock-billing";
import {
  getMockLinkedOperationsStore,
  deriveLinkedInvoiceFinancialSummary,
  isModernParkingSourceFact,
  LinkedApiDomainError,
  type MockLinkedOperationsStore,
} from "./mock-orders";
import { recordMockQuickPickup, recordMockQuickRefund } from "./mock-quick-orders";
import {
  applyMockParkingWaiver,
  collectMockCanonicalParkingPayment,
  getMockCanonicalParkingList,
  previewMockParkingWaiver,
} from "./mock-parking";

const DEMO_ACTOR = Object.freeze({
  id: "emp-001",
  name: "超级管理员",
  role: "superadmin" as const,
});

const DEMO_PARTIAL_ORDER_ID = "demo-v2-partial";
const DEMO_REFUND_ORDER_ID = "demo-v2-refunds";
const DEMO_PARKING_ORDER_ID = "demo-v2-parking";
const DEMO_UNCLAIMED_PARKING_ORDER_ID = "demo-v2-parking-unclaimed";
const DEMO_ORDER_IDS = new Set([
  "demo-v2-provisional",
  DEMO_PARTIAL_ORDER_ID,
  DEMO_REFUND_ORDER_ID,
  DEMO_PARKING_ORDER_ID,
  DEMO_UNCLAIMED_PARKING_ORDER_ID,
]);
const pendingMaterialization = new WeakMap<MockLinkedOperationsStore, Promise<void>>();

function revision(store: MockLinkedOperationsStore): number {
  return store.read((state) => state.revision);
}

function moneyDemoIsComplete(store: MockLinkedOperationsStore): boolean {
  return store.read((state) => {
    const partialInvoice = state.invoices.find((invoice) => invoice.businessOrderId === DEMO_PARTIAL_ORDER_ID);
    const refundInvoice = state.invoices.find((invoice) => invoice.businessOrderId === DEMO_REFUND_ORDER_ID);
    const refundOrder = state.quickOrders.find((order) => order.id === DEMO_REFUND_ORDER_ID);
    if (partialInvoice?.invoiceContract !== "shared_v1" || refundInvoice?.invoiceContract !== "shared_v1") return false;
    const partialPayments = state.payments.filter((payment) => payment.invoiceId === partialInvoice.id);
    const refundPayments = state.payments.filter((payment) => payment.invoiceId === refundInvoice.id);
    return ["demo-v2-partial-payment-1", "demo-v2-partial-payment-2"]
      .every((mutationId) => partialPayments.some((payment) => payment.mutationId === mutationId))
      && ["demo-v2-refunds-payment-1", "demo-v2-refunds-payment-2"]
        .every((mutationId) => refundPayments.some((payment) => payment.mutationId === mutationId))
      && refundInvoice.versions.length === 1
      && refundInvoice.financiallyEffectiveVersionId === refundInvoice.versions[0]?.id
      && !state.refunds.some((refund) => (
        refund.refundContract === "ordinary_line_v1" && refund.logicalInvoiceId === refundInvoice.id
      ))
      && refundOrder?.refunds.some((refund) => (
        refund.amountJmd === 5_000
          && refund.category === null
          && refund.note === "客户确认收到 JMD 5,000 现金退款"
          && refund.signature?.signerName === "演示客户"
      )) === true;
  });
}

function parkingDemoIsComplete(store: MockLinkedOperationsStore): boolean {
  return store.read((state) => {
    const claimed = state.parkingCases.find((candidate) => (
      isModernParkingSourceFact(candidate)
        && candidate.originBusinessOrderId === DEMO_PARKING_ORDER_ID
    ));
    const unclaimed = state.parkingCases.find((candidate) => (
      isModernParkingSourceFact(candidate)
        && candidate.originBusinessOrderId === DEMO_UNCLAIMED_PARKING_ORDER_ID
    ));
    const claimedInvoiceId = claimed ? state.activeParkingClaim[claimed.id]?.logicalInvoiceId : undefined;
    return claimed !== undefined
      && unclaimed !== undefined
      && state.activeParkingClaim[claimed.id] !== undefined
      && state.activeParkingClaim[unclaimed.id] === undefined
      && state.payments.some((payment) => (
        payment.invoiceId === claimedInvoiceId && payment.mutationId === "demo-v2-parking-invoice-balance-payment-1"
      ))
      && state.billingAuditEvents.some((event) => (
        event.operation === "parking_invoice_reprojection"
          && event.reprojectionKind === "waiver_correction"
          && event.mutationId === "demo-v2-parking-correction-apply-1"
      ));
  });
}

/**
 * Materializes the small, current-contract money demo through the same domain
 * producers used by the application. No audit, receipt, payment, or refund is
 * hand-written, and no historical Mock record is migrated.
 */
async function materializeMockCleanMoneyDemo(
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<void> {
  await store.ready();
  const cleanSeedOwnersAreIntact = store.read((state) => (
    state.quickOrders.length === DEMO_ORDER_IDS.size
      && state.quickOrders.every((order) => DEMO_ORDER_IDS.has(order.id))
  ));
  if (!cleanSeedOwnersAreIntact) return;
  const workflowFactsAreReal = store.read((state) => (
    [DEMO_PARTIAL_ORDER_ID, DEMO_REFUND_ORDER_ID, DEMO_PARKING_ORDER_ID, DEMO_UNCLAIMED_PARKING_ORDER_ID]
      .every((orderId) => {
        const order = state.quickOrders.find((candidate) => candidate.id === orderId);
        if (!order || order.status !== "submitted" || !order.teamId || !order.submittedAt) return false;
        return order.statusHistory.some((event) => (
          event.to === "submitted"
            && event.cancelledAt === undefined
            && event.at === order.submittedAt
            && event.teamId === order.teamId
        ));
      })
  ));
  // A clean demo starts before assignment. Financial and parking facts are
  // created only after the real workflow has actually reached submission.
  if (!workflowFactsAreReal) return;
  let lastConflict: string | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      if (moneyDemoIsComplete(store) && parkingDemoIsComplete(store)) return;

      let partialInvoice = store.read((state) => state.invoices.find((invoice) => (
        invoice.invoiceContract === "shared_v1" && invoice.businessOrderId === DEMO_PARTIAL_ORDER_ID
      )));
      if (!partialInvoice) {
        await activateMockQuickInvoiceSnapshot({
          orderId: DEMO_PARTIAL_ORDER_ID,
          expectedRevision: revision(store),
          mutationId: "demo-v2-partial-activate-v1",
        }, DEMO_ACTOR, store);
        partialInvoice = store.read((state) => state.invoices.find((invoice) => (
          invoice.invoiceContract === "shared_v1" && invoice.businessOrderId === DEMO_PARTIAL_ORDER_ID
        )));
      }
      if (!partialInvoice) throw new Error("clean partial Invoice activation missing");

      if (!store.read((state) => state.payments.some((payment) => payment.mutationId === "demo-v2-partial-payment-1"))) {
        await recordMockInvoicePayment({
          invoiceId: partialInvoice.id,
          expectedRevision: revision(store),
          mutationId: "demo-v2-partial-payment-1",
          amountJmd: 4_000,
          method: "cash",
          note: "第一笔独立收款",
        }, DEMO_ACTOR, store);
      }
      if (!store.read((state) => state.payments.some((payment) => payment.mutationId === "demo-v2-partial-payment-2"))) {
        await recordMockInvoicePayment({
          invoiceId: partialInvoice.id,
          expectedRevision: revision(store),
          mutationId: "demo-v2-partial-payment-2",
          amountJmd: 3_500,
          method: "card",
          note: "第二笔独立收款",
        }, DEMO_ACTOR, store);
      }

      let refundInvoice = store.read((state) => state.invoices.find((invoice) => (
        invoice.invoiceContract === "shared_v1" && invoice.businessOrderId === DEMO_REFUND_ORDER_ID
      )));
      if (!refundInvoice) {
        await activateMockQuickInvoiceSnapshot({
          orderId: DEMO_REFUND_ORDER_ID,
          expectedRevision: revision(store),
          mutationId: "demo-v2-refunds-activate-v1",
        }, DEMO_ACTOR, store);
        refundInvoice = store.read((state) => state.invoices.find((invoice) => (
          invoice.invoiceContract === "shared_v1" && invoice.businessOrderId === DEMO_REFUND_ORDER_ID
        )));
      }
      if (!refundInvoice || !refundInvoice.versions[0]?.id) throw new Error("clean refund Invoice activation missing");

      if (!store.read((state) => state.payments.some((payment) => payment.mutationId === "demo-v2-refunds-payment-1"))) {
        await recordMockInvoicePayment({
          invoiceId: refundInvoice.id,
          expectedRevision: revision(store),
          mutationId: "demo-v2-refunds-payment-1",
          amountJmd: 8_000,
          method: "cash",
          note: "第一笔独立收款",
        }, DEMO_ACTOR, store);
      }
      if (!store.read((state) => state.payments.some((payment) => payment.mutationId === "demo-v2-refunds-payment-2"))) {
        await recordMockInvoicePayment({
          invoiceId: refundInvoice.id,
          expectedRevision: revision(store),
          mutationId: "demo-v2-refunds-payment-2",
          amountJmd: 13_000,
          method: "cash",
          note: "第二笔独立收款",
        }, DEMO_ACTOR, store);
      }
      if (!store.read((state) => state.quickOrders.find((order) => (
        order.id === DEMO_REFUND_ORDER_ID
      ))?.refunds.some((refund) => refund.note === "客户确认收到 JMD 5,000 现金退款"))) {
        await recordMockQuickRefund(DEMO_REFUND_ORDER_ID, {
          amountJmd: 5_000,
          method: "cash",
          reason: "客户确认收到 JMD 5,000 现金退款",
          originalDocumentStatus: "returned",
          signerName: "演示客户",
          signatureDataUrl: "data:image/png;base64,AA==",
        }, DEMO_ACTOR.name, store);
      }

      if (!store.read((state) => state.parkingCases.some((candidate) => (
        isModernParkingSourceFact(candidate)
          && candidate.originBusinessOrderId === DEMO_PARKING_ORDER_ID
      )))) {
        await recordMockQuickPickup({
          orderId: DEMO_PARKING_ORDER_ID,
          expectedRevision: revision(store),
          mutationId: "demo-v2-parking-source-1",
          channels: [{
            kind: "whatsapp",
            language: "zh",
            text: "车辆已可取，停车计费 claim 演示已建立。",
          }],
        }, DEMO_ACTOR, store, store.nowMs() - 5 * 24 * 60 * 60 * 1_000);
      }
      if (!store.read((state) => state.parkingCases.some((candidate) => (
        isModernParkingSourceFact(candidate)
          && candidate.originBusinessOrderId === DEMO_UNCLAIMED_PARKING_ORDER_ID
      )))) {
        await recordMockQuickPickup({
          orderId: DEMO_UNCLAIMED_PARKING_ORDER_ID,
          expectedRevision: revision(store),
          mutationId: "demo-v2-parking-unclaimed-source-1",
          channels: [{
            kind: "sms",
            language: "zh",
            text: "车辆已可取，保留为未认领停车 claim 演示。",
          }],
        }, DEMO_ACTOR, store);
      }
      const claimedSource = store.read((state) => state.parkingCases.find((candidate) => (
        isModernParkingSourceFact(candidate)
          && candidate.originBusinessOrderId === DEMO_PARKING_ORDER_ID
      )));
      if (claimedSource && !store.read((state) => state.activeParkingClaim[claimedSource.id])) {
        const parking = getMockCanonicalParkingList(store);
        const item = parking.items.find((candidate) => candidate.caseId === claimedSource.id);
        if (!item || item.billing.status !== "unclaimed" || item.live.finalAmountJmd <= 0) {
          throw new Error("clean claimed parking source is not billable");
        }
        await collectMockCanonicalParkingPayment({
          contract: "parking_payment_collect_v1",
          status: "unclaimed",
          caseId: item.caseId,
          expectedRevision: parking.revision,
          expectedSourceRevision: item.committed.sourceRevision,
          mutationId: "demo-v2-parking-claim-payment-1",
          amountJmd: item.live.finalAmountJmd,
          method: "card",
          note: "停车 claim 独立收款",
          carrierBusinessOrderId: DEMO_PARKING_ORDER_ID,
          sourceProjections: [{
            caseId: item.caseId,
            projectionCommitment: item.live.projectionCommitment,
          }],
        }, DEMO_ACTOR, store);
      }
      const currentClaim = claimedSource
        ? store.read((state) => state.activeParkingClaim[claimedSource.id])
        : undefined;
      if (currentClaim && !store.read((state) => state.payments.some((payment) => (
        payment.invoiceId === currentClaim.logicalInvoiceId
          && payment.mutationId === "demo-v2-parking-invoice-balance-payment-1"
      )))) {
        const invoice = store.read((state) => state.invoices.find((candidate) => (
          candidate.id === currentClaim.logicalInvoiceId
        )));
        if (!invoice) throw new Error("clean claimed parking Invoice missing");
        const balanceJmd = store.read((state) => deriveLinkedInvoiceFinancialSummary(state, invoice).balanceJmd);
        if (balanceJmd > 0) {
          await recordMockInvoicePayment({
            invoiceId: invoice.id,
            expectedRevision: revision(store),
            mutationId: "demo-v2-parking-invoice-balance-payment-1",
            amountJmd: balanceJmd,
            method: "card",
            note: "停车 Invoice 其余收费独立收款",
          }, DEMO_ACTOR, store);
        }
      }
      if (claimedSource && !store.read((state) => state.billingAuditEvents.some((event) => (
        event.operation === "parking_invoice_reprojection"
          && event.reprojectionKind === "waiver_correction"
          && event.mutationId === "demo-v2-parking-correction-apply-1"
      )))) {
        let previewToken = store.read((state) => state.parkingWaiverPreviews.find((candidate) => (
          Object.prototype.hasOwnProperty.call(candidate, "previewContract")
            && candidate.previewContract === "parking_correction_preview_v1"
            && candidate.previewMutationId === "demo-v2-parking-correction-preview-1"
        )));
        if (!previewToken) {
          const currentSource = store.read((state) => state.parkingCases.find((candidate) => (
            isModernParkingSourceFact(candidate) && candidate.id === claimedSource.id
          )));
          if (!currentSource || !isModernParkingSourceFact(currentSource)) {
            throw new Error("clean claimed parking correction source missing");
          }
          await previewMockParkingWaiver({
            caseId: currentSource.id,
            expectedRevision: revision(store),
            expectedSourceRevision: currentSource.revision,
            mutationId: "demo-v2-parking-correction-preview-1",
            waiveDays: 1,
            reason: "演示：提前取车，独立退回一天停车费",
          }, DEMO_ACTOR, store);
          previewToken = store.read((state) => state.parkingWaiverPreviews.find((candidate) => (
            Object.prototype.hasOwnProperty.call(candidate, "previewContract")
              && candidate.previewContract === "parking_correction_preview_v1"
              && candidate.previewMutationId === "demo-v2-parking-correction-preview-1"
          )));
        }
        if (!previewToken || previewToken.previewContract !== "parking_correction_preview_v1") {
          throw new Error("clean claimed parking correction preview missing");
        }
        await applyMockParkingWaiver({
          caseId: previewToken.caseId,
          expectedRevision: previewToken.ledgerHighWaterRevision + 1,
          expectedSourceRevision: previewToken.sourceRevision,
          mutationId: "demo-v2-parking-correction-apply-1",
          previewToken: previewToken.id,
          refundMethod: "card",
        }, DEMO_ACTOR, store);
      }
      if (moneyDemoIsComplete(store) && parkingDemoIsComplete(store)) return;
    } catch (error) {
      if (error instanceof LinkedApiDomainError && error.status === 409) {
        lastConflict = error.message;
        continue;
      }
      throw error;
    }
  }
  throw new Error(`clean money demo could not converge after concurrent initialization${lastConflict ? `: ${lastConflict}` : ""}`);
}

export async function ensureMockCleanMoneyDemo(
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<void> {
  const existing = pendingMaterialization.get(store);
  if (existing) return existing;
  const task = materializeMockCleanMoneyDemo(store);
  pendingMaterialization.set(store, task);
  try {
    await task;
  } finally {
    if (pendingMaterialization.get(store) === task) pendingMaterialization.delete(store);
  }
}
