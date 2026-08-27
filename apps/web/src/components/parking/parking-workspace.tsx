"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarClock, Car, RefreshCw, Wallet } from "lucide-react";
import Link from "next/link";
import { currentSessionKey } from "@/components/customers/detail-shared";
import { PageHeader } from "@/components/layout/page-header";
import { api } from "@/lib/api/client";
import { loadPaymentMethods } from "@/lib/payments/method-dictionary";
import { cn, formatJMDFull } from "@/lib/utils";

type ParkingList = Awaited<ReturnType<typeof api.parking.list>>;
type ParkingItem = ParkingList["items"][number];
type CorrectionPreview = Awaited<ReturnType<typeof api.parking.previewWaiver>>;
type CustomerWorkspace = Awaited<ReturnType<typeof api.customers.workspace>>;

function mutationId(stage: string): string {
  return `parking-ui-${stage}-${crypto.randomUUID()}`;
}

function dateLabel(value: string): string {
  const date = value.slice(0, 10);
  const [year, month, day] = date.split("-");
  return year && month && day ? `${year}年${Number(month)}月${Number(day)}日` : value;
}

function itemBalance(item: ParkingItem): number {
  return item.billing.status === "claimed"
    ? item.billing.ledger.balanceJmd
    : item.live.finalAmountJmd;
}

export function ParkingWorkspace() {
  const [list, setList] = useState<ParkingList | null>(null);
  const [workspace, setWorkspace] = useState<CustomerWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const [dataSessionKey, setDataSessionKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [waiverCaseId, setWaiverCaseId] = useState<string | null>(null);
  const [payCaseId, setPayCaseId] = useState<string | null>(null);
  const reloadGenerationRef = useRef(0);

  const reload = useCallback(async (requestedSessionKey?: string) => {
    const capturedSessionKey = requestedSessionKey ?? currentSessionKey();
    const generation = reloadGenerationRef.current + 1;
    reloadGenerationRef.current = generation;
    const responseIsCurrent = () => (
      reloadGenerationRef.current === generation
      && currentSessionKey() === capturedSessionKey
    );
    setActiveSessionKey(capturedSessionKey);
    setDataSessionKey(null);
    setList(null);
    setWorkspace(null);
    setLoading(true);
    setError(null);
    try {
      const [parking, customers] = await Promise.all([
        api.parking.list(),
        api.customers.workspace().catch(() => null),
      ]);
      if (!responseIsCurrent()) return;
      setList(parking);
      setWorkspace(customers);
      setDataSessionKey(capturedSessionKey);
    } catch (caught) {
      if (!responseIsCurrent()) return;
      setList(null);
      setWorkspace(null);
      setDataSessionKey(null);
      setError(caught instanceof Error ? caught.message : "无法读取停车费");
    } finally {
      if (responseIsCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const sessionChanged = () => {
      // Invalidate the previous generation before clearing every session-bound
      // projection and dialog. Its catch/finally blocks must not revive A data.
      reloadGenerationRef.current += 1;
      const nextSessionKey = currentSessionKey();
      setActiveSessionKey(nextSessionKey);
      setDataSessionKey(null);
      setList(null);
      setWorkspace(null);
      setError(null);
      setNotice(null);
      setWaiverCaseId(null);
      setPayCaseId(null);
      setLoading(true);
      void reload(nextSessionKey);
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === "wh_session" || event.key === null) sessionChanged();
    };
    window.addEventListener("storage", storageChanged);
    window.addEventListener("popstate", sessionChanged);
    sessionChanged();
    return () => {
      reloadGenerationRef.current += 1;
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("popstate", sessionChanged);
    };
  }, [reload]);

  const hasCurrentSessionData = list !== null
    && dataSessionKey !== null
    && dataSessionKey === activeSessionKey
    && dataSessionKey === currentSessionKey();
  const items = hasCurrentSessionData ? list.items : [];
  const totals = useMemo(() => ({
    gross: items.reduce((sum, item) => sum + item.live.grossAmountJmd, 0),
    waived: items.reduce((sum, item) => sum + item.committed.cumulativeWaivedAmountJmd, 0),
    final: items.reduce((sum, item) => sum + item.live.finalAmountJmd, 0),
  }), [items]);
  const waiverCase = items.find((item) => item.caseId === waiverCaseId) ?? null;
  const payCase = items.find((item) => item.caseId === payCaseId) ?? null;

  const customerName = useCallback((customerId: string) => {
    const customer = workspace?.customers.find((candidate) => candidate.id === customerId);
    return customer?.nameZh ?? customer?.nameEn ?? customer?.organizationName ?? customerId;
  }, [workspace]);
  const vehicleLabel = useCallback((vehicleId: string) => {
    const vehicle = workspace?.vehicles.find((candidate) => candidate.id === vehicleId);
    if (!vehicle) return vehicleId;
    return `${vehicle.plate} · ${vehicle.make} ${vehicle.model}`;
  }, [workspace]);

  return (
    <div data-testid="parking-workspace" className="px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-[1720px]">
        <PageHeader
          breadcrumb="收付款与交车"
          title="停车费"
          description="停车费以受保护的取车通知与已提交账单快照为准；减免、认领与收款均写入同一财务账本。"
        />

        <div data-testid="parking-calendar-rule" className="flex items-start gap-2 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-ink dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-200">
          <CalendarClock size={14} className="mt-0.5 shrink-0 text-primary" />
          <span>计费日历：通知日 D → D+1 宽限（免费）→ D+2 起 JMD 2,500/自然日；取车日不计费；后续提醒不重置 D。</span>
        </div>

        <div data-testid="parking-followup-summary" className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
          <span className="inline-flex min-h-8 items-center rounded-full border border-line bg-white/75 px-3 text-ink-soft dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300">跟进中 {items.filter((item) => item.pickupDate === null).length}</span>
          <span className="inline-flex min-h-8 items-center rounded-full border border-line bg-white/75 px-3 text-ink-soft dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300">已认领 {items.filter((item) => item.billing.status === "claimed").length}</span>
          <span className="inline-flex min-h-8 items-center rounded-full border border-line bg-white/75 px-3 text-ink-soft dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300">待收 {formatJMDFull(items.reduce((sum, item) => sum + itemBalance(item), 0))}</span>
        </div>

        {notice ? <div data-testid="parking-notice" role="status" className="mt-3 rounded-xl border border-primary-200 bg-primary-50/60 px-3 py-2 text-xs font-semibold text-primary dark:bg-primary-500/10 dark:text-primary-300">{notice}</div> : null}
        {loading ? <div data-testid="parking-loading" className="mt-3 h-[300px] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /> : null}
        {error ? (
          <div className="mt-3 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-rose-200 text-center dark:border-rose-500/30">
            <AlertCircle className="text-rose-600" />
            <p className="mt-2 text-sm font-semibold">停车费读取失败</p>
            <p className="mt-1 text-xs text-ink-soft">{error}</p>
            <button type="button" data-testid="parking-retry" onClick={() => void reload()} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm"><RefreshCw size={14} />重试</button>
          </div>
        ) : null}

        {!loading && !error && hasCurrentSessionData ? (
          <section data-testid="parking-cases" className="mt-3 rounded-[22px] border border-line bg-white/75 p-3 shadow-card dark:border-slate-700 dark:bg-slate-900/35 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-ink-soft dark:text-slate-400">
              <p>停车案件（{items.length}）</p>
              <div className="flex flex-wrap gap-3">
                <span data-testid="parking-summary-original">实时原额 {formatJMDFull(totals.gross)}</span>
                <span data-testid="parking-summary-waived">累计减免 {formatJMDFull(totals.waived)}</span>
                <span data-testid="parking-summary-final">实时应收 {formatJMDFull(totals.final)}</span>
              </div>
            </div>

            {items.length === 0 ? (
              <div data-testid="parking-empty" className="mt-3 rounded-2xl border border-dashed border-line py-16 text-center text-sm text-ink-soft">还没有已保护的停车费案件。</div>
            ) : (
              <div className="mt-3 space-y-2">
                {items.map((item) => {
                  const balance = itemBalance(item);
                  const canWaive = item.pickupDate === null
                    && item.live.chargeableDays > 0;
                  return (
                    <article key={item.caseId} data-testid={`parking-case-${item.vehicleId}`} className="rounded-2xl border border-line bg-white p-3 dark:border-slate-700 dark:bg-slate-800/70">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="inline-flex items-center gap-1 text-sm font-bold text-ink dark:text-slate-100"><Car size={14} />{vehicleLabel(item.vehicleId)}</p>
                          <p className="mt-0.5 text-xs text-ink-soft">{customerName(item.customerId)} · 通知 {dateLabel(item.notificationDate)}{item.pickupDate ? ` · 取车 ${dateLabel(item.pickupDate)}` : ""}</p>
                          <p className="mt-0.5 text-[10px] text-ink-faint">{item.caseId} · 来源 {item.originBusinessOrderId}</p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Link href="/payments" data-testid={`parking-payments-open-${item.vehicleId}`} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-semibold text-ink-soft hover:border-primary-300 hover:text-primary"><Wallet size={12} />收付款台账</Link>
                          {canWaive ? <button type="button" data-testid={`parking-waiver-open-${item.vehicleId}`} onClick={() => setWaiverCaseId(item.caseId)} className="min-h-8 rounded-lg border border-amber-200 px-3 text-xs font-semibold text-amber-700 hover:border-amber-300">减免</button> : null}
                          {balance > 0 ? <button type="button" data-testid={`parking-pay-open-${item.vehicleId}`} onClick={() => setPayCaseId(item.caseId)} className="min-h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700">收款</button> : null}
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                        <div data-testid={`parking-committed-${item.vehicleId}`} className="rounded-xl bg-surface px-3 py-2 dark:bg-slate-900/60">
                          <p className="text-[10px] text-ink-faint">已提交快照 · rev {item.committed.sourceRevision}</p>
                          <p className="mt-1 font-bold">{item.committed.chargeableDays} 天 · {formatJMDFull(item.committed.finalAmountJmd)}</p>
                        </div>
                        <div data-testid={`parking-live-${item.vehicleId}`} className="rounded-xl bg-blue-50 px-3 py-2 dark:bg-blue-500/10">
                          <p className="text-[10px] text-ink-faint">实时投影 · {item.live.calendarDate}</p>
                          <p className="mt-1 font-bold text-blue-700 dark:text-blue-300">{item.live.chargeableDays} 天 · {formatJMDFull(item.live.finalAmountJmd)}</p>
                        </div>
                        <div data-testid={`parking-billing-${item.vehicleId}`} className="rounded-xl bg-emerald-50 px-3 py-2 dark:bg-emerald-500/10">
                          {item.billing.status === "unclaimed" ? (
                            <><p className="text-[10px] text-ink-faint">账单状态</p><p className="mt-1 font-bold text-amber-700">未认领 · 待开票 {formatJMDFull(item.live.finalAmountJmd)}</p></>
                          ) : (
                            <><p className="text-[10px] text-ink-faint">{item.billing.invoiceNo}{item.billing.correctionRequired ? " · 待更正" : ""}</p><p className="mt-1 font-bold text-emerald-700">已认领 · 已收 {formatJMDFull(item.billing.ledger.netPaidJmd)} · 余额 {item.billing.ledger.balanceJmd > 0 ? formatJMDFull(item.billing.ledger.balanceJmd) : "已结清"}</p></>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
      </div>

      {waiverCase && list && hasCurrentSessionData ? (
        <WaiverDialog item={waiverCase} revision={list.revision} onClose={() => {
          setWaiverCaseId(null);
          void reload();
        }} onDone={(message) => {
          setWaiverCaseId(null);
          setNotice(message);
          void reload();
        }} />
      ) : null}
      {payCase && list && hasCurrentSessionData ? (
        <PaymentDialog item={payCase} list={list} onClose={() => setPayCaseId(null)} onDone={(message) => {
          setPayCaseId(null);
          setNotice(message);
          void reload();
        }} />
      ) : null}
    </div>
  );
}

function WaiverDialog({ item, revision, onClose, onDone }: {
  item: ParkingItem;
  revision: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("card");
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [previewMutationId] = useState(() => mutationId("waiver-preview"));
  const [applyMutationId] = useState(() => mutationId("waiver-apply"));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedDays = days.trim() === "" ? 0 : Number(days);

  const runPreview = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await api.parking.previewWaiver({
        caseId: item.caseId,
        expectedRevision: revision,
        expectedSourceRevision: item.committed.sourceRevision,
        mutationId: previewMutationId,
        waiveDays: parsedDays,
        reason: reason.trim(),
      });
      setPreview(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "预览失败");
    } finally {
      setPending(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    if (preview.parkingAdministratorSignatureRequired || preview.invoiceSignatureRequired) {
      setError("该减免需要受保护的签名凭证，请在管理员签名流程完成后再提交。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.parking.applyWaiver({
        caseId: item.caseId,
        expectedRevision: preview.latestRevision,
        expectedSourceRevision: preview.sourceRevision,
        mutationId: applyMutationId,
        previewToken: preview.previewToken,
        ...(preview.parkingCashRefundJmd > 0 ? { refundMethod } : {}),
      });
      onDone("停车费减免已生效");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "减免失败");
      setPending(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="停车费减免" data-testid="parking-waiver-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-bold text-ink dark:text-slate-100">停车费减免</h3>
        <p className="mt-1 text-[11px] text-ink-soft">实时 {item.live.chargeableDays} 天 / {formatJMDFull(item.live.finalAmountJmd)}；确认后写入受保护的减免决定。</p>
        {!preview ? (
          <>
            <label className="mt-3 block text-xs font-semibold">减免天数
              <input type="number" min={1} data-testid="parking-waiver-days" value={days} onChange={(event) => setDays(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm" />
            </label>
            <label className="mt-3 block text-xs font-semibold">减免原因
              <textarea rows={2} data-testid="parking-waiver-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
          </>
        ) : (
          <div data-testid="parking-waiver-preview-result" className="mt-3 space-y-1 rounded-xl bg-surface p-3 text-xs dark:bg-slate-900/60">
            <p>本次减免：{preview.proposedWaivedDays} 天 / {formatJMDFull(preview.proposedWaivedAmountJmd)}</p>
            <p>累计减免：{preview.cumulativeWaivedDays} 天 / {formatJMDFull(preview.cumulativeWaivedAmountJmd)}</p>
            <p>减免后应收：{preview.finalChargeableDays} 天 / {formatJMDFull(preview.finalAmountJmd)}</p>
            <p data-testid="parking-waiver-cash-refund">独立现金退款：{formatJMDFull(preview.parkingCashRefundJmd)}</p>
            {preview.parkingCashRefundJmd > 0 ? (
              <div className="pt-2 text-xs font-semibold">退款方式
                <div className="mt-1 grid grid-cols-3 gap-1.5" data-testid="parking-waiver-refund-methods">
                  {loadPaymentMethods().map((entry) => (
                    <button type="button" key={entry.value} data-testid={`parking-waiver-refund-method-${entry.value}`} onClick={() => setRefundMethod(entry.value)} className={cn("rounded-xl border px-2 py-2 text-xs font-semibold", refundMethod === entry.value ? "border-primary bg-primary-50 text-primary" : "border-line text-ink-soft")}>
                      {entry.zh}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
        {error ? <p data-testid="parking-waiver-error" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-line px-4 text-sm">取消</button>
          {!preview ? (
            <button type="button" data-testid="parking-waiver-preview" disabled={pending || !Number.isInteger(parsedDays) || parsedDays <= 0 || !reason.trim()} onClick={() => void runPreview()} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">预览减免</button>
          ) : (
            <button type="button" data-testid="parking-waiver-confirm" disabled={pending} onClick={() => void confirm()} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">确认减免</button>
          )}
        </div>
      </div>
    </div>
  );
}

function PaymentDialog({ item, list, onClose, onDone }: {
  item: ParkingItem;
  list: ParkingList;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const balance = itemBalance(item);
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMutationId] = useState(() => mutationId("payment"));
  const value = Number(amount);
  const invalid = !Number.isInteger(value) || value <= 0 || value > balance;

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const common = {
        contract: "parking_payment_collect_v1" as const,
        caseId: item.caseId,
        expectedRevision: list.revision,
        expectedSourceRevision: item.committed.sourceRevision,
        mutationId: paymentMutationId,
        amountJmd: value,
        method,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      if (item.billing.status === "claimed") {
        await api.parking.recordPayment({
          ...common,
          status: "claimed",
          invoiceId: item.billing.invoiceId,
          effectiveVersionId: item.billing.effectiveVersionId,
          balanceJmd: item.billing.ledger.balanceJmd,
        });
      } else {
        const eligibleBusinessOrderIds = [...item.billing.eligibleBusinessOrderIds].sort();
        const carrierBusinessOrderId = eligibleBusinessOrderIds.includes(item.originBusinessOrderId)
          ? item.originBusinessOrderId
          : eligibleBusinessOrderIds[0];
        if (!carrierBusinessOrderId) throw new Error("当前停车费没有可认领的业务单");
        const sourceProjections = list.items
          .filter((candidate) => candidate.billing.status === "unclaimed"
            && candidate.billing.eligibleBusinessOrderIds.includes(carrierBusinessOrderId))
          .map((candidate) => ({
            caseId: candidate.caseId,
            projectionCommitment: candidate.live.projectionCommitment,
          }))
          .sort((left, right) => left.caseId.localeCompare(right.caseId));
        await api.parking.recordPayment({
          ...common,
          status: "unclaimed",
          carrierBusinessOrderId,
          sourceProjections,
        });
      }
      onDone(`已收款 ${formatJMDFull(value)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "收款失败");
      setPending(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="停车费收款" data-testid="parking-pay-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-bold text-ink dark:text-slate-100">停车费收款</h3>
        <p className="mt-1 text-[11px] text-ink-soft">{item.caseId} · 可收 {formatJMDFull(balance)}；未认领案件会在同一提交中开票并绑定。</p>
        <label className="mt-3 block text-xs font-semibold">收款金额（JMD）
          <input type="number" min={1} max={balance} data-testid="parking-pay-amount" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm" />
        </label>
        <div className="mt-3 text-xs font-semibold">支付方式
          <div className="mt-1 grid grid-cols-3 gap-1.5" data-testid="parking-pay-methods">
            {loadPaymentMethods().map((entry) => (
              <button type="button" key={entry.value} data-testid={`parking-pay-method-${entry.value}`} onClick={() => setMethod(entry.value)} className={cn("rounded-xl border px-2 py-2 text-xs font-semibold", method === entry.value ? "border-primary bg-primary-50 text-primary" : "border-line text-ink-soft")}>
                {entry.zh}
              </button>
            ))}
          </div>
        </div>
        <label className="mt-3 block text-xs font-semibold">备注（可空）
          <input data-testid="parking-pay-note" value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm" />
        </label>
        {invalid ? <p className="mt-2 text-xs font-semibold text-rose-600">金额要在 1 到 {formatJMDFull(balance)} 之间</p> : null}
        {error ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-line px-4 text-sm">取消</button>
          <button type="button" data-testid="parking-pay-confirm" disabled={pending || invalid} onClick={() => void submit()} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "处理中…" : "确认收款"}</button>
        </div>
      </div>
    </div>
  );
}
