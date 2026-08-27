"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, isMockApiEnabled } from "@/lib/api/client";
import { currentSessionKey, reloadWorkspaceFresh } from "@/components/customers/detail-shared";
import type { CustomerVehicleWorkspaceResponse } from "@/lib/customers/types";
import type { QuickOrderFinancialStatement } from "@/lib/billing/quick-order-financial-statement";
import { teamNameOf } from "@/lib/teams/team-dictionary";
import {
  QUICK_BO_STATUS_LABELS,
  quickOrderCanonicalChargeLines,
  quickOrderTotals,
  type QuickBoStatus,
  type QuickOrder,
} from "@/lib/orders/quick-order-types";
import { WHOLE_HEARTED_COMPANY_IDENTITY } from "@/lib/company-identity";
import { cn, formatDateTime, formatJMDFull } from "@/lib/utils";

type CopyKind = "zh" | "en" | "technician" | "office";

const COPY_TITLES: Record<CopyKind, string> = {
  zh: "维修工单 · 客户联",
  en: "Repair Order · Customer Copy",
  technician: "维修工作与检查回交单 · 维修工联",
  office: "工单留档 · 中英文参照联",
};

const COPY_TITLES_EN: Record<CopyKind, string> = {
  zh: "Repair Order · Customer Copy",
  en: "Repair Order · Customer Copy",
  technician: "Technician Worksheet",
  office: "Office Archive · Bilingual",
};

const QUICK_BO_STATUS_LABELS_EN: Record<QuickBoStatus, string> = {
  pending_assign: "Pending assignment",
  assigned: "Assigned",
  in_repair: "In repair",
  stalled: "Stalled",
  returned: "Awaiting review",
  submitted: "Completed",
};

type QuickOrderPrintSnapshot = Readonly<{
  order: QuickOrder;
  statement: QuickOrderFinancialStatement | null;
  workspace: CustomerVehicleWorkspaceResponse;
}>;

type PrintChargeLine =
  | Readonly<{
      id: string;
      pricingMode: "unit";
      category: "labor" | "parts";
      descZh: string;
      descEn: string;
      unit: string;
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
      amountJmd: number;
    }>;

function printStatementLines(statement: QuickOrderFinancialStatement): ReadonlyArray<PrintChargeLine> {
  if (statement.charges.kind === "legacy_quick") {
    return statement.charges.items.map((item) => ({
      id: item.id,
      pricingMode: "unit" as const,
      category: item.category,
      descZh: item.descZh,
      descEn: item.descEn,
      unit: item.unit,
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
        unit: line.unit,
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
      amountJmd: line.amountJmd,
    };
  });
}

function printStatementTotals(statement: QuickOrderFinancialStatement): Readonly<{
  kind: QuickOrderFinancialStatement["charges"]["kind"];
  laborGrossJmd: number;
  laborNetJmd: number;
  partsGrossJmd: number;
  partsNetJmd: number;
  laborDiscountJmd: number;
  partsDiscountJmd: number;
  otherFeeTotalJmd: number;
  parkingTotalJmd: number;
  totalDiscountJmd: number;
  chargeSubtotalJmd: number;
  adjustmentsJmd: number;
  grandTotalJmd: number;
}> {
  if (statement.charges.kind === "legacy_quick") {
    const totals = statement.charges.totals;
    return {
      kind: "legacy_quick",
      laborGrossJmd: totals.laborGrossJmd,
      laborNetJmd: totals.laborGrossJmd - totals.laborDiscountJmd,
      partsGrossJmd: totals.partsGrossJmd,
      partsNetJmd: totals.partsGrossJmd - totals.partsDiscountJmd,
      laborDiscountJmd: totals.laborDiscountJmd,
      partsDiscountJmd: totals.partsDiscountJmd,
      otherFeeTotalJmd: 0,
      parkingTotalJmd: 0,
      totalDiscountJmd: totals.totalDiscountJmd,
      chargeSubtotalJmd: totals.grandTotalJmd,
      adjustmentsJmd: 0,
      grandTotalJmd: totals.grandTotalJmd,
    };
  }
  const totals = statement.charges.totals;
  return {
    kind: statement.charges.kind,
    laborGrossJmd: totals.laborGrossJmd,
    laborNetJmd: totals.laborNetJmd,
    partsGrossJmd: totals.partsGrossJmd,
    partsNetJmd: totals.partsNetJmd,
    laborDiscountJmd: totals.laborDiscountJmd,
    partsDiscountJmd: totals.partsDiscountJmd,
    otherFeeTotalJmd: totals.otherFeeTotalJmd,
    parkingTotalJmd: totals.parkingTotalJmd,
    totalDiscountJmd: totals.totalDiscountJmd,
    chargeSubtotalJmd: totals.chargeSubtotalJmd,
    adjustmentsJmd: "adjustmentsJmd" in totals ? totals.adjustmentsJmd : 0,
    grandTotalJmd: totals.grandTotalJmd,
  };
}

function printSourceLabel(statement: QuickOrderFinancialStatement): string {
  if (statement.source.kind === "canonical_invoice") {
    return `正式发票 ${statement.source.invoiceNo} · V${statement.source.versionNo}`;
  }
  if (statement.source.kind === "shared_uninvoiced") return "未开票 · 暂记应收 / Provisional Business Order";
  if (statement.source.kind === "legacy_quick") return "旧版类别优惠 / Legacy category discount";
  throw new Error("unsupported QuickOrder statement source");
}


export function QuickOrderPrintSheet({ orderId }: { orderId: string }) {
  const params = useSearchParams();
  const copy = (params.get("copy") ?? "zh") as CopyKind;
  const pdfMode = params.get("pdf") === "1";
  const needsStatement = copy !== "technician";
  const [order, setOrder] = useState<QuickOrder | null>(null);
  const [workspace, setWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [statement, setStatement] = useState<QuickOrderFinancialStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Readonly<{ key: string; epoch: number }> | null>(null);
  const [dataSessionEpoch, setDataSessionEpoch] = useState<number | null>(null);
  const requestGenerationRef = useRef(0);

  const clearSessionBoundState = useCallback(() => {
    setOrder(null);
    setWorkspace(null);
    setStatement(null);
    setError(null);
    setLoading(true);
    setDataSessionEpoch(null);
  }, []);

  useEffect(() => {
    const syncSession = () => {
      requestGenerationRef.current += 1;
      clearSessionBoundState();
      const key = currentSessionKey();
      setSession((current) => ({ key, epoch: (current?.epoch ?? 0) + 1 }));
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

  const readSnapshot = useCallback(async (): Promise<QuickOrderPrintSnapshot> => {
    const customerWorkspacePromise = reloadWorkspaceFresh();
    if (!needsStatement) {
      const [detail, customerWorkspace] = await Promise.all([
        api.quickOrders.detail(orderId),
        customerWorkspacePromise,
      ]);
      if (detail.id !== orderId) throw new Error("业务单打印坐标不一致");
      return { order: detail, statement: null, workspace: customerWorkspace };
    }
    const [detail, nextStatement, customerWorkspace] = await Promise.all([
      api.quickOrders.detail(orderId),
      api.quickOrderFinancials.statement(orderId),
      customerWorkspacePromise,
    ]);
    if (detail.id !== orderId || nextStatement.order.id !== orderId) {
      throw new Error("业务单打印与 statement 坐标不一致");
    }
    return { order: detail, statement: nextStatement, workspace: customerWorkspace };
  }, [needsStatement, orderId]);

  const responseIsCurrent = useCallback((capturedSessionKey: string, generation: number) => (
    requestGenerationRef.current === generation && currentSessionKey() === capturedSessionKey
  ), []);

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
    void readSnapshot().then((snapshot) => {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setOrder(snapshot.order);
      setStatement(snapshot.statement);
      setWorkspace(snapshot.workspace);
      setDataSessionEpoch(capturedEpoch);
    }).catch((caught) => {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setOrder(null);
      setStatement(null);
      setWorkspace(null);
      setDataSessionEpoch(capturedEpoch);
      setError(caught instanceof Error ? caught.message : "加载失败");
    }).finally(() => {
      if (!responseIsCurrent(capturedSessionKey, generation)) return;
      setLoading(false);
    });
    return () => { requestGenerationRef.current += 1; };
  }, [clearSessionBoundState, readSnapshot, responseIsCurrent, session]);

  if (error) return <div className="p-6 text-sm text-rose-600" data-testid="quick-print-error">{error}</div>;
  if (loading || !order || !workspace || session === null || dataSessionEpoch !== session.epoch || (needsStatement && !statement)) {
    return <div className="p-6 text-sm text-neutral-500" data-testid="quick-print-loading">读取中…</div>;
  }

  const customerId = statement?.order.customerId ?? order.customerId;
  const vehicleId = statement?.order.vehicleId ?? order.vehicleId;
  const customer = workspace.customers.find((candidate) => candidate.id === customerId) ?? null;
  const vehicle = workspace.vehicles.find((candidate) => candidate.id === vehicleId) ?? null;
  const rawTotals = quickOrderTotals(order);
  const statementTotals = statement ? printStatementTotals(statement) : null;
  const finance = statement ? statement.ledger : {
    receivableJmd: 0,
    grossPaidJmd: 0,
    cashRefundedJmd: 0,
    receivableReductionJmd: 0,
    netPaidJmd: 0,
    balanceJmd: 0,
  };
  const teamName = teamNameOf(order.teamId) ?? "—";
  const isEn = copy === "en";
  const showPrices = copy !== "technician"; // 维修工联不显示价格（老板定的）
  const bilingual = copy === "office";
  const itemCols = copy === "technician" ? 3 : 2; // 项目跨列（含完成勾选列）

  const zhName = customer?.nameZh ?? customer?.organizationName ?? customer?.nameEn ?? "—";
  const enName = customer?.nameEn ?? customer?.nameZh ?? customer?.organizationName ?? "—";
  const customerName = isEn
    ? enName
    : bilingual && customer?.nameEn && customer.nameZh && customer.nameEn !== customer.nameZh
      ? `${zhName} / ${enName}`
      : zhName;
  const vehicleModelText = vehicle
    ? isEn
      ? [vehicle.model, vehicle.modelZh].filter(Boolean).join(" / ")
      : [vehicle.modelZh ?? vehicle.model, vehicle.model].filter(Boolean).join(" / ")
    : "—";

  const t = (zh: string, en: string) => (isEn ? en : bilingual ? `${zh} / ${en}` : zh);
  const fallbackTitle = isEn ? COPY_TITLES_EN[copy] : COPY_TITLES[copy];
  const title = copy === "technician" || statement === null
    ? fallbackTitle
    : statement.source.kind === "canonical_invoice"
      ? t("正式发票 · 客户联", "Invoice · Customer Copy")
      : statement.source.kind === "shared_uninvoiced"
        ? t("未开票业务单 · 客户联", "Provisional Business Order · Customer Copy")
        : t("Business Order · 客户联", "Business Order · Customer Copy");
  const documentNumber = statement?.source.kind === "canonical_invoice" && copy !== "technician"
    ? `${statement.source.invoiceNo} · V${statement.source.versionNo}`
    : order.businessOrderNo;

  const chargeLines: ReadonlyArray<PrintChargeLine> = statement
    ? printStatementLines(statement)
    : quickOrderCanonicalChargeLines(order).map((line) => line.pricingMode === "unit" ? {
        id: line.id,
        pricingMode: "unit" as const,
        category: line.category,
        descZh: line.descZh,
        descEn: line.descEn,
        unit: line.unit,
        quantity: line.quantity,
        unitPriceJmd: line.unitPriceJmd,
        unitDiscountJmd: line.unitDiscountJmd,
        pendingQuote: line.pendingQuote,
      } : {
        id: line.id,
        pricingMode: line.pricingMode,
        descZh: line.descZh,
        descEn: line.descEn,
        amountJmd: line.amountJmd,
      });
  const laborRows = chargeLines.filter(
    (item): item is Extract<PrintChargeLine, { pricingMode: "unit" }> => item.pricingMode === "unit" && item.category === "labor",
  );
  const partsRows = chargeLines.filter(
    (item): item is Extract<PrintChargeLine, { pricingMode: "unit" }> => item.pricingMode === "unit" && item.category === "parts",
  );
  const fixedRows = chargeLines.filter(
    (item): item is Extract<PrintChargeLine, { pricingMode: "fixed_total" | "parking_projection" }> => item.pricingMode !== "unit",
  );
  const laborSubtotalJmd = statementTotals?.laborGrossJmd ?? rawTotals.laborJmd;
  const laborNetJmd = statementTotals?.laborNetJmd ?? laborSubtotalJmd;
  const partsSubtotalJmd = statementTotals?.partsGrossJmd ?? rawTotals.partsJmd;
  const partsNetJmd = statementTotals?.partsNetJmd ?? partsSubtotalJmd;
  const laborDiscountJmd = statementTotals?.laborDiscountJmd ?? 0;
  const partsDiscountJmd = statementTotals?.partsDiscountJmd ?? 0;
  const otherFeeTotalJmd = statementTotals?.otherFeeTotalJmd ?? rawTotals.otherServiceJmd;
  const parkingTotalJmd = statementTotals?.parkingTotalJmd ?? 0;
  const totalDiscountJmd = statementTotals?.totalDiscountJmd ?? laborDiscountJmd + partsDiscountJmd;
  const chargeSubtotalJmd = statementTotals?.chargeSubtotalJmd ?? rawTotals.totalJmd;
  const adjustmentsJmd = statementTotals?.adjustmentsJmd ?? 0;
  const grandTotalJmd = statementTotals?.grandTotalJmd ?? rawTotals.totalJmd;
  const displayStatus = statement?.order.status ?? order.status;

  return (
    <div data-testid={`quick-print-sheet-${copy}`} className="mx-auto max-w-[210mm] bg-white p-10 text-[13px] leading-relaxed text-neutral-900 print:p-8">
      <style>{`@media print { .no-print { display: none; } body { background: white; } }`}</style>
      {!pdfMode && (
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href={`/orders/business/${order.id}`} data-testid="quick-print-back"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink-soft hover:text-primary">
          ← 返回工单
        </Link>
        <button type="button" onClick={() => window.print()} data-testid="quick-print-do"
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">打印 / 存 PDF</button>
      </div>
      )}

      {/* 品牌头 */}
      <header className="flex items-start justify-between border-b-2 border-blue-800 pb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={WHOLE_HEARTED_COMPANY_IDENTITY.logoUrl} alt="Whole Hearted" className="h-14 w-14 flex-shrink-0 rounded-xl object-cover" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-blue-900">{WHOLE_HEARTED_COMPANY_IDENTITY.legalName}</h1>
            <p className="text-xs tracking-wide text-neutral-500">全心全意汽修服务 · Kingston, Jamaica</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-700">{copy === "zh" ? "中文客户联" : copy === "en" ? "English Customer Copy" : copy === "technician" ? "维修工联" : "办公室留档联"}</p>
          <h2 data-testid="quick-print-document-title" className="mt-0.5 text-base font-bold text-neutral-900">{title}</h2>
          <p className="mt-0.5 font-mono text-xs text-neutral-500"><span data-testid="quick-print-document-no">{documentNumber}</span> · {isEn ? QUICK_BO_STATUS_LABELS_EN[displayStatus] : QUICK_BO_STATUS_LABELS[displayStatus]}</p>
        </div>
      </header>

      {/* 公司信息条 */}
      <section className="mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-neutral-200 pb-3 text-[11px] text-neutral-500">
        <span>{WHOLE_HEARTED_COMPANY_IDENTITY.address}</span>
        <span>{WHOLE_HEARTED_COMPANY_IDENTITY.contactLine}</span>
        <span>TRN: {WHOLE_HEARTED_COMPANY_IDENTITY.trn}</span>
      </section>
      {statement ? (
        <p data-testid="quick-print-source" data-source-kind={statement.source.kind} className="mt-2 text-[11px] font-semibold text-blue-700">
          {printSourceLabel(statement)}
        </p>
      ) : null}

      {/* 三栏 meta */}
      <section className="mt-3 grid grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{t("客户", "CUSTOMER")}</p>
          <p className="mt-0.5 font-bold">{customerName}</p>
          <p className="text-xs text-neutral-500">{customer?.phone ?? (isEn ? "Phone pending" : "电话待补")}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{t("车辆／车架号", "VEHICLE / VIN")}</p>
          <p className="mt-0.5 font-bold">{vehicle?.plate ?? "—"}</p>
          <p className="text-xs text-neutral-500">{vehicleModelText}</p>
          <p className="font-mono text-[10px] text-neutral-400">VIN: {vehicle?.vin || "—"}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{t("打印日期", "PRINT DATE")}</p>
          <p className="mt-0.5 font-bold">{formatDateTime(new Date().toISOString())}</p>
          <p className="text-xs text-neutral-500">{t("班组", "Team")} {teamName} · {order.mechanicName ?? "—"}</p>
          <p className="text-xs text-neutral-500">{t("接车里程", "Mileage in")} {order.startMileageKm !== null ? `${order.startMileageKm.toLocaleString("en-US")} km` : "—"}</p>
        </div>
      </section>

      {/* 客户问题描述 */}
      <section className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{t("客户问题描述", "CUSTOMER CONCERN")}</p>
        <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-neutral-800">{order.rawInput || (isEn ? "Not provided" : "未填写")}</p>
        {copy === "technician" && order.noteZh ? (
          <p className="mt-1 text-xs text-neutral-500">{t("前台备注", "Front desk note")}：{order.noteZh}</p>
        ) : null}
      </section>

      {/* 收费项目表 */}
      <table className="mt-4 w-full border-collapse" data-testid="quick-print-charge-lines">
        <thead>
          <tr className="border-b-2 border-neutral-800 text-left text-[10px] uppercase tracking-widest text-neutral-400">
            <th className="w-8 py-2">{t("#", "#")}</th>
            <th className="py-2">{t("项目 / 收费说明", "ITEM / DESCRIPTION")}</th>
            {copy === "technician" && <th className="w-24 py-2 text-center">{t("完成", "Complete")}</th>}
            <th className="w-20 py-2 text-right">{t("数量", "QTY")}</th>
            {showPrices && <th className="w-28 py-2 text-right">{t("单价", "UNIT")}</th>}
            {showPrices && <th className="w-32 py-2 text-right">{t("小计", "AMOUNT")}</th>}
          </tr>
        </thead>
        <tbody>
          {laborRows.length > 0 && (
            <>
              <tr className="border-b border-neutral-100">
                <td colSpan={itemCols + (showPrices ? 3 : 1)} className="pt-3 pb-1 text-[11px] font-bold text-blue-700">{t("工时项目", "LABOR")}</td>
              </tr>
              {laborRows.map((item, index) => (
                <tr key={item.id} className="border-b border-neutral-100 align-top">
                  <td className="py-2 text-neutral-400">{index + 1}</td>
                  <td className="py-2 pr-3">
                    <p className="font-semibold">{isEn ? item.descEn : item.descZh}</p>
                    {bilingual && <p className="text-[11px] text-neutral-500">{item.descEn !== item.descZh ? item.descEn : ""}</p>}
                    {!bilingual && item.descEn && item.descEn !== (isEn ? item.descEn : item.descZh) && <p className="text-[11px] text-neutral-500">{isEn ? "" : item.descEn}</p>}
                  </td>
                  {copy === "technician" && <td className="py-2 text-center text-neutral-400">□</td>}
                  <td className="py-2 text-right tabular-nums">{item.quantity} {item.unit}</td>
                  {showPrices && <td className="py-2 text-right tabular-nums">{item.pendingQuote ? (isEn ? "TBD" : "待报价") : formatJMDFull(item.unitPriceJmd - item.unitDiscountJmd)}</td>}
                  {showPrices && <td className="py-2 text-right font-semibold tabular-nums">{item.pendingQuote ? "—" : formatJMDFull((item.unitPriceJmd - item.unitDiscountJmd) * item.quantity)}</td>}
                </tr>
              ))}
            </>
          )}
          {partsRows.length > 0 && (
            <>
              <tr className="border-b border-neutral-100">
                <td colSpan={itemCols + (showPrices ? 3 : 1)} className="pt-3 pb-1 text-[11px] font-bold text-amber-600">{t("配件项目", "PARTS")}</td>
              </tr>
              {partsRows.map((item, index) => (
                <tr key={item.id} className="border-b border-neutral-100 align-top">
                  <td className="py-2 text-neutral-400">{index + 1}</td>
                  <td className="py-2 pr-3">
                    <p className="font-semibold">{isEn ? item.descEn : item.descZh}</p>
                    {bilingual && <p className="text-[11px] text-neutral-500">{item.descEn !== item.descZh ? item.descEn : ""}</p>}
                    {!bilingual && !isEn && <p className="text-[11px] text-neutral-500">{item.descEn}</p>}
                  </td>
                  {copy === "technician" && <td className="py-2 text-center text-neutral-400">□</td>}
                  <td className="py-2 text-right tabular-nums">{item.quantity} {item.unit}</td>
                  {showPrices && <td className="py-2 text-right tabular-nums">{item.pendingQuote ? (isEn ? "TBD" : "待报价") : formatJMDFull(item.unitPriceJmd - item.unitDiscountJmd)}</td>}
                  {showPrices && <td className="py-2 text-right font-semibold tabular-nums">{item.pendingQuote ? "—" : formatJMDFull((item.unitPriceJmd - item.unitDiscountJmd) * item.quantity)}</td>}
                </tr>
              ))}
            </>
          )}
          {fixedRows.length > 0 && (
            <>
              <tr className="border-b border-neutral-100">
                <td colSpan={itemCols + (showPrices ? 3 : 1)} className="pt-3 pb-1 text-[11px] font-bold text-violet-700">{t("其他费用", "OTHER FEES")}</td>
              </tr>
              {fixedRows.map((item, index) => (
                <tr key={item.id} className="border-b border-neutral-100 align-top">
                  <td className="py-2 text-neutral-400">{index + 1}</td>
                  <td className="py-2 pr-3"><p className="font-semibold">{isEn ? (item.descEn || item.descZh) : item.descZh}</p>{bilingual && item.descEn ? <p className="text-[11px] text-neutral-500">{item.descEn}</p> : null}</td>
                  {copy === "technician" && <td className="py-2 text-center text-neutral-400">□</td>}
                  <td className="py-2 text-right">—</td>
                  {showPrices && <td className="py-2 text-right">{t("固定总额", "Fixed total")}</td>}
                  {showPrices && <td className="py-2 text-right font-semibold tabular-nums">{formatJMDFull(item.amountJmd)}</td>}
                </tr>
              ))}
            </>
          )}
        </tbody>
        {showPrices && (
          <tfoot>
            <tr>
              <td colSpan={itemCols} />
              <td colSpan={2} className="py-1.5 text-right text-xs text-neutral-500">{t("工时原价", "Labor gross")}</td>
              <td data-testid="quick-print-labor-gross" className="py-1.5 text-right font-semibold tabular-nums">{formatJMDFull(laborSubtotalJmd)}</td>
            </tr>
            <tr>
              <td colSpan={itemCols} />
              <td colSpan={2} className="py-1.5 text-right text-xs text-rose-600">{t("工时优惠", "Labor discount")}</td>
              <td data-testid="quick-print-labor-discount" className="py-1.5 text-right font-semibold tabular-nums text-rose-600">−{formatJMDFull(laborDiscountJmd)}</td>
            </tr>
            <tr>
              <td colSpan={itemCols} />
              <td colSpan={2} className="py-1.5 text-right text-xs text-neutral-500">{t("工时净额", "Labor net")}</td>
              <td data-testid="quick-print-labor-net" className="py-1.5 text-right font-semibold tabular-nums">{formatJMDFull(laborNetJmd)}</td>
            </tr>
            <tr>
              <td colSpan={itemCols} />
              <td colSpan={2} className="py-1.5 text-right text-xs text-neutral-500">{t("配件原价", "Parts gross")}</td>
              <td data-testid="quick-print-parts-gross" className="py-1.5 text-right font-semibold tabular-nums">{formatJMDFull(partsSubtotalJmd)}</td>
            </tr>
            <tr>
              <td colSpan={itemCols} />
              <td colSpan={2} className="py-1.5 text-right text-xs text-rose-600">{t("配件优惠", "Parts discount")}</td>
              <td data-testid="quick-print-parts-discount" className="py-1.5 text-right font-semibold tabular-nums text-rose-600">−{formatJMDFull(partsDiscountJmd)}</td>
            </tr>
            <tr>
              <td colSpan={itemCols} />
              <td colSpan={2} className="py-1.5 text-right text-xs text-neutral-500">{t("配件净额", "Parts net")}</td>
              <td data-testid="quick-print-parts-net" className="py-1.5 text-right font-semibold tabular-nums">{formatJMDFull(partsNetJmd)}</td>
            </tr>
            {statementTotals?.kind === "legacy_quick" ? (
              <tr>
                <td colSpan={itemCols} />
                <td colSpan={2} className="py-1.5 text-right text-xs text-rose-600">{t("优惠合计", "Total discount")}</td>
                <td data-testid="quick-print-total-discount" className="py-1.5 text-right font-semibold tabular-nums text-rose-600">−{formatJMDFull(totalDiscountJmd)}</td>
              </tr>
            ) : (
              <>
                <tr><td colSpan={itemCols} /><td colSpan={2} className="py-1.5 text-right text-xs text-neutral-500">{t("其他费用", "Other fees")}</td><td data-testid="quick-print-other-fee-total" className="py-1.5 text-right font-semibold tabular-nums">{formatJMDFull(otherFeeTotalJmd)}</td></tr>
                <tr><td colSpan={itemCols} /><td colSpan={2} className="py-1.5 text-right text-xs text-neutral-500">{t("停车费用", "Parking")}</td><td data-testid="quick-print-parking-total" className="py-1.5 text-right font-semibold tabular-nums">{formatJMDFull(parkingTotalJmd)}</td></tr>
                <tr><td colSpan={itemCols} /><td colSpan={2} className="py-1.5 text-right text-xs text-rose-600">{t("优惠合计", "Total discount")}</td><td data-testid="quick-print-total-discount" className="py-1.5 text-right font-semibold tabular-nums text-rose-600">−{formatJMDFull(totalDiscountJmd)}</td></tr>
                <tr><td colSpan={itemCols} /><td colSpan={2} className="py-1.5 text-right text-xs text-neutral-500">{t("收费小计", "Charge subtotal")}</td><td data-testid="quick-print-charge-subtotal" className="py-1.5 text-right font-semibold tabular-nums">{formatJMDFull(chargeSubtotalJmd)}</td></tr>
                {statementTotals?.kind === "canonical_invoice" ? (
                  <tr><td colSpan={itemCols} /><td colSpan={2} className="py-1.5 text-right text-xs text-neutral-500">{t("调整", "Adjustments")}</td><td data-testid="quick-print-adjustments" className="py-1.5 text-right font-semibold tabular-nums">{adjustmentsJmd < 0 ? `−${formatJMDFull(Math.abs(adjustmentsJmd))}` : formatJMDFull(adjustmentsJmd)}</td></tr>
                ) : null}
              </>
            )}
            <tr className="border-t-2 border-neutral-800">
              <td colSpan={itemCols} />
              <td colSpan={2} className="py-2 text-right text-sm font-bold">{t("总计（含 15% GCT）", "TOTAL (incl. 15% GCT)")}</td>
              <td data-testid="quick-print-grand-total" className="py-2 text-right text-lg font-bold tabular-nums text-blue-800">{formatJMDFull(grandTotalJmd)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* 备注（客户联） */}
      {copy !== "technician" && (order.noteZh || order.noteEn) && (
        <section className="mt-4 rounded-lg border border-neutral-200 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{t("备注", "NOTE")}</p>
          {isEn ? (
            <p className="mt-1 text-sm">{order.noteEn || order.noteZh}</p>
          ) : bilingual ? (
            <>
              {order.noteZh && <p className="mt-1 text-sm">{order.noteZh}</p>}
              {order.noteEn && <p className="mt-0.5 text-xs text-neutral-500">{order.noteEn}</p>}
            </>
          ) : (
            <p className="mt-1 text-sm">{order.noteZh || order.noteEn}</p>
          )}
        </section>
      )}

      {/* 收费凭证（老板 8/18）：客户联就是收费凭证——账单金额/已付/未付/余额/历次付款记录全在上面 */}
      {copy !== "technician" && (
        <section className="mt-4 rounded-lg border border-neutral-200 px-4 py-3" data-testid="quick-print-payment-statement">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{t("收费凭证", "PAYMENT STATEMENT")}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
            <p>{t("账单金额", "Billed")}<br /><b className="tabular-nums">{formatJMDFull(grandTotalJmd)}</b></p>
            <p>{t("已付", "Paid")}<br /><b className="tabular-nums text-emerald-600">{formatJMDFull(finance.netPaidJmd)}</b></p>
            {finance.cashRefundedJmd > 0 && <p>{t("已退现金", "Cash refunded")}<br /><b className="tabular-nums text-rose-600">−{formatJMDFull(finance.cashRefundedJmd)}</b></p>}
            <p>{t("未付余额", "Balance due")}<br /><b data-testid="quick-print-balance" className={cn("tabular-nums", finance.balanceJmd > 0 ? "text-rose-600" : "text-emerald-600")}>{finance.balanceJmd > 0
              ? formatJMDFull(finance.balanceJmd)
              : finance.balanceJmd < 0
                ? `${t("客户贷方", "Customer credit")} ${formatJMDFull(Math.abs(finance.balanceJmd))}`
                : (isEn ? "Settled" : "已结清")}</b></p>
          </div>
          {statement && statement.entries.length > 0 ? (
            <table className="mt-3 w-full border-collapse text-[11px]" data-testid="quick-print-payment-records">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-400">
                  <th className="py-1">{t("时间", "Time")}</th>
                  <th className="py-1 text-right">{t("金额", "Amount")}</th>
                  <th className="py-1 text-right">{t("方式", "Method")}</th>
                  <th className="py-1 text-right">{t("经办人", "By")}</th>
                </tr>
              </thead>
              <tbody>
                {statement.entries.map((entry) => entry.kind === "payment" ? (
                  <tr key={`payment-${entry.paymentId}`} className="border-b border-neutral-100">
                    <td className="py-1">{formatDateTime(entry.occurredAt)}</td>
                    <td className="py-1 text-right font-semibold text-emerald-600 tabular-nums">+{formatJMDFull(entry.amountJmd)}</td>
                    <td className="py-1 text-right">{entry.method ?? "—"}</td>
                    <td className="py-1 text-right">{entry.actorName ?? "—"}</td>
                  </tr>
                ) : entry.accounting === "legacy_cash_only" ? (
                  <tr key={`refund-${entry.refundId}`} className="border-b border-neutral-100">
                    <td className="py-1">{formatDateTime(entry.occurredAt)}</td>
                    <td className="py-1 text-right font-semibold text-rose-600 tabular-nums">−{formatJMDFull(entry.cashRefundJmd)}</td>
                    <td className="py-1 text-right">{t("退款", "Refund")}{entry.lineDescription ? ` · ${entry.lineDescription}` : ""}</td>
                    <td className="py-1 text-right">{entry.actorName ?? "—"}</td>
                  </tr>
                ) : entry.accounting === "parking_correction_v1" ? (
                  <tr key={`refund-${entry.refundId}`} className="border-b border-neutral-100">
                    <td className="py-1">{formatDateTime(entry.occurredAt)}<br />{entry.lineDescription}</td>
                    <td className="py-1 text-right font-semibold text-rose-600 tabular-nums">−{formatJMDFull(entry.cashRefundJmd)}</td>
                    <td className="py-1 text-right">{t("停车费更正退款", "Parking correction refund")}</td>
                    <td className="py-1 text-right">{entry.actorName}</td>
                  </tr>
                ) : (
                  <tr key={`refund-${entry.refundId}`} className="border-b border-neutral-100">
                    <td className="py-1">{formatDateTime(entry.occurredAt)}<br />{isEn ? entry.line.descEn : entry.line.descZh}</td>
                    <td className="py-1 text-right tabular-nums">
                      <span className="block font-semibold text-rose-600">
                        {isEn
                          ? `Receivable reduction ${formatJMDFull(entry.receivableReductionJmd)}`
                          : `应收冲减 ${formatJMDFull(entry.receivableReductionJmd)}${bilingual ? ` / Receivable reduction ${formatJMDFull(entry.receivableReductionJmd)}` : ""}`}
                      </span>
                      <span className="block">
                        {isEn
                          ? `Cash returned ${formatJMDFull(entry.cashRefundJmd)} · ${entry.cashRefundJmd > 0 ? "Cash returned" : "No cash returned"}`
                          : `实际退还现金 ${formatJMDFull(entry.cashRefundJmd)} · ${entry.cashRefundJmd > 0 ? "已退还现金" : "未退还现金"}${bilingual ? ` / Cash returned ${formatJMDFull(entry.cashRefundJmd)} · ${entry.cashRefundJmd > 0 ? "Cash returned" : "No cash returned"}` : ""}`}
                      </span>
                    </td>
                    <td className="py-1 text-right">{entry.method}</td>
                    <td className="py-1 text-right">{entry.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-xs text-neutral-400">{t("尚无付款记录", "No payment records yet")}</p>
          )}
        </section>
      )}

      {/* 维修工联：检查结果与签字 */}
      {copy === "technician" && (
        <section className="mt-6 space-y-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">检查结果 / 施工备注 · Inspection Result</p>
            <div className="mt-2 h-28 rounded border border-neutral-300" />
          </div>
          <div className="grid grid-cols-2 gap-8">
            <p className="border-b border-neutral-400 pb-1 text-sm">维修工签字：</p>
            <p className="border-b border-neutral-400 pb-1 text-sm">日期：</p>
          </div>
          <div className="grid grid-cols-2 gap-8">
            <p className="border-b border-neutral-400 pb-1 text-sm">前台代录签字：</p>
            <p className="border-b border-neutral-400 pb-1 text-sm">日期：</p>
          </div>
        </section>
      )}

      {/* 客户联签字行 */}
      {(copy === "zh" || copy === "en") && (
        <section className="mt-10 grid grid-cols-2 gap-8">
          <p className="border-b border-neutral-400 pb-1 text-sm">{isEn ? "Customer signature:" : "客户签字："}</p>
          <p className="border-b border-neutral-400 pb-1 text-sm">{isEn ? "Date:" : "日期："}</p>
        </section>
      )}

      {/* 办公室联：客户签字回传存档标记 */}
      {copy === "office" && order.invoiceSignature && (
        <section className="mt-6 rounded-lg border border-emerald-300 px-4 py-3" data-testid="quick-print-signature-mark">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700">客户已签字（照片回传存档）</p>
          <p className="mt-1 text-sm">签字人：{order.invoiceSignature.signerName} · {formatDateTime(order.invoiceSignature.signedAt)} · 经办 {order.invoiceSignature.signedBy}</p>
        </section>
      )}

      <footer className="mt-8 border-t border-neutral-200 pt-3 text-center text-[10px] text-neutral-400">
        {WHOLE_HEARTED_COMPANY_IDENTITY.legalName} · {WHOLE_HEARTED_COMPANY_IDENTITY.footerAddress} · {order.businessOrderNo}
        {copy === "office" ? " · 办公室留档（中英参照）" : ""}
      </footer>
    </div>
  );
}
