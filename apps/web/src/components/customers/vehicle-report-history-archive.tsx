"use client";

import Link from "next/link";
import type { VehicleInspectionReportArchiveGroup } from "@/lib/api/mock-inspection-reports";
import { formatJMDFull } from "@/lib/utils";
import { formatIrJamaicaDateTime } from "@/lib/orders/ir-communication-time";

const COMMUNICATION_LABELS = {
  not_notified: "尚未通知客户",
  awaiting_reply: "已通知客户，等待回复",
  closed: "客户已回复，检查结果闭环",
} as const;
const RESPONSE_LABELS = { interested: "有意向", not_interested: "没意向" } as const;
const CHANNEL_LABELS = { sms: "短信", email: "Email", whatsapp: "WhatsApp", paper: "纸质", in_person: "当面" } as const;
const PROVIDER_MODE_LABELS = { mock_sms: "模拟短信", mock_email: "模拟邮件", manual_whatsapp: "WhatsApp 前台确认" } as const;
const PROVIDER_RESULT_LABELS = { accepted: "已接受", confirmed_sent: "已确认发送" } as const;

function legacyRecordLabel(record: Record<string, unknown>, fallback: string): string {
  for (const key of ["id", "inspectionReportNo", "quotationNo", "findingZh", "descriptionZh"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export function VehicleReportHistoryArchive({ groups }: { groups: VehicleInspectionReportArchiveGroup[] }) {
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <article key={group.reportId} data-testid={`vehicle-ir-history-${group.reportId}`} className="rounded-xl border border-line bg-white p-3 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><Link href={`/orders/inspections/${encodeURIComponent(group.reportId)}`} className="break-all font-mono text-xs font-bold text-primary hover:underline">{group.reportNo}</Link><p className="mt-1 text-[10px] text-ink-soft">Jamaica {formatIrJamaicaDateTime(group.submittedAt)}</p></div>
            <div className="text-right text-[10px] text-ink-soft"><p className="font-semibold text-ink">{COMMUNICATION_LABELS[group.communicationStatus]}</p><p>{group.currentResponse ? RESPONSE_LABELS[group.currentResponse] : "回复待记录"}</p></div>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div><h4 className="text-[11px] font-bold">检查发现</h4><div className="mt-1 space-y-1">{group.findings.map((finding) => <div key={finding.id} className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800"><p className="font-semibold">{finding.findingZh}</p><p className="mt-0.5 text-ink-soft">{finding.recommendationZh}</p></div>)}</div></div>
            <div><h4 className="text-[11px] font-bold">当前 Quotation · {group.quotation.quotationNo}</h4><div className="mt-1 space-y-1">{group.quotation.lines.length === 0 ? <p className="text-[11px] text-ink-soft">收费项目待补</p> : group.quotation.lines.map((line) => <div key={line.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800"><span>{line.descZh}</span><span className="shrink-0 tabular-nums">{line.pricingMode === "fixed_total" ? formatJMDFull(line.amountJmd) : line.pendingQuote ? "待报价" : formatJMDFull((line.unitPriceJmd - line.unitDiscountJmd) * line.quantity)}</span></div>)}</div></div>
          </div>
          <div className="mt-3 grid gap-2 text-[10px] text-ink-soft sm:grid-cols-4">
            <div className="rounded-lg border border-line p-2"><p className="font-semibold text-ink">客户文件</p><p>{group.generation ? `V${group.generation.version} · Jamaica ${formatIrJamaicaDateTime(group.generation.generatedAt)}` : "尚未生成"}</p></div>
            <div className="rounded-lg border border-line p-2"><p className="font-semibold text-ink">通知</p><p>{group.notificationHistory.length} 条</p></div>
            <div className="rounded-lg border border-line p-2"><p className="font-semibold text-ink">回复历史</p><p>{group.responseHistory.length} 条{group.currentResponse ? ` · ${RESPONSE_LABELS[group.currentResponse]}` : ""}</p></div>
            <div className="rounded-lg border border-line p-2"><p className="font-semibold text-ink">附件与旧史</p><p>现场照片 {group.photos.length} · legacy v{group.legacyHistory.sourceSchemaVersion}</p></div>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <section data-testid={`vehicle-ir-notification-history-${group.reportId}`} className="rounded-xl border border-line p-3">
              <h4 className="text-[11px] font-bold">完整通知历史</h4>
              {group.notificationHistory.length === 0 ? <p className="mt-2 text-[11px] text-ink-soft">尚无成功正式通知。</p> : <div className="mt-2 space-y-2">{group.notificationHistory.map((event) => (
                <div key={event.id} data-event-id={event.id} className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800">
                  <p className="break-all font-mono text-[10px] font-semibold text-primary">{event.id}</p>
                  <p className="mt-1 font-semibold">{CHANNEL_LABELS[event.channel as keyof typeof CHANNEL_LABELS] ?? event.channel} · Jamaica {formatIrJamaicaDateTime(event.recordedAt)}</p>
                  <p className="mt-1 break-words text-ink-soft">{event.target ?? "目标待核"}{event.language ? ` · ${event.language}` : ""}{event.actorName || event.actorId ? ` · ${event.actorName ?? event.actorId}` : ""}</p>
                  <p className="mt-1 break-words text-ink-soft">{event.providerMode ? `${PROVIDER_MODE_LABELS[event.providerMode as keyof typeof PROVIDER_MODE_LABELS] ?? event.providerMode}（${event.providerMode}） · ` : ""}{event.providerResult ? `${PROVIDER_RESULT_LABELS[event.providerResult as keyof typeof PROVIDER_RESULT_LABELS] ?? event.providerResult}（${event.providerResult}）` : event.source}</p>
                  {event.fileName ? <p className="mt-1 break-all font-mono text-ink-soft">{event.fileName}</p> : null}
                  {event.demoReportUrl ? <a href={event.demoReportUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all font-semibold text-primary hover:underline">演示报告链接（非 localhost）：{event.demoReportUrl}</a> : null}
                  {event.subject ? <p className="mt-1 font-semibold">{event.subject}</p> : null}
                  {event.message ? <p className="mt-1 whitespace-pre-wrap">{event.message}</p> : null}
                  {event.providerReference ? <p className="mt-1 break-all text-ink-faint">{event.providerReference}</p> : null}
                </div>
              ))}</div>}
            </section>
            <section data-testid={`vehicle-ir-response-history-${group.reportId}`} className="rounded-xl border border-line p-3">
              <h4 className="text-[11px] font-bold">完整回复历史</h4>
              {group.responseHistory.length === 0 ? <p className="mt-2 text-[11px] text-ink-soft">尚无客户回复。</p> : <div className="mt-2 space-y-2">{group.responseHistory.map((event) => (
                <div key={event.id} data-event-id={event.id} className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800">
                  <p className="break-all font-mono text-[10px] font-semibold text-primary">{event.id}</p>
                  <p className="mt-1 font-semibold">{event.result === "legacy_unclassified" ? "旧记录待分类" : RESPONSE_LABELS[event.result]} · Jamaica {formatIrJamaicaDateTime(event.recordedAt)}</p>
                  {event.note ? <p className="mt-1 whitespace-pre-wrap">{event.note}</p> : null}
                  <p className="mt-1 break-all text-ink-faint">{event.actorName ?? event.actorId ?? "旧记录操作人待核"}{event.supersedesEventId ? ` · 修订 ${event.supersedesEventId}` : ""}</p>
                </div>
              ))}</div>}
            </section>
          </div>
          <section className="mt-3 rounded-xl border border-line p-3 text-[11px]" data-testid={`vehicle-ir-legacy-history-${group.reportId}`}>
            <h4 className="font-bold">该次 IR 旧历史事实 · schema v{group.legacyHistory.sourceSchemaVersion}</h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              {([
                ["检查结果", group.legacyHistory.inspectionReports],
                ["检查项", group.legacyHistory.inspectionItems],
                ["Quotation", group.legacyHistory.quotations],
                ["收费项", group.legacyHistory.quotationItems],
              ] as const).map(([label, records]) => <div key={label} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800"><p className="font-semibold">{label} · {records.length}</p>{records.map((record, index) => <p key={`${label}-${index}`} className="mt-1 break-all text-ink-soft">{legacyRecordLabel(record as Record<string, unknown>, `${label} ${index + 1}`)}</p>)}</div>)}
            </div>
          </section>
        </article>
      ))}
    </div>
  );
}
