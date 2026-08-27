"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { InspectionReportListItem, QuotationItemDto } from "@/lib/api/mock-inspection-reports";
import type { InspectionReportStatus } from "@/lib/orders/inspection-report";

const STATUS_LABELS: Record<InspectionReportStatus, string> = {
  mechanic_submitted: "维修工已提交",
  ai_structured: "AI 已整理",
  awaiting_frontdesk: "待前台审核",
  returned_for_revision: "已退回修改",
  approved: "已审核",
  published: "已发布",
};

/**
 * 从本车报价单导入收费项目（2026-08-20 老板）：
 * 报价单随检查结果详情一起完善后开放导入——本车检查结果报价里的项目，
 * 勾选一张带进工单收费项（名称/备注/单位/数量/单价/待报价全部照搬）。
 */
export function QuoteImportDialog({ vehicleId, onClose, onImport }: {
  vehicleId: string | null;
  onClose: () => void;
  onImport?: (items: QuotationItemDto[], reportNo: string) => void;
}) {
  const [reports, setReports] = useState<InspectionReportListItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!vehicleId) { setReports([]); return; }
    api.inspectionReports.list()
      .then((result) => {
        if (!cancelled) setReports(result.items.filter((item) => item.vehicle.id === vehicleId));
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      });
    return () => { cancelled = true; };
  }, [vehicleId]);

  const importReport = async (report: InspectionReportListItem) => {
    setBusyId(report.id);
    setMessage(null);
    try {
      const detail = await api.inspectionReports.detail(report.id);
      const latest = detail.quotation.versions[detail.quotation.versions.length - 1];
      const items = latest?.items ?? [];
      if (items.length === 0) { setMessage("这张报价单还没有项目，先在检查结果详情里添加"); return; }
      onImport?.(items, detail.reportNo);
      setMessage("已带进 " + items.length + " 项收费项目");
      onClose();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "读取报价单失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="从报价单导入收费项目" data-testid="quote-import-dialog"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="my-auto w-full max-w-lg rounded-2xl border border-line bg-white p-5 shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink dark:text-slate-100">从本车报价单导入收费项目</h3>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">选一张本车的报价单，把项目带进工单收费项（名称/备注/单位/数量/单价照搬，待报价保持待报价）。</p>
          </div>
          <button type="button" data-testid="quote-import-close" onClick={onClose} aria-label="关闭"
            className="inline-flex min-h-8 items-center rounded-lg border border-line px-2.5 text-xs text-ink-soft hover:text-ink dark:border-slate-600 dark:text-slate-300">✕</button>
        </div>

        <div className="mt-3 space-y-2" data-testid="quote-import-list">
          {reports === null ? (
            <p className="py-6 text-center text-xs text-ink-faint dark:text-slate-500">正在读取本车检查结果…</p>
          ) : reports.length === 0 ? (
            <p data-testid="quote-import-empty" className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs leading-5 text-ink-soft dark:border-slate-600 dark:text-slate-400">
              本车暂无检查结果。先在检查结果里建好报价，再来这里导入。
            </p>
          ) : (
            reports.map((report) => (
              <div key={report.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-warm/40 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-700/30">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-bold text-ink dark:text-slate-100">{report.reportNo}</p>
                  <p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">{report.vehicle.plate} · {STATUS_LABELS[report.status]}</p>
                </div>
                <button type="button" disabled={busyId === report.id} data-testid={"quote-import-" + report.id} onClick={() => void importReport(report)}
                  className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                  {busyId === report.id ? "读取中…" : "导入收费项目"}
                </button>
              </div>
            ))
          )}
          {message ? <p role="status" className="text-[11px] text-violet-700 dark:text-violet-300">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}