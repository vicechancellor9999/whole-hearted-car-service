"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Banknote, Printer, Undo2 } from "lucide-react";
import { ApiError, api, isMockApiEnabled } from "@/lib/api/client";
import { currentSessionKey, reloadWorkspaceFresh } from "@/components/customers/detail-shared";
import type { CustomerVehicleWorkspaceResponse } from "@/lib/customers/types";
import type {
  QuickOrderFinancialReadModel,
  QuickOrderFinancialSource,
} from "@/lib/billing/quick-order-financial";
import type {
  QuickOrderFinancialStatement,
  QuickOrderStatementEntry,
} from "@/lib/billing/quick-order-financial-statement";
import type {
  QuickOrderLifecycleKind,
  QuickOrderLifecycleMutationInput,
  QuickOrderLifecyclePreflight,
} from "@/lib/billing/quick-order-lifecycle";
import type {
  QuickOrderInvoicePaymentInput,
} from "@/lib/billing/quick-order-money-actions";
import type { CanonicalParkingListResponse } from "@/lib/api/client";
import { loadTeams, teamNameOf } from "@/lib/teams/team-dictionary";
import {
  QUICK_BO_CHAIN_STEPS,
  QUICK_BO_STATUS_LABELS,
  QUICK_ITEM_CATEGORY_LABELS,
  QUICK_ORDER_KIND_LABELS,
  QUICK_PAYMENT_STATUS_LABELS,
  isSharedChargeQuickOrder,
  quickOrderCanonicalChargeLines,
  quickOrderRepairElapsedDays,
  quickOrderRepairOverdueDays,
  suggestQuickOrderEtaDays,
  type QuickBoStatus,
  type QuickOrder,
  type QuickRefund,
  type QuickRefundEvidence,
  type QuickRefundMethod,
  type QuickRefundOriginalDocumentStatus,
} from "@/lib/orders/quick-order-types";
import { businessDateInJamaica, jamaicaMonthKey } from "@/lib/orders/document-number";
import { loadPaymentMethods } from "@/lib/payments/method-dictionary";
import { loadEmployees } from "@/lib/employees/employee-directory";
import { cn, formatDateTime, formatJMDFull } from "@/lib/utils";
import { QuickPickupNoticeDialog } from "./quick-pickup-notice-dialog";
import { QuickInvoicePdfSection } from "./quick-invoice-pdf-section";
import { QuickOrderItemsInlineEdit } from "./quick-order-inline-edit";
import { QuickOrderSharedChargeEdit } from "./quick-order-shared-charge-edit";
import { ArrowChainStatus } from "./arrow-chain-status";
import { SignaturePad } from "@/components/ui/signature-pad";

type QuickOrderDetailSnapshot = Readonly<{
  order: QuickOrder;
  allOrders: QuickOrder[];
  financial: QuickOrderFinancialReadModel;
  statement: QuickOrderFinancialStatement;
  preflight: QuickOrderLifecyclePreflight;
  parking: CanonicalParkingListResponse;
  workspace: CustomerVehicleWorkspaceResponse | null;
}>;

type StatementDisplayLine =
  | Readonly<{
      id: string;
      pricingMode: "unit";
      category: "labor" | "parts";
      descZh: string;
      descEn: string;
      remarkZh: string;
      remarkEn: string;
      unit: string;
      unitEn: string;
      quantity: number;
      unitPriceJmd: number;
      unitDiscountJmd: number;
      pendingQuote: boolean;
    }>
  | Readonly<{
      id: string;
      pricingMode: "fixed_total" | "parking_projection";
      descZh: string;
      descEn: string;
      remarkZh: string;
      remarkEn: string;
      amountJmd: number;
    }>;

function financialSourceLabel(source: QuickOrderFinancialSource): string {
  if (source.kind === "legacy_quick") return "Business Order 收费记录";
  if (source.kind === "shared_uninvoiced") return "Business Order · 尚未开票";
  return `正式发票 · V${source.versionNo}`;
}

function joinQuickOrderDetail(
  orderId: string,
  order: QuickOrder,
  allOrders: QuickOrder[],
  financial: QuickOrderFinancialReadModel,
  statement: QuickOrderFinancialStatement,
  preflight: QuickOrderLifecyclePreflight,
  parking: CanonicalParkingListResponse,
  workspace: CustomerVehicleWorkspaceResponse | null,
): QuickOrderDetailSnapshot {
  if (order.id !== orderId
    || financial.order.id !== orderId
    || statement.order.id !== orderId
    || preflight.orderId !== orderId) {
    throw new Error("业务单详情与财务坐标不一致，请刷新后重试");
  }
  if (financial.revision !== preflight.revision || statement.revision !== financial.revision) {
    throw new Error("业务单财务与操作版本不一致，请刷新后重试");
  }
  const matchingOrders = allOrders.filter((candidate) => candidate.id === orderId);
  if (matchingOrders.length !== 1) {
    throw new Error("业务单详情与列表无法唯一对应，请刷新后重试");
  }
  return { order, allOrders, financial, statement, preflight, parking, workspace };
}

function statementDisplayLines(statement: QuickOrderFinancialStatement): ReadonlyArray<StatementDisplayLine> {
  if (statement.charges.kind === "legacy_quick") {
    return statement.charges.items.map((item) => ({
      id: item.id,
      pricingMode: "unit" as const,
      category: item.category,
      descZh: item.descZh,
      descEn: item.descEn,
      remarkZh: item.remarkZh,
      remarkEn: item.remarkEn,
      unit: item.unit,
      unitEn: item.unitEn,
      quantity: item.quantity,
      unitPriceJmd: item.unitPriceJmd,
      unitDiscountJmd: 0,
      pendingQuote: item.pendingQuote,
    }));
  }
  return statement.charges.lines.map((line) => {
    const id = "chargeLineId" in line ? line.chargeLineId : line.id;
    if (line.pricingMode === "unit") {
      return {
        id,
        pricingMode: "unit" as const,
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
        pendingQuote: "pendingQuote" in line ? line.pendingQuote : false,
      };
    }
    return {
      id,
      pricingMode: line.pricingMode,
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      amountJmd: line.amountJmd,
    };
  });
}

function statementChargeTotals(statement: QuickOrderFinancialStatement): Readonly<{
  laborGrossJmd: number;
  laborDiscountJmd: number;
  laborJmd: number;
  partsGrossJmd: number;
  partsDiscountJmd: number;
  partsJmd: number;
  otherServiceJmd: number;
  grossJmd: number;
  discountJmd: number;
  totalJmd: number;
}> {
  if (statement.charges.kind === "legacy_quick") {
    const totals = statement.charges.totals;
    return {
      laborGrossJmd: totals.laborGrossJmd,
      laborDiscountJmd: totals.laborDiscountJmd,
      laborJmd: totals.laborGrossJmd - totals.laborDiscountJmd,
      partsGrossJmd: totals.partsGrossJmd,
      partsDiscountJmd: totals.partsDiscountJmd,
      partsJmd: totals.partsGrossJmd - totals.partsDiscountJmd,
      otherServiceJmd: 0,
      grossJmd: totals.laborGrossJmd + totals.partsGrossJmd,
      discountJmd: totals.laborDiscountJmd + totals.partsDiscountJmd,
      totalJmd: totals.grandTotalJmd,
    };
  }
  const totals = statement.charges.totals;
  return {
    laborGrossJmd: totals.laborGrossJmd,
    laborDiscountJmd: totals.laborDiscountJmd,
    laborJmd: totals.laborNetJmd,
    partsGrossJmd: totals.partsGrossJmd,
    partsDiscountJmd: totals.partsDiscountJmd,
    partsJmd: totals.partsNetJmd,
    otherServiceJmd: totals.otherFeeTotalJmd + totals.parkingTotalJmd,
    grossJmd: totals.laborGrossJmd + totals.partsGrossJmd + totals.otherFeeTotalJmd + totals.parkingTotalJmd,
    discountJmd: totals.laborDiscountJmd + totals.partsDiscountJmd,
    totalJmd: totals.grandTotalJmd,
  };
}

function legacyReceiptRefund(entry: QuickOrderStatementEntry, order: QuickOrder): QuickRefund | null {
  if (entry.kind !== "refund") return null;
  if (entry.accounting === "legacy_cash_only") {
    return order.refunds.find((refund) => refund.id === entry.refundId) ?? null;
  }
  return null;
}


export function QuickOrderDetailPage({ orderId }: { orderId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [order, setOrder] = useState<QuickOrder | null>(null);
  const [workspace, setWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [allOrders, setAllOrders] = useState<QuickOrder[]>([]);
  const [financial, setFinancial] = useState<QuickOrderFinancialReadModel | null>(null);
  const [statement, setStatement] = useState<QuickOrderFinancialStatement | null>(null);
  const [preflight, setPreflight] = useState<QuickOrderLifecyclePreflight | null>(null);
  const [parking, setParking] = useState<CanonicalParkingListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"assign" | "accept" | "submit" | "rollback" | "adjust" | "stall" | "pay" | "refund" | "edit" | "unsubmit" | "aftersales" | "signature" | "void" | null>(null);
  const [showPickupDialog, setShowPickupDialog] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [perfEditing, setPerfEditing] = useState(false);
  const [perfDraft, setPerfDraft] = useState("");
  const [mileageDraft, setMileageDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Readonly<{ key: string; epoch: number; role: string }> | null>(null);
  const [dataSessionEpoch, setDataSessionEpoch] = useState<number | null>(null);
  const requestGenerationRef = useRef(0);
  const lifecycleIntentRef = useRef<Readonly<{
    key: string;
    mutationId: string;
  }> | null>(null);
  const moneyIntentRef = useRef<Readonly<{ key: string; mutationId: string }> | null>(null);
  const handledMoneyActionRef = useRef<string | null>(null);

  const clearSessionBoundState = useCallback(() => {
    setOrder(null);
    setAllOrders([]);
    setFinancial(null);
    setStatement(null);
    setPreflight(null);
    setParking(null);
    setWorkspace(null);
    setError(null);
    setNotice(null);
    setDialog(null);
    setShowPickupDialog(false);
    setShowAudit(false);
    setPerfEditing(false);
    setPerfDraft("");
    setMileageDraft("");
    setPending(false);
    setLoading(true);
    setDataSessionEpoch(null);
    lifecycleIntentRef.current = null;
    moneyIntentRef.current = null;
  }, []);

  useEffect(() => {
    const syncSession = () => {
      requestGenerationRef.current += 1;
      clearSessionBoundState();
      const key = currentSessionKey();
      let role = "anonymous";
      try {
        const raw = window.localStorage.getItem("wh_session");
        const parsed = raw ? JSON.parse(raw) as { identity?: { role?: unknown } } : null;
        role = typeof parsed?.identity?.role === "string" ? parsed.identity.role : "anonymous";
      } catch {
        role = "invalid";
      }
      setSession((current) => ({ key, role, epoch: (current?.epoch ?? 0) + 1 }));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "wh_session") return;
      syncSession();
    };
    syncSession();
    window.addEventListener("storage", onStorage);
    window.addEventListener("popstate", syncSession);
    return () => {
      requestGenerationRef.current += 1;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("popstate", syncSession);
    };
  }, [clearSessionBoundState]);

  const readAuthoritativeSnapshot = useCallback(async (): Promise<QuickOrderDetailSnapshot> => {
    const [detail, list, nextFinancial, nextStatement, nextPreflight, nextParking, customerWorkspace] = await Promise.all([
      api.quickOrders.detail(orderId),
      api.quickOrders.list(),
      api.quickOrderFinancials.detail(orderId),
      api.quickOrderFinancials.statement(orderId),
      api.quickOrderFinancials.preflight(orderId),
      api.parking.list(),
      reloadWorkspaceFresh().catch(() => null),
    ]);
    return joinQuickOrderDetail(
      orderId,
      detail,
      list,
      nextFinancial,
      nextStatement,
      nextPreflight,
      nextParking,
      customerWorkspace,
    );
  }, [orderId]);

  const responseIsCurrent = useCallback((capturedSessionKey: string, generation: number) => (
    requestGenerationRef.current === generation
    && currentSessionKey() === capturedSessionKey
  ), []);

  const publishSnapshot = useCallback((snapshot: QuickOrderDetailSnapshot, epoch: number) => {
    setOrder(snapshot.order);
    setAllOrders(snapshot.allOrders);
    setFinancial(snapshot.financial);
    setStatement(snapshot.statement);
    setPreflight(snapshot.preflight);
    setParking(snapshot.parking);
    setWorkspace(snapshot.workspace);
    setDataSessionEpoch(epoch);
    setError(null);
  }, []);

  useEffect(() => {
    if (session === null) return;
    if (isMockApiEnabled && session.key === "anonymous") {
      clearSessionBoundState();
      setLoading(false);
      return;
    }
    const capturedSessionKey = session.key;
    const capturedEpoch = session.epoch;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setLoading(true);
    setError(null);
    void readAuthoritativeSnapshot().then((snapshot) => {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      publishSnapshot(snapshot, capturedEpoch);
    }).catch((caught) => {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setOrder(null);
      setAllOrders([]);
      setFinancial(null);
      setStatement(null);
      setPreflight(null);
      setParking(null);
      setWorkspace(null);
      setDataSessionEpoch(capturedEpoch);
      setError(caught instanceof Error ? caught.message : "加载失败");
    }).finally(() => {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setLoading(false);
    });
    return () => { requestGenerationRef.current += 1; };
  }, [clearSessionBoundState, publishSnapshot, readAuthoritativeSnapshot, responseIsCurrent, session]);

  const customer = useMemo(() => {
    if (!statement || !workspace) return null;
    return workspace.customers.find((customerRecord) => customerRecord.id === statement.order.customerId) ?? null;
  }, [statement, workspace]);
  const vehicle = useMemo(() => {
    if (!statement || !workspace) return null;
    return workspace.vehicles.find((vehicleRecord) => vehicleRecord.id === statement.order.vehicleId) ?? null;
  }, [statement, workspace]);

  useEffect(() => {
    setMileageDraft(order?.startMileageKm === null || order?.startMileageKm === undefined
      ? ""
      : String(order.startMileageKm));
  }, [order?.id, order?.startMileageKm]);
  const openParkingCase = useMemo(() => parking?.items.find((item) => (
    item.pickupDate === null && item.eligibleBusinessOrderIds.includes(orderId)
  )) ?? null, [orderId, parking]);

  useEffect(() => {
    const requestedAction = searchParams.get("action");
    if (requestedAction !== "pay" && requestedAction !== "refund") return;
    if (order === null || financial === null) return;
    const actionKey = `${orderId}:${requestedAction}`;
    if (handledMoneyActionRef.current === actionKey) return;
    handledMoneyActionRef.current = actionKey;
    if (requestedAction === "pay" && financial.gates.canCollectPayment) {
      setDialog("pay");
    } else if (requestedAction === "refund" && financial.gates.canRefund) {
      setDialog("refund");
    } else {
      setNotice(requestedAction === "pay" ? "本单当前没有待收金额" : "本单当前不能退款");
    }
    router.replace(`/orders/business/${encodeURIComponent(orderId)}`, { scroll: false });
  }, [financial, order, orderId, router, searchParams]);

  const refreshWithinGeneration = useCallback(async (
    capturedSessionKey: string,
    generation: number,
    epoch: number,
  ): Promise<boolean> => {
    const snapshot = await readAuthoritativeSnapshot();
    if (!responseIsCurrent(capturedSessionKey, generation)) return false;
    publishSnapshot(snapshot, epoch);
    return true;
  }, [publishSnapshot, readAuthoritativeSnapshot, responseIsCurrent]);

  const run = useCallback(async (fn: () => Promise<unknown>, okMsg: string) => {
    if (session === null) return;
    const capturedSessionKey = session.key;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setPending(true);
    setNotice(null);
    try {
      await fn();
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      const refreshed = await refreshWithinGeneration(capturedSessionKey, generation, session.epoch);
      if (!refreshed) return;
      setDialog(null);
      setNotice(okMsg);
    } catch (caught) {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setNotice(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setPending(false);
    }
  }, [refreshWithinGeneration, responseIsCurrent, session]);

  const refreshAfterMutation = useCallback(async (okMsg: string) => {
    if (session === null) return;
    const capturedSessionKey = session.key;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setPending(true);
    setNotice(null);
    try {
      const refreshed = await refreshWithinGeneration(capturedSessionKey, generation, session.epoch);
      if (!refreshed) return;
      setNotice(okMsg);
    } catch (caught) {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setNotice(caught instanceof Error ? caught.message : "刷新最新业务单失败");
    } finally {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setPending(false);
    }
  }, [refreshWithinGeneration, responseIsCurrent, session]);

  const runLifecycle = useCallback(async (
    kind: QuickOrderLifecycleKind,
    okMsg: string,
    reason?: string,
  ) => {
    if (session === null || preflight === null || !preflight.allowedKinds.includes(kind)) return;
    const capturedSessionKey = session.key;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const expectedRevision = preflight.revision;
    const intentKey = JSON.stringify({ kind, orderId, expectedRevision, reason: reason?.trim() ?? null });
    const intent = lifecycleIntentRef.current?.key === intentKey
      ? lifecycleIntentRef.current
      : { key: intentKey, mutationId: `quick-order-lifecycle-${kind}-${crypto.randomUUID()}` };
    lifecycleIntentRef.current = intent;
    setPending(true);
    setNotice(null);
    try {
      const input: QuickOrderLifecycleMutationInput = kind === "void"
        ? {
            contract: "quick_order_lifecycle_mutation_v1",
            kind,
            orderId,
            expectedRevision,
            mutationId: intent.mutationId,
            reason: reason?.trim() ?? "",
          }
        : {
            contract: "quick_order_lifecycle_mutation_v1",
            kind,
            orderId,
            expectedRevision,
            mutationId: intent.mutationId,
          };
      await api.quickOrderFinancials.lifecycle(input);
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      lifecycleIntentRef.current = null;
      const refreshed = await refreshWithinGeneration(capturedSessionKey, generation, session.epoch);
      if (!refreshed) return;
      setDialog(null);
      setNotice(okMsg);
    } catch (caught) {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      if (caught instanceof ApiError && caught.status === 409) {
        try {
          const refreshed = await refreshWithinGeneration(capturedSessionKey, generation, session.epoch);
          if (!refreshed) return;
          setNotice("版本已变化，已刷新最新数据；请核对后再次确认");
        } catch (refreshError) {
          if (!responseIsCurrent(capturedSessionKey, generation)) return;
          setNotice(refreshError instanceof Error ? refreshError.message : "刷新最新业务单失败");
        }
      } else {
        setNotice(caught instanceof Error ? caught.message : "操作失败");
      }
    } finally {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setPending(false);
    }
  }, [orderId, preflight, refreshWithinGeneration, responseIsCurrent, session]);

  const runPayment = useCallback(async (amountJmd: number, method: string, note?: string) => {
    if (session === null || statement === null) return;
    const capturedSessionKey = session.key;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const intentKey = JSON.stringify({
      kind: "payment",
      orderId,
      source: statement.source.kind,
      expectedRevision: statement.revision,
      amountJmd,
      method,
      note: note?.trim() || null,
    });
    const intent = moneyIntentRef.current?.key === intentKey
      ? moneyIntentRef.current
      : { key: intentKey, mutationId: `quick-order-payment-${crypto.randomUUID()}` };
    moneyIntentRef.current = intent;
    setPending(true);
    setNotice(null);
    try {
      if (statement.source.kind === "canonical_invoice") {
        const input: QuickOrderInvoicePaymentInput = {
          contract: "quick_order_invoice_payment_v1",
          orderId,
          invoiceId: statement.source.invoiceId,
          invoiceVersionId: statement.source.effectiveVersionId,
          expectedRevision: statement.revision,
          mutationId: intent.mutationId,
          amountJmd,
          method,
          ...(note?.trim() ? { note: note.trim() } : {}),
        };
        await api.quickOrderFinancials.recordInvoicePayment(input);
      } else {
        await api.quickOrders.recordPayment(orderId, {
          amountJmd,
          method,
          ...(note?.trim() ? { note: note.trim() } : {}),
        });
      }
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      moneyIntentRef.current = null;
      const refreshed = await refreshWithinGeneration(capturedSessionKey, generation, session.epoch);
      if (!refreshed) return;
      setDialog(null);
      setNotice(`已新增一笔独立收款 ${formatJMDFull(amountJmd)}`);
    } catch (caught) {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      if (caught instanceof ApiError && caught.status === 409) {
        moneyIntentRef.current = null;
        try {
          const refreshed = await refreshWithinGeneration(capturedSessionKey, generation, session.epoch);
          if (!refreshed) return;
          setNotice("收费版本已变化，已刷新；表单已保留，请核对后重新确认");
        } catch (refreshError) {
          if (!responseIsCurrent(capturedSessionKey, generation)) return;
          setNotice(refreshError instanceof Error ? refreshError.message : "刷新最新收费数据失败");
        }
      } else {
        setNotice(caught instanceof Error ? caught.message : "收款失败");
      }
    } finally {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setPending(false);
    }
  }, [orderId, refreshWithinGeneration, responseIsCurrent, session, statement]);

  const runRefund = useCallback(async (input: Readonly<{
    amountJmd: number;
    method: string;
    reason: string;
    originalDocumentStatus: QuickRefundOriginalDocumentStatus;
    originalDocumentNote: string | null;
    signerName?: string;
    signatureDataUrl?: string;
    signatureFileName?: string;
  }>) => {
    if (session === null || statement === null) return;
    const capturedSessionKey = session.key;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setPending(true);
    setNotice(null);
    try {
      const updated = await api.quickOrders.recordRefund(orderId, input);
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      const refreshed = await refreshWithinGeneration(capturedSessionKey, generation, session.epoch);
      if (!refreshed) return;
      setDialog(null);
      const refund = updated.refunds.at(-1);
      setNotice(`已记录一笔独立退款 ${formatJMDFull(input.amountJmd)}${refund ? ` · 退款说明与签收单 ${refund.receiptNo}` : ""}`);
    } catch (caught) {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setNotice(caught instanceof Error ? caught.message : "退款失败");
    } finally {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setPending(false);
    }
  }, [orderId, refreshWithinGeneration, responseIsCurrent, session, statement]);

  const runRefundProof = useCallback(async (refundId: string, proof: QuickRefundEvidence) => {
    if (session === null) return;
    const capturedSessionKey = session.key;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setPending(true);
    setNotice(null);
    try {
      await api.quickOrders.attachRefundEvidence(orderId, { refundId, proof });
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      const refreshed = await refreshWithinGeneration(capturedSessionKey, generation, session.epoch);
      if (!refreshed) return;
      setNotice("退款凭证已追加到原退款记录；退款金额、时间和原因未改变");
    } catch (caught) {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setNotice(caught instanceof Error ? caught.message : "退款凭证上传失败");
    } finally {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setPending(false);
    }
  }, [orderId, refreshWithinGeneration, responseIsCurrent, session]);

  const runRefundSignedAcknowledgement = useCallback(async (refundId: string, file: Readonly<{ name: string; dataUrl: string }>) => {
    if (session === null) return;
    const capturedSessionKey = session.key;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setPending(true);
    setNotice(null);
    try {
      await api.quickOrders.recordRefundSignature(orderId, {
        refundId,
        signerName: "客户（纸质签字）",
        photoDataUrl: file.dataUrl,
        photoFileName: file.name,
      });
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      const refreshed = await refreshWithinGeneration(capturedSessionKey, generation, session.epoch);
      if (!refreshed) return;
      setNotice("签字后的纸质退款签收单已追加归档；原退款记录未改变");
    } catch (caught) {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setNotice(caught instanceof Error ? caught.message : "退款签收单上传失败");
    } finally {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setPending(false);
    }
  }, [orderId, refreshWithinGeneration, responseIsCurrent, session]);

  if (error) return <div className="p-6 text-sm text-rose-600" data-testid="quick-detail-error">{error}</div>;
  if (
    loading
    || !order
    || !financial
    || !statement
    || !preflight
    || session === null
    || dataSessionEpoch !== session.epoch
  ) {
    return <div className="flex h-64 items-center justify-center text-sm text-ink-soft dark:text-slate-400" data-testid="quick-detail-loading">正在读取业务单…</div>;
  }

  const totals = statementChargeTotals(statement);
  const finance = statement.ledger;
  const financialOrder = statement.order;
  const status = financialOrder.status;
  const sharedChargeOrder = isSharedChargeQuickOrder(order);
  const canonicalChargeLines = statementDisplayLines(statement);
  const voided = financialOrder.voidedAt !== null;
  const statementChargesAreReadonly = statement.source.kind === "canonical_invoice" || status === "submitted" || voided;
  const completed = financial.gates.completed;
  const chainIndex = completed
    ? QUICK_BO_CHAIN_STEPS.length - 1
    : QUICK_BO_CHAIN_STEPS.findIndex((step) => step.key === status);
  const lifecycleAllowed = (kind: QuickOrderLifecycleKind) => (
    preflight?.allowedKinds.includes(kind) ?? false
  );
  const canMutateMoney = session.role === "superadmin" || session.role === "frontdesk_admin";
  const mileageValue = Number(mileageDraft);
  const mileageValid = mileageDraft.trim() !== "" && Number.isSafeInteger(mileageValue) && mileageValue >= 0;
  const isLaterRepairRound = order.statusHistory.some((event) => event.from === "submitted" && event.to === "pending_assign");
  const teamName = teamNameOf(order.teamId) ?? (order.teamId ? "未知班组" : null);
  // 跨月后不能抹除交单事实；售后回厂时仍在原 Business Order 开始下一维修轮次。
  const submittedMonth = order.submittedAt ? jamaicaMonthKey(order.submittedAt) : null;
  const currentMonth = jamaicaMonthKey(new Date().toISOString());
  const crossedMonth = submittedMonth !== null && submittedMonth !== currentMonth;
  const linkedOriginal = order.linkedOrderId ? allOrders.find((candidate) => candidate.id === order.linkedOrderId) ?? null : null;
  // 取车提醒：已交单 + 此车没有其他未交单的工单 + 还没通知过（废除单不提醒）
  const needsPickupNotice = status === "submitted"
    && !voided
    && !order.pickupNotice
    && !allOrders.some((o) => o.vehicleId === order.vehicleId && o.id !== order.id && o.status !== "submitted");

  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-6">

      {/* Business Order 英雄区（8/18 老板：工单详情顶部，和其他板块的英雄区一样） */}
      <section data-testid="quick-detail-hero" className="mb-3 rounded-2xl border border-line bg-gradient-to-r from-primary-50 to-blue-50 px-5 py-4 shadow-card dark:border-slate-700 dark:from-slate-800 dark:to-slate-800/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/70 dark:text-primary-300/70">工单管理 · Work Orders</p>
            <h1 className="mt-0.5 text-2xl font-bold text-ink dark:text-slate-100">Business Order</h1>
            <p data-testid="quick-detail-hero-meta" className="mt-1 text-xs text-ink-soft dark:text-slate-400">
              {order.businessOrderNo}
              {customer ? ` · ${customer.nameZh ?? customer.nameEn ?? customer.organizationName}` : ""}
              {vehicle ? ` · ${vehicle.plate}${vehicle.modelZh ? ` ${vehicle.modelZh}` : ""}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {completed && <span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">已完结（交单+取车+付全款）</span>}
            {voided && <span className="rounded-full bg-rose-500 px-3 py-1 text-xs font-semibold text-white">已作废</span>}
            <span data-testid="quick-detail-hero-status" className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-primary dark:bg-slate-900/40 dark:text-primary-300">{QUICK_BO_STATUS_LABELS[status]}</span>
          </div>
        </div>
      </section>
      {/* 顶行：返回 + 打印 + 审计 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link href="/orders/business" data-testid="quick-detail-back"
          className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-ink-soft hover:text-primary dark:text-slate-400">
          <ArrowLeft size={14} /> 返回工单列表
        </Link>
        <div className="flex items-center gap-2">
          <Printer size={13} className="text-ink-soft dark:text-slate-500" />
          {!voided && (["zh", "en", "technician", "office"] as const).map((copy) => (
            <Link key={copy} href={`/orders/business/${order.id}/print?copy=${copy}`}
              data-testid={`quick-print-${copy}`}
              className="inline-flex min-h-8 items-center rounded-full border border-line px-2.5 text-xs font-semibold text-ink-soft hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:text-slate-400">
              {{ zh: "中文客户联", en: "英文客户联", technician: "维修工联", office: "参照联" }[copy]}
            </Link>
          ))}
          <button type="button" data-testid="quick-detail-audit-toggle" onClick={() => setShowAudit((open) => !open)}
            className="inline-flex min-h-8 items-center rounded-full border border-line px-3 text-xs font-semibold text-ink-soft hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:text-slate-400">
            {showAudit ? "返回工单" : "审计留痕"}
          </button>
        </div>
      </div>

      {/* 取车提醒横幅 */}
      {needsPickupNotice && (
        <div data-testid="quick-pickup-banner" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-500/10">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">此车已没有可执行的工单 —— 请通知客户取车</p>
          <button type="button" data-testid="quick-pickup-notify" disabled={pending}
            onClick={() => setShowPickupDialog(true)}
            className="inline-flex min-h-9 shrink-0 items-center rounded-lg bg-amber-600 px-4 text-xs font-semibold text-white hover:bg-amber-700">
            发信通知取车
          </button>
        </div>
      )}
      {order.pickupNotice && (
        <div data-testid="quick-pickup-notified" className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <p>已通知客户取车：{formatDateTime(order.pickupNotice.notifiedAt)} · 经办 {order.pickupNotice.notifiedBy} · 开始记停车费</p>
          <p className="mt-1 text-emerald-600/80 dark:text-emerald-400/80">
            {order.pickupNotice.channels.map((channel) => { const label = channel.kind === "sms" ? "短信" : channel.kind === "whatsapp" ? "WhatsApp" : "Email"; return label + "（" + (channel.language === "zh" ? "中文" : "English") + "）"; }).join(" · ")}
          </p>
        </div>
      )}

      {notice && <p data-testid="quick-detail-notice" className="mb-3 rounded-lg bg-primary-50 px-3 py-2 text-xs font-semibold text-primary dark:bg-primary-500/10">{notice}</p>}

      {/* 废除横幅（2026-08-18 老板：废除=全部数据无效、不参与计算，可恢复） */}
      {voided && (
        <div data-testid="quick-void-banner" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 dark:border-rose-500/40 dark:bg-rose-500/10">
          <div className="min-w-0">
            <p className="text-xs font-bold text-rose-700 dark:text-rose-300">本单已作废 —— 所有数据无效，不参与任何计算</p>
            <p className="mt-1 text-[11px] text-rose-600/90 dark:text-rose-400/90">
              {order.voidedBy ?? "—"} · {financialOrder.voidedAt ? formatDateTime(financialOrder.voidedAt) : "—"} · 原因：{order.voidReason ?? "未填"}
            </p>
          </div>
          {lifecycleAllowed("restore") && (
            <button type="button" data-testid="quick-action-restore" disabled={pending}
              onClick={() => runLifecycle("restore", "已恢复，本单数据重新参与计算")}
              className="inline-flex min-h-9 shrink-0 items-center rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700">
              恢复本单
            </button>
          )}
        </div>
      )}

      {showAudit ? (
        <AuditView order={order} />
      ) : (
        <>
          {/* 头部 */}
          <div className="mb-3 rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <h2 data-testid="quick-detail-no" className="text-xl font-bold text-ink dark:text-slate-100">{order.businessOrderNo}</h2>
              <span data-testid="quick-detail-status" className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                status === "submitted" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : status === "stalled" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                  : "bg-primary-50 text-primary dark:bg-primary-500/10",
              )}>
                {QUICK_BO_STATUS_LABELS[status]}
              </span>
              {completed && (
                <span data-testid="quick-detail-completed" className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">
                  已完结（交单+取车+付全款）
                </span>
              )}
              {voided && (
                <span data-testid="quick-detail-voided" className="rounded-full bg-rose-500 px-3 py-1 text-xs font-semibold text-white">
                  已作废
                </span>
              )}
              {order.orderKind !== "normal" && (
                <span data-testid="quick-detail-kind" className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  order.orderKind === "hedge" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
                )}>
                  {QUICK_ORDER_KIND_LABELS[order.orderKind]}
                  {linkedOriginal ? ` · 关联 ${linkedOriginal.businessOrderNo}` : ""}
                </span>
              )}
              {order.stallReason && <span className="text-xs text-amber-600">停滞原因：{order.stallReason}</span>}
            </div>
            <p className="mt-1.5 text-sm text-ink-soft dark:text-slate-400">
              {customer ? (
                <Link href={`/customers/${customer.id}`} className="font-semibold text-primary hover:underline">
                  {customer.nameZh ?? customer.nameEn ?? customer.organizationName}
                  {customer.nameEn && customer.nameZh && customer.nameEn !== customer.nameZh ? ` / ${customer.nameEn}` : ""}
                </Link>
              ) : "…"}
              {customer?.phone ? ` · ${customer.phone}` : ""}
              {vehicle ? ` · ${vehicle.makeZh ?? vehicle.make} ${vehicle.modelZh ?? vehicle.model} · 车牌 ${vehicle.plate}` : ""}
              {vehicle?.vin ? <span className="ml-1 font-mono text-xs">· VIN {vehicle.vin}</span> : null}
            </p>
            <div data-testid="quick-detail-mileage" className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 dark:border-slate-700">
              <label htmlFor="quick-mileage-inline" className="text-xs font-bold text-ink dark:text-slate-200">接车里程</label>
              <div className="flex min-w-0 items-center overflow-hidden rounded-lg border border-line bg-white dark:border-slate-600 dark:bg-slate-700">
                <input
                  id="quick-mileage-inline"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={mileageDraft}
                  disabled={voided || pending}
                  onChange={(event) => setMileageDraft(event.target.value)}
                  data-testid="quick-mileage-inline-input"
                  placeholder="直接输入"
                  className="h-8 w-32 border-0 bg-transparent px-2.5 text-sm tabular-nums text-ink outline-none disabled:opacity-50 dark:text-slate-100"
                />
                <span className="pr-2 text-[11px] text-ink-soft dark:text-slate-400">km</span>
              </div>
              <button
                type="button"
                data-testid="quick-mileage-inline-save"
                disabled={voided || pending || !mileageValid || mileageValue === order.startMileageKm}
                onClick={() => run(
                  () => api.quickOrders.action(order.id, { kind: "record_mileage", startMileageKm: mileageValue }),
                  `接车里程已保存：${mileageValue.toLocaleString("en-US")} km`,
                )}
                className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                保存
              </button>
              <span className="min-w-0 text-[10px] text-ink-faint dark:text-slate-500">
                {order.startMileageRecordedBy
                  ? `${order.startMileageRecordedBy} · ${order.startMileageRecordedAt ? formatDateTime(order.startMileageRecordedAt) : "已记录"}`
                  : "超级管理员或维修工均可直接记录"}
              </span>
            </div>
          </div>

          {/* 业务员单状态流转条 */}
          <div className="mb-3 rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-sm font-bold text-ink dark:text-slate-100">业务员单状态</p>
              <span className="text-[11px] text-ink-soft dark:text-slate-400">当前状态和全部可执行操作都在这里</span>
            </div>
            <ArrowChainStatus
              steps={QUICK_BO_CHAIN_STEPS.map((step, index) => ({
                key: step.key,
                label: step.label,
                state: index < chainIndex ? "done" : index === chainIndex ? "current" : "todo",
              }))}
              events={order.statusHistory.map((event) => ({
                stepKey: event.to,
                text: event.from === null ? `建单 ${event.by} · ${formatDateTime(event.at)}` : `${event.by} · ${formatDateTime(event.at)}${event.reason ? ` · ${event.reason}` : ""}`,
                tone: event.reason?.startsWith("废除") ? "danger" : event.to === "stalled" ? "warn" : event.from === "submitted" ? "danger" : "normal",
              }))}
            />
            {/* 主操作按钮按状态出现（废除单全部隐藏，只剩恢复） */}
            <div data-testid="quick-status-actions" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/60 p-2.5 dark:border-slate-700 dark:bg-slate-900/30">
              <span className="mr-1 text-[11px] font-bold text-ink-soft dark:text-slate-300">当前可执行操作</span>
              {!voided && (status === "pending_assign" || status === "assigned" || status === "in_repair" || status === "stalled" || status === "returned") && (
                <button type="button" data-testid="quick-action-assign-open" onClick={() => setDialog("assign")}
                  className="inline-flex min-h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-600">
                  {status === "pending_assign" ? "派单" : "改派班组"}
                </button>
              )}
              {!voided && status === "assigned" && (
                <button type="button" data-testid="quick-action-accept" disabled={pending}
                  onClick={() => setDialog("accept")}
                  className="inline-flex min-h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-600">
                  维修工接车接单
                </button>
              )}
              {!voided && status === "in_repair" && (
                <>
                  <button type="button" data-testid="quick-action-return" disabled={pending}
                    onClick={() => run(() => api.quickOrders.action(order.id, { kind: "return" }, "mechanic"), "维修工已回单，待前台审核")}
                    className="inline-flex min-h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-600">
                    维修工回单
                  </button>
                  <button type="button" data-testid="quick-action-stall-open" onClick={() => setDialog("stall")}
                    className="inline-flex min-h-9 items-center rounded-lg border border-amber-300 px-4 text-xs font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300">
                    标停滞
                  </button>
                </>
              )}
              {!voided && status === "stalled" && (
                <button type="button" data-testid="quick-action-resume" disabled={pending}
                  onClick={() => run(() => api.quickOrders.action(order.id, { kind: "resume" }, "frontdesk"), "已恢复维修")}
                  className="inline-flex min-h-9 items-center rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700">
                  恢复维修
                </button>
              )}
              {!voided && status === "returned" && (
                <button type="button" data-testid="quick-action-submit-open" onClick={() => setDialog("submit")}
                  className="inline-flex min-h-9 items-center rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700">
                  前台正式交单
                </button>
              )}
              {!voided && status !== "pending_assign" && status !== "submitted" && (
                <button type="button" data-testid="quick-action-rollback-open" onClick={() => setDialog("rollback")}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-300">
                  <Undo2 size={13} /> 回退一步
                </button>
              )}
              {!voided && status !== "submitted" && (
                <button type="button" data-testid="quick-action-adjust-open" onClick={() => setDialog("adjust")}
                  className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-300">
                  直接调整状态
                </button>
              )}
              {!voided && status === "submitted" && (
                <button type="button" data-testid="quick-action-aftersales-open" onClick={() => setDialog("aftersales")}
                  className="inline-flex min-h-9 items-center rounded-lg border border-amber-300 px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300">
                  售后回厂：开始下一轮
                </button>
              )}
              {!voided && status === "submitted" && !crossedMonth && (
                <button type="button" data-testid="quick-action-unsubmit-open" onClick={() => setDialog("unsubmit")}
                  className="inline-flex min-h-9 items-center rounded-lg border border-rose-300 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300">
                  取消交单（当月）
                </button>
              )}
              {lifecycleAllowed("void") && (
                <button type="button" data-testid="quick-action-void-open" onClick={() => setDialog("void")}
                  className="inline-flex min-h-9 items-center rounded-lg bg-rose-600 px-3.5 text-xs font-bold text-white shadow-sm hover:bg-rose-700">
                  作废本单
                </button>
              )}
            </div>
          </div>

          {/* 最终完结三件事（2026-08-18 老板）：交单 + 取车 + 付完全款 → 已完结 */}
          {status === "submitted" && !voided && (
            <div data-testid="quick-completion-card" className="mb-3 rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-ink dark:text-slate-100">最终完结三件事：交单 + 取车 + 付完全款</p>
                <div className="flex flex-wrap items-center gap-2">
                  {canMutateMoney && financial.gates.canRefund ? (
                    <button type="button" data-testid="quick-completion-refund" onClick={() => setDialog("refund")}
                      className="inline-flex min-h-8 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:border-rose-300 hover:text-rose-600 dark:border-slate-600 dark:text-slate-300">
                      本单退款
                    </button>
                  ) : null}
                  {completed && <span data-testid="quick-completed-badge" className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">已完结</span>}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="flex min-h-12 items-center gap-2 rounded-lg bg-emerald-50 px-3 dark:bg-emerald-500/10">
                  <span className="text-lg font-bold text-emerald-600">✓</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">已交单</p>
                    <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">{order.submittedAt ? formatDateTime(order.submittedAt) : "—"}</p>
                  </div>
                </div>
                <div className="flex min-h-12 items-center justify-between gap-2 rounded-lg border border-line px-3 dark:border-slate-600">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-ink dark:text-slate-200">取车{financialOrder.pickedUpAt ? "" : "（待确认）"}</p>
                    <p className="text-[10px] text-ink-soft dark:text-slate-400">{financialOrder.pickedUpAt ? formatDateTime(financialOrder.pickedUpAt) + " · " + (order.pickedUpBy ?? "—") : "尚未确认实际取车"}</p>
                  </div>
                  {openParkingCase ? (
                    <button
                      type="button"
                      data-testid="quick-completion-pickup"
                      disabled={pending || parking === null}
                      onClick={() => {
                        if (parking === null) return;
                        void run(() => api.parking.recordPickup({
                          caseId: openParkingCase.caseId,
                          expectedRevision: parking.revision,
                          expectedSourceRevision: openParkingCase.committed.sourceRevision,
                          mutationId: `parking-physical-pickup-${crypto.randomUUID()}`,
                        }), "已记录实际取车");
                      }}
                      className="shrink-0 rounded-lg bg-primary px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-primary-600 disabled:opacity-50"
                    >
                      确认取车
                    </button>
                  ) : null}
                </div>
                <div className="flex min-h-12 items-center justify-between gap-2 rounded-lg border border-line px-3 dark:border-slate-600">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-ink dark:text-slate-200">付完全款{financialOrder.paidInFullAt ? "" : "（待确认）"}</p>
                    <p className="text-[10px] text-ink-soft dark:text-slate-400">{financialOrder.paidInFullAt ? formatDateTime(financialOrder.paidInFullAt) + " · " + (order.paidInFullBy ?? "—") : "收齐尾款后点右边按钮"}</p>
                  </div>
                  {lifecycleAllowed("cancel_paid_full") ? (
                    <button type="button" data-testid="quick-action-cancel-paid-full" disabled={pending}
                      onClick={() => runLifecycle("cancel_paid_full", "已撤销付完全款记录")}
                      className="shrink-0 rounded-lg border border-line px-2 py-1 text-[10px] font-semibold text-ink-soft hover:text-rose-600 dark:border-slate-600 dark:text-slate-400">
                      撤销
                    </button>
                  ) : lifecycleAllowed("record_paid_full") ? (
                    <button type="button" data-testid="quick-action-record-paid-full" disabled={pending}
                      onClick={() => runLifecycle("record_paid_full", "已记录付完全款")}
                      className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700">
                      记录付完全款
                    </button>
                  ) : null}
                </div>
              </div>
              {completed && (
                <p data-testid="quick-completed-note" className="mt-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  本单已最终完结：交单 + 取车 + 付完全款三项全部完成，流程到此为止。
                </p>
              )}
            </div>
          )}

          {/* 收费项目：直接编辑（8/18 老板），已交单只读 */}
          <div className="mb-3 rounded-xl border border-line bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800" data-testid="quick-detail-items">
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-sm font-bold text-ink dark:text-slate-100">收费项目{statement.source.kind === "canonical_invoice" ? "（正式发票 · 只读）" : status === "submitted" ? "（已交单 · 只读）" : voided ? "（已废除 · 只读）" : sharedChargeOrder ? "（检查结果复制 · 直接编辑）" : "（直接编辑）"}</p>
            </div>
            {!statementChargesAreReadonly && !sharedChargeOrder && (
              <div data-testid="quick-inline-items"><QuickOrderItemsInlineEdit order={order} onSaved={() => { void refreshAfterMutation("收费项目已直接修改保存"); }} /></div>
            )}
            {!statementChargesAreReadonly && sharedChargeOrder && (
              <div data-testid="quick-shared-charge-lines">
                <QuickOrderSharedChargeEdit order={order} onSaved={() => {
                  void refreshAfterMutation("shared 收费项目已保存");
                }} />
              </div>
            )}
            {/* 只读视图每项只保留一个“本项折扣”口径，并分开汇总工时与配件。 */}
            {statementChargesAreReadonly && (
              <div data-testid={sharedChargeOrder ? "quick-shared-charge-lines" : "quick-readonly-charge-lines"} className="min-w-0">
                <div className="min-w-0">
                  <div className="hidden grid-cols-[minmax(170px,1.7fr)_minmax(110px,1fr)_70px_50px_minmax(95px,1fr)_minmax(95px,1fr)_minmax(105px,1fr)_60px] items-center gap-2 border-b border-line pb-1.5 text-[10px] font-bold text-ink-faint dark:border-slate-700 dark:text-slate-500 lg:grid">
                    <span>项目名称</span><span>描述</span><span>单位</span><span>数量</span><span>含税单价</span><span>本项折扣</span><span>小计</span><span>待报价</span>
                  </div>
                  {(["labor", "parts"] as const).map((category) => {
                    const rows = canonicalChargeLines.filter(
                      (item): item is Extract<StatementDisplayLine, { pricingMode: "unit" }> => (
                        item.pricingMode === "unit" && item.category === category
                      ),
                    );
                    if (rows.length === 0) return null;
                    return (
                      <section key={category} className="mb-2 overflow-hidden rounded-lg border border-line dark:border-slate-700">
                        <p className={cn("border-b border-line bg-surface/70 px-2.5 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-900/30", category === "labor" ? "text-primary" : "text-amber-600")}>
                          {QUICK_ITEM_CATEGORY_LABELS[category]}
                        </p>
                        {rows.map((item) => (
                          <div key={item.id} data-testid={`quick-item-${item.id}`} className="grid min-w-0 grid-cols-2 items-start gap-2 border-b border-line px-2.5 py-2 last:border-0 dark:border-slate-700 lg:grid-cols-[minmax(170px,1.7fr)_minmax(110px,1fr)_70px_50px_minmax(95px,1fr)_minmax(95px,1fr)_minmax(105px,1fr)_60px] lg:items-center lg:gap-2">
                            <div className="col-span-2 min-w-0 lg:col-span-1"><span className="text-[9px] font-semibold text-ink-faint lg:hidden">项目名称</span>
                              <p className="text-[13px] text-ink dark:text-slate-100">{item.descZh}</p>
                              <p className="text-[11px] text-ink-soft dark:text-slate-400">{item.descEn}</p>
                            </div>
                            <div className="col-span-2 min-w-0 lg:col-span-1"><span className="text-[9px] font-semibold text-ink-faint lg:hidden">备注</span>
                              <p data-testid={`quick-item-remark-${item.id}`} className="text-[11px] leading-4 text-ink-soft dark:text-slate-400">{item.remarkZh || "—"}</p>
                              {item.remarkEn ? <p className="text-[10px] leading-4 text-ink-faint dark:text-slate-500">{item.remarkEn}</p> : null}
                            </div>
                            <div className="min-w-0"><span className="text-[9px] font-semibold text-ink-faint lg:hidden">单位</span>
                              <p data-testid={`quick-item-unit-${item.id}`} className="text-[11px] text-ink dark:text-slate-200">{item.unit}</p>
                              {item.unitEn ? <p className="text-[10px] text-ink-faint dark:text-slate-500">{item.unitEn}</p> : null}
                            </div>
                            <div className="text-[11px] tabular-nums text-ink-soft dark:text-slate-400"><span className="block text-[9px] font-semibold text-ink-faint lg:hidden">数量</span>{item.quantity}</div>
                            <div data-testid={`quick-item-price-${item.id}`} className="text-[11px] tabular-nums text-ink-soft dark:text-slate-400"><span className="block text-[9px] font-semibold text-ink-faint lg:hidden">含税单价</span><span data-testid="quick-item-original-unit-price">{item.pendingQuote ? "—" : formatJMDFull(item.unitPriceJmd)}</span></div>
                            <div><span className="block text-[9px] font-semibold text-ink-faint lg:hidden">本项折扣</span><div data-testid="quick-item-line-discount" className="text-[11px] font-semibold tabular-nums text-rose-600">{item.pendingQuote ? "—" : `−${formatJMDFull(item.unitDiscountJmd * item.quantity)}`}</div></div>
                            <div><span className="block text-[9px] font-semibold text-ink-faint lg:hidden">小计</span><div data-testid="quick-item-final-line-total" className="text-[11px] font-semibold tabular-nums text-ink dark:text-slate-100">{item.pendingQuote ? "—" : formatJMDFull((item.unitPriceJmd - item.unitDiscountJmd) * item.quantity)}</div></div>
                            <div className="text-[10px]"><span className="block text-[9px] font-semibold text-ink-faint lg:hidden">报价</span>{item.pendingQuote ? <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">待报价</span> : "—"}</div>
                          </div>
                        ))}
                      </section>
                    );
                  })}
                  {canonicalChargeLines.some((line) => line.pricingMode !== "unit") ? (
                    <div className="mb-2">
                      <p className="mb-1 text-xs font-bold text-violet-700">其他费用</p>
                      {canonicalChargeLines.filter((line) => line.pricingMode !== "unit").map((line) => (
                        <div key={line.id} data-testid={`quick-item-${line.id}`} className="grid min-w-0 grid-cols-2 items-start gap-2 rounded-lg border-b border-line py-2 last:border-0 dark:border-slate-700 lg:grid-cols-[minmax(170px,1.7fr)_minmax(110px,1fr)_70px_50px_minmax(95px,1fr)_minmax(95px,1fr)_minmax(105px,1fr)_60px] lg:items-center lg:gap-2">
                          <div className="col-span-2 min-w-0 lg:col-span-1"><span className="text-[9px] font-semibold text-ink-faint lg:hidden">项目名称</span><p className="text-[13px] text-ink dark:text-slate-100">{line.descZh}</p>{line.descEn ? <p className="text-[11px] text-ink-soft dark:text-slate-400">{line.descEn}</p> : null}</div>
                          <div className="col-span-2 min-w-0 lg:col-span-1"><span className="text-[9px] font-semibold text-ink-faint lg:hidden">备注</span><p className="text-[11px] leading-4 text-ink-soft dark:text-slate-400">{line.remarkZh || "—"}</p>{line.remarkEn ? <p className="text-[10px] leading-4 text-ink-faint dark:text-slate-500">{line.remarkEn}</p> : null}</div>
                          <div className="text-[11px] text-ink-soft"><span className="block text-[9px] font-semibold text-ink-faint lg:hidden">单位</span>固定总额</div><div className="text-[11px] text-ink-soft"><span className="block text-[9px] font-semibold text-ink-faint lg:hidden">数量</span>1</div><div className="text-[11px] tabular-nums text-ink-soft"><span className="block text-[9px] font-semibold text-ink-faint lg:hidden">含税单价</span>{formatJMDFull(line.amountJmd)}</div><div className="text-[11px] text-ink-soft"><span className="block text-[9px] font-semibold text-ink-faint lg:hidden">本项折扣</span>−{formatJMDFull(0)}</div><div className="text-[11px] font-semibold tabular-nums"><span className="block text-[9px] font-semibold text-ink-faint lg:hidden">小计</span>{formatJMDFull(line.amountJmd)}</div><span />
                        </div>
                      ))}
                      <p className="py-1 text-right text-xs text-ink-soft">其他费用合计 <b className="ml-2 text-ink dark:text-slate-100">{formatJMDFull(totals.otherServiceJmd)}</b></p>
                    </div>
                  ) : null}
                  <div className="mt-2 grid gap-2 border-t border-line pt-2 text-xs dark:border-slate-600 lg:grid-cols-3">
                    <div className="rounded-lg bg-primary-50/60 px-3 py-2 dark:bg-primary-500/10">
                      <p className="font-bold text-primary">工时</p>
                      <p className="mt-1 flex justify-between"><span className="text-ink-soft">原价</span><b>{formatJMDFull(totals.laborGrossJmd)}</b></p>
                      <p className="flex justify-between"><span className="text-ink-soft">本类折扣</span><b data-testid="quick-detail-labor-discount-total" className="text-rose-600">−{formatJMDFull(totals.laborDiscountJmd)}</b></p>
                      <p className="flex justify-between"><span className="text-ink-soft">折后</span><b data-testid="quick-detail-labor-total">{formatJMDFull(totals.laborJmd)}</b></p>
                    </div>
                    <div className="rounded-lg bg-amber-50/60 px-3 py-2 dark:bg-amber-500/10">
                      <p className="font-bold text-amber-700">配件</p>
                      <p className="mt-1 flex justify-between"><span className="text-ink-soft">原价</span><b>{formatJMDFull(totals.partsGrossJmd)}</b></p>
                      <p className="flex justify-between"><span className="text-ink-soft">本类折扣</span><b data-testid="quick-detail-parts-discount-total" className="text-rose-600">−{formatJMDFull(totals.partsDiscountJmd)}</b></p>
                      <p className="flex justify-between"><span className="text-ink-soft">折后</span><b data-testid="quick-detail-parts-total">{formatJMDFull(totals.partsJmd)}</b></p>
                    </div>
                    <div className="rounded-lg bg-slate-900 px-3 py-2 text-white dark:bg-slate-950">
                      <p className="font-bold">整单合计</p>
                      <p className="mt-1 flex justify-between text-slate-300"><span>原价</span><b data-testid="quick-detail-gross-total" className="text-white">{formatJMDFull(totals.grossJmd)}</b></p>
                      <p className="flex justify-between text-slate-300"><span>整单折扣</span><b data-testid="quick-detail-discount-total" className="text-rose-300">−{formatJMDFull(totals.discountJmd)}</b></p>
                      <p className="flex justify-between text-sm"><span className="font-bold">折后应收（含 15% GCT）</span><b data-testid="quick-detail-grand-total">{formatJMDFull(totals.totalJmd)}</b></p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 财务结算 */}
          <div className="mb-3 rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800" data-testid="quick-detail-finance">
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-ink dark:text-slate-100">
                  财务结算
                  <span className={cn("ml-2 rounded-full px-2 py-0.5 text-xs font-semibold",
                    finance.paymentStatus === "paid" ? "bg-emerald-50 text-emerald-700" : finance.paymentStatus === "partially_paid" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-600")}>
                    {QUICK_PAYMENT_STATUS_LABELS[finance.paymentStatus]}
                  </span>
                </p>
                <p
                  data-testid="quick-fin-source"
                  data-source-kind={statement.source.kind}
                  className="mt-1 text-[11px] font-semibold text-primary/80 dark:text-primary-300/80"
                >
                  {financialSourceLabel(statement.source)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canMutateMoney && financial.gates.canCollectPayment && (
                  <button type="button" data-testid="quick-action-pay-open" onClick={() => setDialog("pay")}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700">
                    <Banknote size={14} /> 收款
                  </button>
                )}
                {canMutateMoney && financial.gates.canRefund && (
                  <button type="button" data-testid="quick-action-refund-open" onClick={() => setDialog("refund")}
                    className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:text-rose-600 dark:border-slate-600 dark:text-slate-300">
                    退款
                  </button>
                )}
                {!voided && totals.totalJmd > 0 && (
                  <button type="button" data-testid="quick-action-signature-open" onClick={() => setDialog("signature")}
                    className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-300">
                    签字留档（可选）
                  </button>
                )}
              </div>
            </div>
            {statement.source.kind === "shared_uninvoiced" ? <p data-testid="quick-shared-money-note" className="mt-2 text-[11px] text-ink-soft dark:text-slate-400">尚未开票不影响收款或退款；每一笔都会独立进入本 Business Order 的收付款历史。</p> : null}
            <div className="grid grid-cols-4 gap-2">
              {([
                ["折后应收", finance.receivableJmd, "quick-fin-receivable", ""],
                ["累计收款", finance.grossPaidJmd, "quick-fin-paid", "text-emerald-600"],
                ["累计退款", finance.cashRefundedJmd, "quick-fin-refunded", "text-rose-600"],
                ["未结余额", finance.balanceJmd, "quick-fin-balance", finance.balanceJmd > 0 ? "text-rose-600" : ""],
              ] as const).map(([label, value, testid, color]) => (
                <div key={testid} className="rounded-lg bg-surface-warm/60 p-2.5 dark:bg-slate-700/40">
                  <p className="text-xs text-ink-soft dark:text-slate-400">{label}</p>
                  <p data-testid={testid} className={cn("mt-0.5 text-sm font-bold tabular-nums text-ink dark:text-slate-100", color)}>{formatJMDFull(value)}</p>
                </div>
              ))}
            </div>
            <p data-testid="quick-fin-formula" className="mt-2 text-[11px] text-ink-soft dark:text-slate-400">
              未结余额 = 折后应收 − 累计收款 + 累计退款。收费项目与折扣不会被收款或退款动作改写。
            </p>
            {order.invoiceSignature && (
              <div data-testid="quick-invoice-signature" className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-2 dark:border-slate-700">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  客户已签字 · {order.invoiceSignature.signerName} · {formatDateTime(order.invoiceSignature.signedAt)}
                </span>
                <a href={order.invoiceSignature.photoDataUrl} target="_blank" rel="noreferrer"
                  data-testid="quick-invoice-signature-photo"
                  className="text-xs font-semibold text-primary hover:underline">查看签字照片（回传存档）</a>
              </div>
            )}
            {statement.entries.length > 0 && (
              <div data-testid="quick-statement-history" className="mt-2 border-t border-line pt-2 dark:border-slate-700">
                <ul className="space-y-2 text-xs text-ink-soft dark:text-slate-400" data-testid="quick-payment-records">
                  {statement.entries.map((entry) => {
                    if (entry.kind === "payment") {
                      const receiptPayment = order.payments.find((payment) => payment.id === entry.paymentId);
                      return (
                        <li key={`payment-${entry.paymentId}`} data-testid={`quick-statement-entry-${entry.paymentId}`} data-sequence={entry.sequence} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>
                            {formatDateTime(entry.occurredAt)} · <b className="text-emerald-600">+{formatJMDFull(entry.amountJmd)}</b>
                            {entry.method ? ` · ${entry.method}` : ""}{entry.actorName ? ` · 经办 ${entry.actorName}` : ""}{entry.note ? ` · ${entry.note}` : ""}
                          </span>
                          {receiptPayment?.receipt ? (
                            <Link
                              href={`/orders/business/${order.id}/receipt/${entry.paymentId}/print`}
                              data-testid={`quick-payment-receipt-${entry.paymentId}`}
                              className="font-semibold text-primary hover:underline"
                            >
                              Receipt {receiptPayment.receipt.receiptNo} · 打开/打印
                            </Link>
                          ) : null}
                        </li>
                      );
                    }
                    const legacyRefund = legacyReceiptRefund(entry, order);
                    if (entry.accounting === "legacy_cash_only") {
                      return (
                        <li key={`refund-${entry.refundId}`} data-testid={`quick-statement-entry-${entry.refundId}`} data-sequence={entry.sequence} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>{formatDateTime(entry.occurredAt)} · <b className="text-rose-600">−{formatJMDFull(entry.cashRefundJmd)}</b></span>
                          <span>{entry.lineDescription ?? "退款"}{entry.method ? ` · ${entry.method}` : ""}{entry.actorName ? ` · 经办 ${entry.actorName}` : ""}</span>
                          {legacyRefund ? (
                            <Link href={`/orders/business/${order.id}/refund/${entry.refundId}/print`} data-testid={`quick-refund-print-${entry.refundId}`} className="text-xs font-semibold text-primary hover:underline">
                              退款说明与签收单 {legacyRefund.receiptNo} · 打开/打印
                            </Link>
                          ) : null}
                          {legacyRefund?.proof ? (
                            <a href={legacyRefund.proof.dataUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">
                              查看退款凭证
                            </a>
                          ) : legacyRefund && legacyRefund.method !== "cash" ? (
                            <RefundProofUpload refundId={legacyRefund.id} pending={pending} onUpload={(proof) => runRefundProof(legacyRefund.id, proof)} />
                          ) : null}
                          {legacyRefund?.signature ? (
                            <a href={legacyRefund.signature.photoDataUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-emerald-600 hover:underline">
                              已归档签字后的纸质退款签收单（查看）
                            </a>
                          ) : legacyRefund ? (
                            <RefundSignedAcknowledgementUpload
                              refundId={legacyRefund.id}
                              pending={pending}
                              onUpload={(file) => runRefundSignedAcknowledgement(legacyRefund.id, file)}
                            />
                          ) : null}
                        </li>
                      );
                    }
                    if (entry.accounting === "parking_correction_v1") {
                      return (
                        <li key={`refund-${entry.refundId}`} data-testid={`quick-statement-entry-${entry.refundId}`} data-sequence={entry.sequence} className="rounded-lg bg-surface-warm/60 px-3 py-2 dark:bg-slate-700/40">
                          <p>{formatDateTime(entry.occurredAt)} · {entry.lineDescription}</p>
                          <p className="mt-1">停车费更正 · 实际退还现金 <b>{formatJMDFull(entry.cashRefundJmd)}</b></p>
                          <p className="mt-1">{entry.reason} · {entry.method} · 经办 {entry.actorName}</p>
                        </li>
                      );
                    }
                    return (
                      <li key={`refund-${entry.refundId}`} data-testid={`quick-statement-entry-${entry.refundId}`} data-sequence={entry.sequence} className="rounded-lg bg-surface-warm/60 px-3 py-2 dark:bg-slate-700/40">
                        <p>{formatDateTime(entry.occurredAt)} · {entry.line.descZh} / {entry.line.descEn}</p>
                        <p className="mt-1">应收冲减 <b>{formatJMDFull(entry.receivableReductionJmd)}</b> · 实际退还现金 <b>{formatJMDFull(entry.cashRefundJmd)}</b> · {entry.cashRefundJmd > 0 ? "已退还现金" : "未退还现金"}</p>
                        <p className="mt-1">{entry.reason} · {entry.method} · 经办 {entry.actorName}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          {/* Invoice 客户文件（8/18 老板：和 Quotation 一样做客户文件） */}
          {statement.source.kind !== "shared_uninvoiced" && customer && vehicle ? (
            <QuickInvoicePdfSection statement={statement} customer={customer} vehicle={vehicle} />
          ) : null}

          {/* 维修工绩效 */}
          <div className="mb-3 rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800" data-testid="quick-detail-performance">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-ink dark:text-slate-100">维修工绩效</p>
              {!voided && status !== "submitted" ? (
                <button type="button" data-testid="quick-perf-assign-open" onClick={() => setDialog("assign")}
                  className="inline-flex min-h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-600">
                  {order.teamId ? "改派班组" : "派单"}
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-surface-warm/60 p-2.5 dark:bg-slate-700/40">
                <p className="text-xs text-ink-soft dark:text-slate-400">维修班组</p>
                <p data-testid="quick-perf-team" className="mt-0.5 text-sm font-bold text-ink dark:text-slate-100">{teamName ?? "待派维修班组"}</p>
              </div>
              <div className="rounded-lg bg-surface-warm/60 p-2.5 dark:bg-slate-700/40">
                <p className="text-xs text-ink-soft dark:text-slate-400">当前跟单人</p>
                <p data-testid="quick-perf-mechanic" className="mt-0.5 text-sm font-bold text-ink dark:text-slate-100">{order.mechanicName ?? "待接单"}</p>
              </div>
              <div className="rounded-lg bg-surface-warm/60 p-2.5 dark:bg-slate-700/40">
                <p className="text-xs text-ink-soft dark:text-slate-400">班组绩效（JMD）</p>
                <p data-testid="quick-perf-value" className={cn("mt-0.5 font-bold", order.teamId ? "text-base tabular-nums text-ink dark:text-slate-100" : "text-xs text-amber-700 dark:text-amber-300")}>
                  {order.teamId ? formatJMDFull(order.performanceValueJmd) : "未派班组，不计绩效"}
                </p>
              </div>
            </div>
            {/* 绩效值内联修改（8/18 老板：详情页直接改，未交单随时可改、记操作人） */}
            {order.orderKind === "normal" && status !== "submitted" && !voided && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 dark:border-slate-700">
                {perfEditing ? (
                  <>
                    <input type="number" min={isLaterRepairRound ? undefined : 0} data-testid="quick-perf-input" value={perfDraft}
                      onChange={(event) => setPerfDraft(event.target.value)}
                      className="min-h-9 w-40 rounded-lg border border-line bg-white px-2.5 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
                    <button type="button" data-testid="quick-perf-save" disabled={pending}
                      onClick={() => run(() => api.quickOrders.action(order.id, { kind: "set_performance", performanceValueJmd: parseInt(perfDraft, 10) || 0 }), "绩效值已更新（记操作人）").then(() => setPerfEditing(false))}
                      className="inline-flex min-h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-600">保存</button>
                    <button type="button" data-testid="quick-perf-cancel" onClick={() => setPerfEditing(false)}
                      className="inline-flex min-h-8 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft dark:border-slate-600 dark:text-slate-300">取消</button>
                  </>
                ) : (
                  <button type="button" data-testid="quick-perf-edit"
                    onClick={() => { setPerfDraft(String(order.performanceValueJmd)); setPerfEditing(true); }}
                    className="inline-flex min-h-8 items-center rounded-lg border border-primary-200 px-3 text-xs font-semibold text-primary hover:bg-primary-50 dark:border-primary-400/40 dark:text-primary-300 dark:hover:bg-primary-500/10">
                    修改绩效值
                  </button>
                )}
                <span className="text-[10px] text-ink-faint dark:text-slate-500">{isLaterRepairRound ? "售后轮次可记 0 或负数；交单后冻结到本轮" : "首轮默认=工时合计（配件不算）"}；交单前可改，记操作人</span>
              </div>
            )}
            {order.performanceAdjusts.length > 0 && (
              <ul data-testid="quick-perf-adjusts" className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-ink-soft dark:border-slate-700 dark:text-slate-400">
                {order.performanceAdjusts.map((adjust) => (
                  <li key={adjust.id}>{formatDateTime(adjust.at)} · {adjust.by} 调整绩效值：{formatJMDFull(adjust.beforeJmd)} → {formatJMDFull(adjust.afterJmd)}</li>
                ))}
              </ul>
            )}
            <div className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-ink-soft dark:border-slate-700 dark:text-slate-400">
              <p>派单时间：{order.assignedAt ? formatDateTime(order.assignedAt) : "尚未派单"}</p>
              {order.acceptedAt && (
                <p data-testid="quick-perf-eta">
                  预计工期：{order.etaDays !== null ? `${order.etaDays} 天` : "未反馈"} · 已修 {quickOrderRepairElapsedDays(order)} 天
                  {(() => { const overdue = quickOrderRepairOverdueDays(order); return overdue > 0 ? <b className="text-rose-600"> · 超时 {overdue} 天</b> : null; })()}
                </p>
              )}
              <p>前台正式交单：{order.submittedAt ? `${formatDateTime(order.submittedAt)} · 交单人 ${order.submittedBy}` : "尚未交单"}</p>
              <p className="text-xs">绩效按交单时间计入月份{order.submittedAt ? `（${order.submittedAt.slice(0, 7)}）` : ""}</p>
            </div>
          </div>

          {/* 备注（#15） */}
          {sharedChargeOrder && status !== "submitted" && !voided ? (
            <SharedQuickOrderNotesEdit order={order} onSaved={() => {
              void refreshAfterMutation("备注已保存");
            }} />
          ) : (order.noteZh || order.noteEn) ? (
            <div className="mb-3 rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800" data-testid="quick-detail-notes">
              <p className="mb-2 text-sm font-bold text-ink dark:text-slate-100">备注</p>
              {order.noteZh ? <p className="text-xs leading-5 text-ink dark:text-slate-200">{order.noteZh}</p> : null}
              {order.noteEn ? <p className="mt-1 text-xs leading-5 text-ink-soft dark:text-slate-400">{order.noteEn}</p> : null}
            </div>
          ) : null}

          {/* 原文留底 */}
          <details className="rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
            <summary className="cursor-pointer text-xs font-semibold text-ink-soft dark:text-slate-400">前台原始输入（留底）</summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs leading-6 text-ink-soft dark:text-slate-400">{order.rawInput}</pre>
            {order.editHistory.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-ink-soft dark:border-slate-700 dark:text-slate-400">
                {order.editHistory.map((edit) => (
                  <li key={edit.id}>{formatDateTime(edit.at)} · {edit.by} 修改了内容{edit.note ? `（${edit.note}）` : ""}</li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}

      {/* 弹窗 */}
      {dialog === "assign" && (
        <AssignDialog order={order} currentStatus={status} allOrders={allOrders} pending={pending}
          onCancel={() => setDialog(null)}
          onConfirm={(teamId, mechanicName, etaDays) => run(
            () => api.quickOrders.action(order.id, { kind: "assign", teamId, mechanicName, etaDays }),
            status === "pending_assign" ? "已派单" : "已改派班组",
          )} />
      )}
      {dialog === "accept" && (
        <AcceptDialog order={order} pending={pending}
          onCancel={() => setDialog(null)}
          onConfirm={(etaDays) => run(
            () => api.quickOrders.action(order.id, { kind: "accept", etaDays }, "mechanic"),
            "维修工已接车接单（入场里程请在详情页补录）",
          )} />
      )}
      {dialog === "submit" && (
        <SubmitDialog order={order} pending={pending}
          onCancel={() => setDialog(null)}
          onConfirm={(performanceValueJmd, teamId) => run(
            () => api.quickOrders.action(order.id, { kind: "submit", performanceValueJmd, teamId }),
            "已正式交单",
          )} />
      )}
      {dialog === "rollback" && (
        <ReasonDialog title="回退一步" pending={pending} onCancel={() => setDialog(null)}
          onConfirm={(reason) => run(() => api.quickOrders.action(order.id, { kind: "rollback", reason }), "已回退")} />
      )}
      {dialog === "adjust" && (
        <AdjustDialog current={status} pending={pending} onCancel={() => setDialog(null)}
          onConfirm={(to, reason) => run(() => api.quickOrders.action(order.id, { kind: "adjust", to, reason }), "状态已调整")} />
      )}
      {dialog === "stall" && (
        <ReasonDialog title="标停滞" label="遇到的困难" pending={pending} onCancel={() => setDialog(null)}
          onConfirm={(reason) => run(() => api.quickOrders.action(order.id, { kind: "stall", reason }, "mechanic"), "已标停滞")} />
      )}
      {dialog === "pay" && (
        <MoneyDialog title="收款" max={finance.balanceJmd} pending={pending} withMethod onCancel={() => setDialog(null)}
          onConfirm={(amount, method, note) => runPayment(amount, method!, note)} />
      )}
      {dialog === "refund" && (
        <CashRefundDialog pending={pending}
          onCancel={() => setDialog(null)}
          onConfirm={runRefund} />
      )}
      {dialog === "unsubmit" && (
        <ReasonDialog title="取消交单（当月）" label="取消原因" pending={pending} onCancel={() => setDialog(null)}
          onConfirm={(reason) => run(() => api.quickOrders.action(order.id, { kind: "unsubmit", reason }), "已取消交单，回到回单待审核")} />
      )}
      {dialog === "void" && (
        <ReasonDialog title="作废本单" label="作废原因" pending={pending} onCancel={() => setDialog(null)}
          hint={
            (status === "submitted"
              ? "本单已交单：作废后其绩效将从 " + (order.submittedAt ?? "").slice(0, 7) + " 月统计中退出"
                + (completed ? "，并撤销完结事实（交单/取车/付全款）" : "")
                + (crossedMonth ? "；该月份报表已出，请确认" : "")
                + "。"
              : "")
            + "已有付款记录的单不能作废（钱已动过，请按实际发生记录退款）。作废后本单所有数据无效、不参与任何计算；可随时恢复。"
          }
          onConfirm={(reason) => runLifecycle("void", "本单已作废，所有数据不再参与计算", reason)} />
      )}
      {dialog === "signature" && (
        <InvoiceSignatureDialog order={order} pending={pending} onCancel={() => setDialog(null)}
          onConfirm={(input) => run(
            () => api.quickOrders.recordInvoiceSignature(order.id, input),
            "签字照片已回传留档",
          )} />
      )}
      {dialog === "aftersales" && (
        <AftersalesRoundDialog order={order} pending={pending} onCancel={() => setDialog(null)}
          onConfirm={(reason) => run(
            () => api.quickOrders.action(order.id, { kind: "start_aftersales_round", reason }),
            "已在原 Business Order 开始下一维修轮次，请重新派维修班组",
          )} />
      )}

      {/* 取车通知弹窗（§9.1） */}
      {showPickupDialog && (
        <QuickPickupNoticeDialog order={order} customer={customer} vehicle={vehicle}
          onClose={() => setShowPickupDialog(false)}
          onDone={() => {
            setShowPickupDialog(false);
            void refreshAfterMutation("已记录取车通知，开始记停车费");
          }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

function SharedQuickOrderNotesEdit({ order, onSaved }: { order: QuickOrder; onSaved: (updated: QuickOrder) => void }) {
  const [noteZh, setNoteZh] = useState(order.noteZh ?? "");
  const [noteEn, setNoteEn] = useState(order.noteEn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intentRef = useRef<{
    key: string;
    orderId: string;
    expectedEditCount: number;
    mutationId: string;
    noteZh: string;
    noteEn: string;
  } | null>(null);

  useEffect(() => {
    setNoteZh(order.noteZh ?? "");
    setNoteEn(order.noteEn ?? "");
    intentRef.current = null;
  }, [order.id, order.noteEn, order.noteZh]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const key = JSON.stringify({ orderId: order.id, expectedEditCount: order.editHistory.length, noteZh, noteEn });
      const input = intentRef.current?.key === key
        ? intentRef.current
        : {
            key,
            orderId: order.id,
            expectedEditCount: order.editHistory.length,
            mutationId: crypto.randomUUID(),
            noteZh,
            noteEn,
          };
      intentRef.current = input;
      const { key: _key, ...request } = input;
      const updated = await api.quickOrders.updateNotes(request);
      intentRef.current = null;
      onSaved(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "备注保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800" data-testid="quick-detail-notes">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink dark:text-slate-100">备注（可编辑/删除）</p>
        <button type="button" data-testid="quick-shared-notes-save" disabled={busy} onClick={() => void save()}
          className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? "保存中…" : "保存备注"}
        </button>
      </div>
      {order.noteZh ? <p className="mb-2 text-xs leading-5 text-ink dark:text-slate-200">{order.noteZh}</p> : null}
      {order.noteEn ? <p className="mb-2 text-xs leading-5 text-ink-soft dark:text-slate-400">{order.noteEn}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-semibold text-ink-soft dark:text-slate-400">中文备注
          <input data-testid="quick-shared-note-zh" value={noteZh} onChange={(event) => { setNoteZh(event.target.value); intentRef.current = null; setError(null); }}
            className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-xs text-ink dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
        </label>
        <label className="text-[11px] font-semibold text-ink-soft dark:text-slate-400">English note
          <input data-testid="quick-shared-note-en" value={noteEn} onChange={(event) => { setNoteEn(event.target.value); intentRef.current = null; setError(null); }}
            className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-xs text-ink dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
        </label>
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

function AuditView({ order }: { order: QuickOrder }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800" data-testid="quick-audit-view">
      <p className="mb-2 text-sm font-bold text-ink dark:text-slate-100">审计留痕</p>
      <ul className="space-y-1.5 text-xs text-ink-soft dark:text-slate-400">
        {order.statusHistory.map((event) => (
          <li key={event.id} data-testid={`quick-audit-${event.id}`}>
            {formatDateTime(event.at)} · {event.by}（{event.byRole === "mechanic" ? "维修工" : event.byRole === "frontdesk" ? "前台" : "系统"}）：
            {event.from === null ? "创建工单" : ` ${QUICK_BO_STATUS_LABELS[event.from]} → ${QUICK_BO_STATUS_LABELS[event.to]}`}
            {event.reason ? ` · ${event.reason}` : ""}
          </li>
        ))}
        {order.performanceAdjusts.map((adjust) => (
          <li key={adjust.id}>{formatDateTime(adjust.at)} · {adjust.by}：绩效值 {formatJMDFull(adjust.beforeJmd)} → {formatJMDFull(adjust.afterJmd)}</li>
        ))}
      </ul>
    </div>
  );
}

function AftersalesRoundDialog({ order, pending, onCancel, onConfirm }: {
  order: QuickOrder; pending: boolean; onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [rawInput, setRawInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startRound = () => {
    if (!rawInput.trim()) { setError("请填写本次问题描述"); return; }
    setError(null);
    onConfirm(rawInput.trim());
  };

  const completedRounds = order.statusHistory.filter((event) => event.to === "submitted" && event.cancelledAt === undefined).length;
  const nextRound = Math.max(2, completedRounds + 1);

  return (
    <DialogShell title={`售后回厂 · 开始第 ${nextRound} 轮维修`} onCancel={onCancel}>
      <p className="text-xs leading-5 text-ink-soft dark:text-slate-400">
        仍然使用原 Business Order {order.businessOrderNo}。上一轮的交单时间、维修班组和绩效保持不变；本轮重新派班组，完成时独立记录本轮交单和绩效。
      </p>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">售后回厂原因（必填）
        <textarea value={rawInput} onChange={(e) => setRawInput(e.target.value)} rows={3} data-testid="quick-aftersales-raw"
          className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      </label>
      {error && <p data-testid="quick-aftersales-error" role="alert" className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-aftersales-confirm" disabled={pending || !rawInput.trim()}
          onClick={startRound}
          className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "处理中…" : `开始第 ${nextRound} 轮`}
        </button>
      </div>
    </DialogShell>
  );
}

function DialogShell({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
        <h3 className="mb-3 text-sm font-bold text-ink dark:text-slate-100">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function AssignDialog({ order, currentStatus, allOrders: _allOrders, pending, onCancel, onConfirm }: {
  order: QuickOrder; currentStatus: QuickBoStatus; allOrders: QuickOrder[]; pending: boolean;
  onCancel: () => void; onConfirm: (teamId: string, mechanicName?: string, etaDays?: number) => void;
}) {
  const teams = loadTeams();
  const [teamId, setTeamId] = useState<string>(
    order.teamId && teams.some((team) => team.id === order.teamId) ? order.teamId : "",
  );
  const [mechanic, setMechanic] = useState(order.mechanicName ?? "");
  const [eta, setEta] = useState(String(order.etaDays ?? suggestQuickOrderEtaDays(order)));
  const ready = teamId !== "" && teams.some((team) => team.id === teamId);
  const mechanics = loadEmployees().filter((employee) => employee.role === "mechanic" && employee.teamId === teamId);
  const itemLabel = quickOrderCanonicalChargeLines(order).slice(0, 2).map((item) => item.descZh).join("、") || "本单施工项目";
  const currentTeamName = teamNameOf(order.teamId) ?? "尚未派单";

  return (
    <div role="dialog" aria-modal="true" aria-label="派单 / 改派班组" data-testid="quick-assign-dialog"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="my-auto w-full max-w-lg rounded-2xl border border-line bg-white p-5 shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink dark:text-slate-100">{order.teamId ? "更换维修班组" : "派单至维修班组"}</h3>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">{order.businessOrderNo} · {itemLabel}</p>
          </div>
          <button type="button" data-testid="quick-assign-close" onClick={onCancel} aria-label="关闭"
            className="inline-flex min-h-8 items-center rounded-lg border border-line px-2.5 text-xs text-ink-soft hover:text-ink dark:border-slate-600 dark:text-slate-300">✕</button>
        </div>

        {/* 现状 strip */}
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-surface-warm/60 p-3 text-xs dark:bg-slate-700/40">
          <div><span className="block text-ink-soft dark:text-slate-400">当前执行状态</span><b className="text-ink dark:text-slate-100">{QUICK_BO_STATUS_LABELS[currentStatus]}</b></div>
          <div><span className="block text-ink-soft dark:text-slate-400">当前班组</span><b className="text-ink dark:text-slate-100">{currentTeamName}</b></div>
          <div><span className="block text-ink-soft dark:text-slate-400">施工项目</span><b className="truncate text-ink dark:text-slate-100" title={itemLabel}>{itemLabel}</b></div>
        </div>

        {/* 班组卡片 */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="quick-assign-teams">
          {teams.map((team) => (
            <button key={team.id} type="button" data-testid={`quick-assign-team-${team.id}`} onClick={() => { setTeamId(team.id); setMechanic(""); }}
              className={cn("rounded-xl border p-3 text-left transition-colors",
                teamId === team.id
                  ? "border-primary bg-primary-50 dark:border-primary-500 dark:bg-primary-500/15"
                  : "border-line bg-white hover:border-primary-300 dark:border-slate-600 dark:bg-slate-700/40 dark:hover:border-primary-500/50")}>
              <strong className="block text-sm text-ink dark:text-slate-100">{team.name}</strong>
              <small className="mt-0.5 block text-xs leading-4 text-ink-soft dark:text-slate-400">{teamId === team.id ? "当前已选" : "选择此班组"}</small>
            </button>
          ))}
        </div>
        {teams.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <p>尚未创建班组，请先由超级管理员新增班组。</p>
            <Link href="/dictionaries#teams" className="mt-2 inline-flex min-h-8 items-center rounded-lg bg-primary px-3 font-semibold text-white">去新增班组</Link>
          </div>
        ) : null}

        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">当前跟单人（可选）
          <select value={mechanic} onChange={(e) => setMechanic(e.target.value)} data-testid="quick-assign-mechanic"
            className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
            <option value="">不指定跟单人</option>
            {mechanics.map((employee) => <option key={employee.id} value={employee.name}>{employee.name}{employee.nameEn ? ` / ${employee.nameEn}` : ""}</option>)}
          </select>
        </label>
        {teamId && mechanics.length === 0 ? <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">该班组尚无维修工。<Link href="/employees" className="ml-1 font-semibold text-primary">新增员工</Link></p> : null}

        {/* 预计工期（8/18 老板）：多久算超时，按这单的实际情况在派单时反馈 */}
        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">预计工期（天）
          <input type="number" min={1} max={90} value={eta} onChange={(e) => setEta(e.target.value)} data-testid="quick-assign-eta"
            className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
          <span className="mt-1 block text-[10px] font-normal leading-4 text-ink-faint dark:text-slate-500">
            按这单实际情况反馈：超过工期还没回单 → 列表标「超时」、工作台提醒前台。系统建议 {suggestQuickOrderEtaDays(order)} 天（按项目数/待报价/金额估），可改。
          </span>
        </label>

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-faint dark:text-slate-500">绩效归班组统计，不分配到个人</p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
            <button type="button" data-testid="quick-assign-confirm" disabled={pending || !ready}
              onClick={() => onConfirm(teamId, mechanic.trim() || undefined, Math.max(1, Math.min(90, parseInt(eta, 10) || suggestQuickOrderEtaDays(order))))}
              className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">确认{currentStatus === "pending_assign" ? "派单" : "改派"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubmitDialog({ order, pending, onCancel, onConfirm }: {
  order: QuickOrder; pending: boolean;
  onCancel: () => void; onConfirm: (performanceValueJmd: number, teamId?: string) => void;
}) {
  const [perf, setPerf] = useState(String(order.performanceValueJmd));
  const teams = loadTeams();
  const [teamId, setTeamId] = useState<string>(order.teamId && teams.some((team) => team.id === order.teamId) ? order.teamId : (teams[0]?.id ?? ""));
  const isLaterRepairRound = order.statusHistory.some((event) => event.from === "submitted" && event.to === "pending_assign");
  const performanceValue = Number(perf);
  const performanceValid = Number.isSafeInteger(performanceValue) && (isLaterRepairRound || performanceValue >= 0);
  return (
    <DialogShell title="前台正式交单" onCancel={onCancel}>
      <p className="mb-3 text-xs text-ink-soft dark:text-slate-400">交单时间决定本单绩效计入哪个月。核对绩效值与施工班组：</p>
      <label className="block text-xs font-semibold text-ink dark:text-slate-200">绩效值（JMD，可改，记操作人）
        <input type="number" min={isLaterRepairRound ? undefined : 0} value={perf} onChange={(e) => setPerf(e.target.value)} data-testid="quick-submit-perf"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
        <span className="mt-1 block text-[10px] font-normal text-ink-faint">{isLaterRepairRound ? "售后轮次可以是正数、0 或负数" : "首轮不能为负数"}</span>
      </label>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">施工班组
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)} data-testid="quick-submit-team"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        {teams.length === 0 ? <span className="mt-1 block text-[10px] font-semibold text-rose-600">请先在基础字典创建维修班组；没有班组不能交单，也不会产生绩效。</span> : null}
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-submit-confirm" disabled={pending || !teamId || !performanceValid}
          onClick={() => onConfirm(performanceValue, teamId)}
          className="min-h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white">确认交单</button>
      </div>
    </DialogShell>
  );
}

function ReasonDialog({ title, label = "原因（必填，进审计）", hint, pending, onCancel, onConfirm }: {
  title: string; label?: string; hint?: string; pending: boolean;
  onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <DialogShell title={title} onCancel={onCancel}>
      {hint ? <p className="mb-2 text-[11px] leading-5 text-rose-600 dark:text-rose-400">{hint}</p> : null}
      <label className="block text-xs font-semibold text-ink dark:text-slate-200">{label}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} data-testid="quick-reason-input"
          className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-reason-confirm" disabled={pending || !reason.trim()} onClick={() => onConfirm(reason)}
          className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">确认</button>
      </div>
    </DialogShell>
  );
}

function AcceptDialog({ order, pending, onCancel, onConfirm }: {
  order: QuickOrder; pending: boolean;
  onCancel: () => void;
  onConfirm: (etaDays?: number) => void;
}) {
  const [eta, setEta] = useState(String(order.etaDays ?? suggestQuickOrderEtaDays(order)));
  return (
    <DialogShell title="维修工接车接单" onCancel={onCancel}>
      <p className="text-xs leading-5 text-ink-soft dark:text-slate-400">
        接车前先到前台完成车辆、钥匙和资料交接。接单后车辆入场，再记录入场里程（每单开始前），可在详情页补录。
      </p>
      {/* 预计工期（8/18 老板）：维修工接单时按实际情况再反馈一次，可覆盖派单时的估算 */}
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">预计工期（天，按实际情况调整）
        <input type="number" min={1} max={90} value={eta} onChange={(e) => setEta(e.target.value)} data-testid="quick-accept-eta"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
        <span className="mt-1 block text-[10px] font-normal text-ink-faint dark:text-slate-500">超过工期没回单 → 维修中超时，前台会来问进度</span>
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-accept-confirm" disabled={pending}
          onClick={() => onConfirm(Math.max(1, Math.min(90, parseInt(eta, 10) || suggestQuickOrderEtaDays(order))))}
          className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">确认接车接单</button>
      </div>
    </DialogShell>
  );
}

function AdjustDialog({ current, pending, onCancel, onConfirm }: {
  current: QuickBoStatus; pending: boolean;
  onCancel: () => void; onConfirm: (to: QuickBoStatus, reason: string) => void;
}) {
  const [to, setTo] = useState<QuickBoStatus>(current);
  const [reason, setReason] = useState("");
  return (
    <DialogShell title="直接调整状态" onCancel={onCancel}>
      <label className="block text-xs font-semibold text-ink dark:text-slate-200">调整为
        <select value={to} onChange={(e) => setTo(e.target.value as QuickBoStatus)} data-testid="quick-adjust-to"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
          {Object.entries(QUICK_BO_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">原因（必填，进审计）
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} data-testid="quick-adjust-reason"
          className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-adjust-confirm" disabled={pending || !reason.trim() || to === current}
          onClick={() => onConfirm(to, reason)}
          className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">确认调整</button>
      </div>
    </DialogShell>
  );
}

function MoneyDialog({ title, max, pending, withMethod = false, unit, onCancel, onConfirm }: {
  title: string; max: number; pending: boolean; withMethod?: boolean; unit?: string;
  onCancel: () => void; onConfirm: (amount: number, method?: string, note?: string) => void;
}) {
  const [amount, setAmount] = useState(String(max));
  const [method, setMethod] = useState<string>("cash");
  const [note, setNote] = useState("");
  const value = parseInt(amount, 10) || 0;
  const invalid = value <= 0 || value > max;
  return (
    <DialogShell title={title} onCancel={onCancel}>
      <label className="block text-xs font-semibold text-ink dark:text-slate-200">{unit ? "里程（上限 " + max.toLocaleString("en-US") + " " + unit + "）" : `金额（上限 ${formatJMDFull(max)}）`}
        <div className="mt-1 flex gap-2">
          <input type="number" min={1} max={max} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="quick-money-amount"
            className="min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
          <button type="button" data-testid="quick-money-full" onClick={() => setAmount(String(max))}
            className="shrink-0 rounded-lg border border-line px-3 text-xs font-semibold dark:border-slate-600">全额</button>
        </div>
      </label>
      {withMethod && (
        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">支付方式
          <div className="mt-1 grid grid-cols-3 gap-1.5" data-testid="quick-money-methods">
            {loadPaymentMethods().map((entry) => (
              <button type="button" key={entry.value} data-testid={"quick-money-method-" + entry.value} onClick={() => setMethod(entry.value)}
                className={cn("rounded-xl border px-2 py-2 text-xs font-semibold transition-colors",
                  method === entry.value
                    ? "border-primary bg-primary-50 text-primary dark:border-primary-500 dark:bg-primary-500/15 dark:text-primary-300"
                    : "border-line text-ink-soft hover:border-primary-300 dark:border-slate-600 dark:text-slate-300")}>
                {entry.zh}
              </button>
            ))}
          </div>
        </label>
      )}
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">备注（可空）
        <input value={note} onChange={(e) => setNote(e.target.value)} data-testid="quick-money-note"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      </label>
      {invalid && <p className="mt-2 text-xs font-semibold text-rose-600" data-testid="quick-money-error">金额要在 1 到 {formatJMDFull(max)} 之间</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-money-confirm" disabled={pending || invalid}
          onClick={() => onConfirm(value, method, note.trim() || undefined)}
          className="min-h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">确认{title}</button>
      </div>
    </DialogShell>
  );
}

function RefundProofUpload({ refundId, pending, onUpload }: {
  refundId: string;
  pending: boolean;
  onUpload: (proof: QuickRefundEvidence) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const choose = (file: File | null | undefined) => {
    setError(null);
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
    if (!allowed.includes(file.type as typeof allowed[number])) {
      setError("只支持 JPG、PNG、WebP 或 PDF");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("凭证不能超过 25 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onUpload({
      fileName: file.name,
      mimeType: file.type as QuickRefundEvidence["mimeType"],
      dataUrl: String(reader.result),
    });
    reader.onerror = () => setError("凭证读取失败，请重新选择");
    reader.readAsDataURL(file);
  };
  return (
    <label className="inline-flex cursor-pointer items-center gap-1 font-semibold text-amber-700 hover:underline dark:text-amber-300">
      待补退款凭证 · 上传
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        data-testid={`quick-refund-proof-upload-${refundId}`}
        disabled={pending}
        onChange={(event) => choose(event.target.files?.[0])}
        className="sr-only"
      />
      {error ? <span className="text-rose-600">{error}</span> : null}
    </label>
  );
}

function RefundSignedAcknowledgementUpload({ refundId, pending, onUpload }: {
  refundId: string;
  pending: boolean;
  onUpload: (file: Readonly<{ name: string; dataUrl: string }>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const choose = (file: File | null | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择签字纸的照片");
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      setError("签字纸照片不能超过 2.5 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onUpload({ name: file.name, dataUrl: String(reader.result) });
    reader.onerror = () => setError("照片读取失败，请重新选择");
    reader.readAsDataURL(file);
  };
  return (
    <label className="inline-flex cursor-pointer items-center gap-1 font-semibold text-primary hover:underline">
      上传签字后的纸质退款签收单（可选）
      <input
        type="file"
        accept="image/*"
        data-testid={`quick-refund-signed-acknowledgement-${refundId}`}
        disabled={pending}
        onChange={(event) => choose(event.target.files?.[0])}
        className="sr-only"
      />
      {error ? <span className="text-rose-600">{error}</span> : null}
    </label>
  );
}

function CashRefundDialog({ pending, onCancel, onConfirm }: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: (input: Readonly<{
    amountJmd: number;
    method: string;
    reason: string;
    originalDocumentStatus: QuickRefundOriginalDocumentStatus;
    originalDocumentNote: string | null;
    signerName?: string;
    signatureDataUrl?: string;
    signatureFileName?: string;
  }>) => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [originalDocumentStatus, setOriginalDocumentStatus] = useState<QuickRefundOriginalDocumentStatus | "">("");
  const [originalDocumentNote, setOriginalDocumentNote] = useState("");
  const amountJmd = Number.parseInt(amount, 10);
  const invalid = !Number.isSafeInteger(amountJmd)
    || amountJmd <= 0
    || !reason.trim()
    || originalDocumentStatus === ""
    || (originalDocumentStatus === "unavailable" && !originalDocumentNote.trim());

  return (
    <DialogShell title="记录一笔退款" onCancel={onCancel}>
      <p className="text-xs leading-5 text-ink-soft dark:text-slate-400">
        先记录实际退款并生成可打印的退款签收单。客户在纸上签字后，工作人员保存纸质原件，也可以之后上传签字件归档。银行回单等退款凭证在实际转账完成后追加。
      </p>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">退款金额（JMD）
        <input type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} data-testid="quick-cash-refund-amount"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      </label>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">退款方式
        <div className="mt-1 grid grid-cols-3 gap-1.5" data-testid="quick-cash-refund-methods">
          {loadPaymentMethods().map((entry) => (
            <button type="button" key={entry.value} data-testid={`quick-cash-refund-method-${entry.value}`} onClick={() => setMethod(entry.value)}
              className={cn("rounded-xl border px-2 py-2 text-xs font-semibold", method === entry.value ? "border-primary bg-primary-50 text-primary" : "border-line text-ink-soft")}>{entry.zh}</button>
          ))}
        </div>
      </label>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">退款原因
        <input value={reason} onChange={(event) => setReason(event.target.value)} data-testid="quick-cash-refund-reason"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      </label>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">原发票处理
        <select value={originalDocumentStatus} onChange={(event) => setOriginalDocumentStatus(event.target.value as QuickRefundOriginalDocumentStatus | "")} data-testid="quick-refund-original-document"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
          <option value="">请选择</option>
          <option value="returned">原发票已交回</option>
          <option value="unavailable">原单无法交回</option>
          <option value="not_issued">未曾出具原发票</option>
        </select>
      </label>
      {originalDocumentStatus === "unavailable" ? (
        <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">原单无法交回说明（必填）
          <textarea value={originalDocumentNote} onChange={(event) => setOriginalDocumentNote(event.target.value)} rows={2} data-testid="quick-refund-original-document-note"
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
        </label>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-cash-refund-confirm" disabled={pending || invalid}
          onClick={() => {
            if (originalDocumentStatus === "") return;
            onConfirm({
              amountJmd,
              method,
              reason: reason.trim(),
              originalDocumentStatus,
              originalDocumentNote: originalDocumentNote.trim() || null,
            });
          }}
          className="min-h-10 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-50">确认退款并生成单据</button>
      </div>
    </DialogShell>
  );
}

function CanonicalRefundDialog({ statement, pending, onCancel, onConfirm }: {
  statement: Extract<QuickOrderFinancialStatement, { source: { kind: "canonical_invoice" } }> | QuickOrderFinancialStatement;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (input: Readonly<{
    chargeLineId: string;
    refundQuantity?: number;
    wholeLine?: true;
    method: string;
    reason: string;
  }>) => void;
}) {
  const canonicalLines = statement.charges.kind === "canonical_invoice"
    ? statement.charges.lines.filter((line) => line.pricingMode !== "parking_projection")
    : [];
  const usedQuantity = (chargeLineId: string) => statement.entries.reduce((total, entry) => (
    entry.kind === "refund"
      && entry.accounting === "canonical_line_v1"
      && entry.line.chargeLineId === chargeLineId
      ? total + (entry.refundQuantity ?? 0)
      : total
  ), 0);
  const wholeLineUsed = (chargeLineId: string) => statement.entries.some((entry) => (
    entry.kind === "refund"
      && entry.accounting === "canonical_line_v1"
      && entry.line.chargeLineId === chargeLineId
      && entry.wholeLine
  ));
  const availableLines = canonicalLines.filter((line) => (
    line.pricingMode === "unit"
      ? usedQuantity(line.chargeLineId) < line.quantity
      : !wholeLineUsed(line.chargeLineId)
  ));
  const [chargeLineId, setChargeLineId] = useState(availableLines[0]?.chargeLineId ?? "");
  const [quantity, setQuantity] = useState("1");
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const selected = availableLines.find((line) => line.chargeLineId === chargeLineId) ?? availableLines[0] ?? null;
  const remainingQuantity = selected?.pricingMode === "unit"
    ? selected.quantity - usedQuantity(selected.chargeLineId)
    : 0;
  const parsedQuantity = Number.parseInt(quantity, 10);
  const invalid = selected === null
    || !reason.trim()
    || (selected.pricingMode === "unit" && (
      !Number.isSafeInteger(parsedQuantity) || parsedQuantity <= 0 || parsedQuantity > remainingQuantity
    ));

  return (
    <DialogShell title="新增一笔逐行退款" onCancel={onCancel}>
      <p className="text-xs leading-5 text-ink-soft dark:text-slate-400">
        每次确认只会新增一条退款记录。应收冲减和实际退现金由 Invoice 当前余额分别计算。
      </p>
      {selected ? (
        <>
          <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">退款项目
            <select
              data-testid="quick-canonical-refund-line"
              value={selected.chargeLineId}
              onChange={(event) => { setChargeLineId(event.target.value); setQuantity("1"); }}
              className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            >
              {availableLines.map((line) => (
                <option key={line.chargeLineId} value={line.chargeLineId}>
                  {line.descZh} / {line.descEn}{line.pricingMode === "fixed_total" ? " · 整行" : ` · 剩余 ${line.quantity - usedQuantity(line.chargeLineId)}`}
                </option>
              ))}
            </select>
          </label>
          {selected.pricingMode === "unit" ? (
            <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">退款数量（剩余 {remainingQuantity}）
              <input
                type="number"
                min={1}
                max={remainingQuantity}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                data-testid="quick-canonical-refund-quantity"
                className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              />
            </label>
          ) : (
            <p data-testid="quick-canonical-refund-whole-line" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              一口价项目只能整行退款一次：{formatJMDFull(selected.amountJmd)}
            </p>
          )}
          <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">退款方式
            <div className="mt-1 grid grid-cols-3 gap-1.5" data-testid="quick-canonical-refund-methods">
              {loadPaymentMethods().map((entry) => (
                <button type="button" key={entry.value} onClick={() => setMethod(entry.value)}
                  data-testid={`quick-canonical-refund-method-${entry.value}`}
                  className={cn("rounded-xl border px-2 py-2 text-xs font-semibold", method === entry.value ? "border-primary bg-primary-50 text-primary" : "border-line text-ink-soft")}>
                  {entry.zh}
                </button>
              ))}
            </div>
          </label>
          <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">退款原因（必填）
            <input value={reason} onChange={(event) => setReason(event.target.value)} data-testid="quick-canonical-refund-reason"
              className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
          </label>
        </>
      ) : (
        <p data-testid="quick-canonical-refund-empty" className="mt-3 text-sm text-ink-soft">当前没有可退的普通收费行。停车投影请在 Parking 更正中处理。</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-canonical-refund-confirm" disabled={pending || invalid}
          onClick={() => {
            if (!selected) return;
            onConfirm(selected.pricingMode === "unit"
              ? { chargeLineId: selected.chargeLineId, refundQuantity: parsedQuantity, method, reason: reason.trim() }
              : { chargeLineId: selected.chargeLineId, wholeLine: true, method, reason: reason.trim() });
          }}
          className="min-h-10 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-50">确认新增这笔退款</button>
      </div>
    </DialogShell>
  );
}

/** 签字留档（可选，8/18 老板澄清）：办公室联打印 → 客户签字 → 拍照回传。不签不影响任何流程。 */
/** 退款弹窗：退款是独立财务事实，与维修绩效无关。 */
function RefundDialog({ order, max, crossedMonth, pending, onCancel, onConfirm }: {
  order: QuickOrder;
  max: number;
  crossedMonth: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (input: { amountJmd: number; category: "labor" | "parts"; itemDesc?: string; itemId?: string; method: QuickRefundMethod; note?: string }) => void;
}) {
  const [category, setCategory] = useState<"labor" | "parts">("labor");
  const itemsOfCategory = isSharedChargeQuickOrder(order)
    ? []
    : order.items.filter((item) => item.category === category);
  const [itemKey, setItemKey] = useState<string>("all");
  const selectedItem = itemKey === "all" ? null : itemsOfCategory.find((item) => item.id === itemKey) ?? null;
  const suggested = selectedItem && !selectedItem.pendingQuote ? selectedItem.unitPriceJmd * selectedItem.quantity : 0;
  const [amount, setAmount] = useState("0");
  const [method, setMethod] = useState<string>("cash");
  const [note, setNote] = useState("");
  const value = parseInt(amount, 10) || 0;
  const invalid = value <= 0 || value > max || (selectedItem !== null && value > suggested && suggested > 0);

  const pickCategory = (next: "labor" | "parts") => {
    setCategory(next);
    setItemKey("all");
  };

  return (
    <DialogShell title="退款" onCancel={onCancel}>
      <p className="text-xs leading-5 text-ink-soft dark:text-slate-400">逐笔记录本次实际退款金额、方式和原因。退款是独立财务记录，不改变任何一轮维修绩效。</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" data-testid="quick-refund-category-labor" onClick={() => pickCategory("labor")}
          className={cn("rounded-xl border p-3 text-left",
            category === "labor" ? "border-rose-400 bg-rose-50 dark:border-rose-500/60 dark:bg-rose-500/10" : "border-line bg-white hover:border-rose-300 dark:border-slate-600 dark:bg-slate-700/40")}>
          <strong className="block text-sm text-ink dark:text-slate-100">工时费</strong>
          <small className="mt-0.5 block text-xs leading-4 text-ink-soft dark:text-slate-400">仅标明退款来源，不改变维修绩效</small>
        </button>
        <button type="button" data-testid="quick-refund-category-parts" onClick={() => pickCategory("parts")}
          className={cn("rounded-xl border p-3 text-left",
            category === "parts" ? "border-amber-400 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-500/10" : "border-line bg-white hover:border-amber-300 dark:border-slate-600 dark:bg-slate-700/40")}>
          <strong className="block text-sm text-ink dark:text-slate-100">配件费</strong>
          <small className="mt-0.5 block text-xs leading-4 text-ink-soft dark:text-slate-400">不冲绩效</small>
        </button>
      </div>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">退哪一项（可整类退款）
        <select value={itemKey} onChange={(e) => { setItemKey(e.target.value); const item = itemsOfCategory.find((candidate) => candidate.id === e.target.value); if (item && !item.pendingQuote) setAmount(String(item.unitPriceJmd * item.quantity)); else setAmount("0"); }} data-testid="quick-refund-item"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
          <option value="all">整类退款（{category === "labor" ? "工时" : "配件"}）</option>
          {itemsOfCategory.map((item) => (
            <option key={item.id} value={item.id}>{item.descZh}{item.pendingQuote ? "（待报价）" : " · " + formatJMDFull(item.unitPriceJmd * item.quantity)}</option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">退款金额（上限 {formatJMDFull(max)}）
        <input type="number" min={1} max={max} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="quick-refund-amount"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      </label>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">退款方式
        <div className="mt-1 grid grid-cols-3 gap-1.5" data-testid="quick-refund-methods">
          {loadPaymentMethods().map((entry) => (
            <button type="button" key={entry.value} data-testid={"quick-refund-method-" + entry.value} onClick={() => setMethod(entry.value)}
              className={cn("rounded-xl border px-2 py-2 text-xs font-semibold transition-colors",
                method === entry.value
                  ? "border-primary bg-primary-50 text-primary dark:border-primary-500 dark:bg-primary-500/15 dark:text-primary-300"
                  : "border-line text-ink-soft hover:border-primary-300 dark:border-slate-600 dark:text-slate-300")}>
              {entry.zh}
            </button>
          ))}
        </div>
      </label>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">备注（可空）
        <input value={note} onChange={(e) => setNote(e.target.value)} data-testid="quick-refund-note"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      </label>
      {crossedMonth && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" data-testid="quick-refund-original-document-notice">
          本单已跨月：请同时记录原客户联是否交回；未交回时在退款说明中写明并由客户签字确认。
        </p>
      )}
      {invalid && <p className="mt-2 text-xs font-semibold text-rose-600" data-testid="quick-refund-error">金额要在 1 到 {formatJMDFull(max)} 之间</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-refund-confirm" disabled={pending || invalid}
          onClick={() => onConfirm({ amountJmd: value, category, itemDesc: selectedItem?.descZh, itemId: selectedItem?.id, method, note: note.trim() || undefined })}
          className="min-h-10 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-50">确认退款</button>
      </div>
    </DialogShell>
  );
}

/** 退款单客户签字拍照留档（可选，不签不影响任何流程；2026-08-18 老板）。 */
function RefundSignatureDialog({ order, refund, pending, onCancel, onConfirm }: {
  order: QuickOrder;
  refund: QuickRefund;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (input: { signerName: string; photoDataUrl: string; photoFileName: string }) => void;
}) {
  const [signerName, setSignerName] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoFileName, setPhotoFileName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onFile = (file: File | null | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(String(reader.result));
    reader.readAsDataURL(file);
    setPhotoFileName(file.name);
  };

  const submit = () => {
    if (!signerName.trim()) { setError("请填写客户签字人姓名"); return; }
    if (!photoDataUrl) { setError("请上传签字照片（退款单打印 → 客户签字 → 拍照）"); return; }
    onConfirm({ signerName: signerName.trim(), photoDataUrl, photoFileName });
  };

  return (
    <DialogShell title="退款单签字留档（可选）" onCancel={onCancel}>
      <p className="text-xs leading-5 text-ink-soft dark:text-slate-400">
        退款单 {refund.receiptNo}（{formatJMDFull(refund.amountJmd)}，{refund.category === "labor" ? "工时" : "配件"}退款）打印出来给客户签字，拍照回传留档。不签不影响任何流程。
      </p>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">签字人姓名（客户）
        <input value={signerName} onChange={(e) => setSignerName(e.target.value)} data-testid="quick-refund-sign-name"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      </label>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">签字照片（退款单 + 客户签名）
        <input type="file" accept="image/*" data-testid="quick-refund-sign-file"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-700" />
      </label>
      {photoDataUrl && (
        <div className="mt-3 rounded-lg border border-emerald-200 p-2 dark:border-emerald-500/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoDataUrl} alt="签字照片预览" data-testid="quick-refund-sign-preview" className="max-h-48 rounded" />
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-refund-sign-confirm" disabled={pending}
          onClick={submit}
          className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">确认留档</button>
      </div>
    </DialogShell>
  );
}

function InvoiceSignatureDialog({ order, pending, onCancel, onConfirm }: {
  order: QuickOrder;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (input: { signerName: string; photoDataUrl: string; photoFileName: string }) => void;
}) {
  const [signerName, setSignerName] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(order.invoiceSignature?.photoDataUrl ?? null);
  const [photoFileName, setPhotoFileName] = useState(order.invoiceSignature?.photoFileName ?? "");
  const [error, setError] = useState<string | null>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("请选择图片文件"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (dataUrl.length > 2_500_000) { setError("签字照片过大，请压缩后再上传"); return; }
      setPhotoDataUrl(dataUrl);
      setPhotoFileName(file.name);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const submit = () => {
    if (!signerName.trim()) { setError("请填写客户签字人姓名"); return; }
    if (!photoDataUrl) { setError("请上传签字照片（办公室联打印 → 客户签字 → 拍照）"); return; }
    onConfirm({ signerName: signerName.trim(), photoDataUrl, photoFileName });
  };

  return (
    <DialogShell title="签字留档（可选）· Invoice 办公室联拍照回传" onCancel={onCancel}>
      <p className="text-xs leading-5 text-ink-soft dark:text-slate-400">
        可选用：把业务单 Invoice 办公室联打印出来给客户签字，拍照回传留档。不签不影响任何流程，签了就有记录可查。
      </p>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">签字人姓名（客户）
        <input value={signerName} onChange={(e) => setSignerName(e.target.value)} data-testid="quick-signature-name"
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      </label>
      <label className="mt-3 block text-xs font-semibold text-ink dark:text-slate-200">签字照片（办公室联 + 客户签名）
        <input type="file" accept="image/*" data-testid="quick-signature-file"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-700" />
      </label>
      {photoDataUrl && (
        <div className="mt-3 rounded-lg border border-emerald-200 p-2 dark:border-emerald-500/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoDataUrl} alt="签字照片预览" data-testid="quick-signature-preview" className="max-h-48 rounded" />
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm dark:border-slate-600">取消</button>
        <button type="button" data-testid="quick-signature-confirm" disabled={pending} onClick={submit}
          className="min-h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "保存中…" : "保存签字回传"}</button>
      </div>
    </DialogShell>
  );
}
