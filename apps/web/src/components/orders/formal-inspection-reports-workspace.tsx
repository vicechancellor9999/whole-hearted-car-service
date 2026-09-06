"use client";

import { startTransition, useCallback, useEffect, useOptimistic, useRef, useState } from "react";
import Link from "next/link";
import styles from "./inspection-report-list.module.css";
import { AlertCircle, RefreshCw, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FormalInspectionCreateDialog } from "@/components/orders/formal-inspection-create-dialog";
import { InspectionCreationRecoveryPanel, useInspectionCreationRecovery } from "./inspection-creation-recovery";
import { fetchFormalInspectionReports, type FormalInspectionReportList } from "@/lib/api/formal-inspections";
import {
  deriveInspectionFollowupStage,
  inspectionContentVersionLabel,
  inspectionFollowupStageLabel,
  inspectionVehicleDescriptionForReport,
} from "@/lib/inspection/formal-inspection-ai";
import { useI18n } from "@/lib/i18n/language";
import { formatDateTime } from "@/lib/utils";

export function FormalInspectionReportsWorkspace() {
  const { language } = useI18n();
  const english = language === "en";
  const presentationLanguage = english ? "en" : "zh";
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const search = searchParams.get("search") ?? "";
  const [searchInput, setSearchInput] = useOptimistic(search);
  const [compositionInput, setCompositionInput] = useState<string | null>(null);
  const composing = useRef(false);
  const rawPage = searchParams.get("page");
  const requestedPage = Number(rawPage ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([page, search, retry]);
  const [response, setResponse] = useState<{ key: string; data: FormalInspectionReportList | null; error: string | null; currentAccountId?: number } | null>(null);
  const current = response?.key === requestKey ? response : null;
  const loading = current === null;
  const error = current?.error ?? null;
  const items = current?.data?.items ?? [];
  const total = current?.data?.total ?? 0;
  const pageCount = current?.data?.pageCount ?? 1;
  const currentPage = current?.data?.page ?? page;
  const detailQuery = new URLSearchParams();
  if (search) detailQuery.set("listSearch", search);
  if (currentPage > 1) detailQuery.set("listPage", String(currentPage));
  const reportHref = (id: number) => `/orders/inspections/${id}${detailQuery.size ? `?${detailQuery.toString()}` : ""}`;
  const [createOpen, setCreateOpen] = useState(false);
  const creationRecovery = useInspectionCreationRecovery(response?.currentAccountId);

  const updateQuery = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(queryString);
    for (const [key, value] of Object.entries(updates)) {
      if (value && !(key === "page" && value === "1")) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`/orders/inspections${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  }, [router, queryString]);

  const commitSearch = (value: string) => startTransition(() => {
    setSearchInput(value);
    updateQuery({ search: value || null, page: null });
  });

  useEffect(() => {
    let active = true;
    void fetchFormalInspectionReports({ page, search: search || undefined })
      .then((result) => {
        if (!active) return;
        if (!Number.isSafeInteger(result.currentAccountId) || (result.currentAccountId ?? 0) <= 0) throw new Error("当前账号资料未能确认，请重新读取后再新建检查结果。");
        setResponse({ key: requestKey, data: result, error: null, currentAccountId: result.currentAccountId });
        const canonicalPage = result.page > 1 ? String(result.page) : null;
        if (rawPage !== canonicalPage) updateQuery({ page: canonicalPage });
      })
      .catch((caught) => { if (active) setResponse(previous => ({ key: requestKey, data: null, error: caught instanceof Error ? caught.message : "无法读取检查结果", currentAccountId: previous?.currentAccountId })); });
    return () => { active = false; };
  }, [page, rawPage, requestKey, search, updateQuery]);

  return <div data-testid="inspection-reports-workspace" className="px-3 py-3 sm:px-5"><div className="mx-auto w-full max-w-[1720px]">
    <PageHeader breadcrumb="工单管理" title="检查结果" description="Inspection Report 是独立检查成果，必须归属车辆；可选关联来源 Business Order。" />
    <InspectionCreationRecoveryPanel attempts={creationRecovery.attempts} storageAvailable={creationRecovery.storageAvailable} onDismiss={creationRecovery.dismiss} onRestore={(attempt) => { creationRecovery.restore(attempt); setCreateOpen(true); }} />
    <div className="mt-3 flex items-center justify-end gap-3">{!response?.currentAccountId ? <span className="text-xs text-ink-soft">{error ? "请先重试读取账号资料" : "正在确认当前账号…"}</span> : null}<button type="button" disabled={!response?.currentAccountId} onClick={() => setCreateOpen(true)} className="min-h-10 rounded-lg bg-violet-600 px-4 text-xs font-bold text-white disabled:cursor-wait disabled:opacity-50">新建检查结果</button></div>
    <section className="mt-3 rounded-[22px] border border-line bg-white/75 p-3 shadow-card dark:border-slate-700 dark:bg-slate-900/35 sm:p-4">
      <label className="relative block"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" /><span className="sr-only">搜索检查结果</span>
        <input data-testid="inspection-reports-search" value={compositionInput ?? searchInput}
          onCompositionStart={(event) => { composing.current = true; setCompositionInput(event.currentTarget.value); }}
          onCompositionEnd={(event) => { composing.current = false; setCompositionInput(null); commitSearch(event.currentTarget.value); }}
          onChange={(event) => { const value = event.target.value; if (composing.current) setCompositionInput(value); else commitSearch(value); }}
          placeholder="搜索车牌、客户、报告编号或检查结论" className="min-h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-primary-300 dark:bg-slate-800" />
      </label>
      <div role="status" className="mt-3 text-[11px] text-ink-soft">{loading ? "正在读取检查结果…" : error ? "" : `${total} 份检查结果`}</div>
      {loading ? <div data-testid="inspection-reports-loading" className="mt-3 h-[360px] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /> : null}
      {error ? <div role="alert" className="mt-3 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-rose-200 text-center"><AlertCircle className="text-rose-600" /><p className="mt-2 text-sm font-semibold">检查结果读取失败</p><p className="mt-1 text-xs text-ink-soft">{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm"><RefreshCw size={14} />重试</button></div> : null}
      {!loading && !error && items.length === 0 ? <div data-testid="inspection-report-empty" className="mt-3 rounded-2xl border border-dashed border-line py-16 text-center text-sm text-ink-soft">没有符合条件的检查结果。</div> : null}
      {!loading && !error && items.length > 0 ? <div className={styles.desktopTable}><table data-testid="inspection-reports-table" className="w-full table-fixed text-left text-xs"><thead><tr className="border-b border-line bg-surface text-[10px] text-ink-soft"><th className="px-3 py-2">{english ? "Report no." : "报告编号"}</th><th className="px-3 py-2">{english ? "Vehicle · Customer" : "车辆 · 客户"}</th><th className="px-3 py-2">{english ? "Team · Mechanic" : "提交班组 · 维修工"}</th><th className="px-3 py-2">{english ? "Source Business Order" : "来源 Business Order"}</th><th className="px-3 py-2">{english ? "Customer follow-up · Content" : "客户跟进 · 内容版本"}</th><th className="px-3 py-2">{english ? "Updated" : "更新"}</th></tr></thead><tbody>{items.map((item) => <tr key={item.report.id} data-testid="inspection-report-row" onClick={() => router.push(reportHref(item.report.id))} className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-primary-50/40"><td className="px-3 py-2.5 font-mono font-semibold text-primary"><Link href={reportHref(item.report.id)} className={styles.reportLink} onClick={(event) => event.stopPropagation()}>{item.report.reportNo}</Link></td><td className="px-3 py-2.5"><b>{item.vehicle.plate} · {inspectionVehicleDescriptionForReport(item.vehicle, presentationLanguage)}</b><div className="text-[10px] text-ink-soft">{item.customer.name ?? (english ? "Customer not recorded" : "未登记客户")}{item.customer.phone ? ` · ${item.customer.phone}` : ""}</div></td><td className="px-3 py-2.5"><b>{item.teamName}</b><div className="text-[10px] text-ink-soft">{item.inspectorName ?? (english ? "Mechanic not specified" : "维修工未填写")}</div></td><td className="px-3 py-2.5">{item.sourceBusinessOrder?.orderNo ?? (english ? "Independent inspection" : "独立检查")}</td><td className="px-3 py-2.5"><b>{inspectionFollowupStageLabel(item.followupStage ?? deriveInspectionFollowupStage(item.report.currentWorkspaceVersionNo ?? 0, []), presentationLanguage)}</b><div className="text-[10px] text-ink-soft">{inspectionContentVersionLabel(item.report.currentWorkspaceVersionNo ?? 0, presentationLanguage)}</div></td><td className="px-3 py-2.5 text-[10px] text-ink-soft">{formatDateTime(item.report.submittedAt ?? item.report.createdAt)}</td></tr>)}</tbody></table></div> : null}
      {!loading && !error && items.length > 0 ? <div data-testid="inspection-report-cards" className={styles.cards}>{items.map((item) => <Link key={item.report.id} href={reportHref(item.report.id)} className={styles.card}>
        <div className={styles.cardHeader}><span className={styles.reportNumber}>{item.report.reportNo}</span><span className={styles.stage}>{inspectionFollowupStageLabel(item.followupStage ?? deriveInspectionFollowupStage(item.report.currentWorkspaceVersionNo ?? 0, []), presentationLanguage)}</span></div>
        <strong className={styles.plate}>{item.vehicle.plate}</strong>
        <span className={styles.vehicle}>{inspectionVehicleDescriptionForReport(item.vehicle, presentationLanguage)}</span>
        <div className={styles.customer}><span>{item.customer.name ?? (english ? "Customer not recorded" : "未登记客户")}</span>{item.customer.phone ? <span className={styles.phone}>{item.customer.phone}</span> : null}</div>
        <dl className={styles.metadata}><div><dt>{english ? "Team · Mechanic" : "班组 · 维修工"}</dt><dd>{item.teamName} · {item.inspectorName ?? (english ? "Not specified" : "维修工未填写")}</dd></div><div><dt>{english ? "Source" : "来源"}</dt><dd>{item.sourceBusinessOrder?.orderNo ?? (english ? "Independent inspection" : "独立检查")}</dd></div></dl>
        <div className={styles.cardFooter}><span>{inspectionContentVersionLabel(item.report.currentWorkspaceVersionNo ?? 0, presentationLanguage)} · {formatDateTime(item.report.submittedAt ?? item.report.createdAt)}</span><span>{english ? "Open report →" : "查看报告 →"}</span></div>
      </Link>)}</div> : null}
      {!loading && !error && pageCount > 1 ? <nav className="mt-3 flex justify-end gap-2"><button disabled={currentPage <= 1} type="button" onClick={() => updateQuery({ page: String(currentPage - 1) })} className="min-h-11 rounded-lg border border-line px-3 text-xs disabled:opacity-40">上一页</button><span className="py-2 text-xs text-ink-soft">第 {currentPage} / {pageCount} 页</span><button disabled={currentPage >= pageCount} type="button" onClick={() => updateQuery({ page: String(currentPage + 1) })} className="min-h-11 rounded-lg border border-line px-3 text-xs disabled:opacity-40">下一页</button></nav> : null}
    </section>{createOpen ? <FormalInspectionCreateDialog key={response?.currentAccountId ?? "unverified"} initialDraft={creationRecovery.draft} onBackgroundStatus={creationRecovery.track} onClose={() => { setCreateOpen(false); creationRecovery.clearDraft(); }} onCreated={(_report, context) => { if (!creationRecovery.isCurrentScope()) return; if (!context?.background) { setCreateOpen(false); creationRecovery.clearDraft(); } setRetry((value) => value + 1); }} /> : null}
  </div></div>;
}
