"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { fetchFormalInspectionReport, recordFormalInspectionNotification, type FormalInspectionReportDetail } from "@/lib/api/formal-inspections";
import { formatDateTime } from "@/lib/utils";

const channelLabel = { sms: "短信", email: "Email", whatsapp: "WhatsApp" } as const;

export function FormalInspectionReportDetailView({ inspectionReportId }: { inspectionReportId: number }) {
  const [detail, setDetail] = useState<FormalInspectionReportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const load = useCallback(() => fetchFormalInspectionReport(inspectionReportId).then(setDetail), [inspectionReportId]);
  useEffect(() => { setDetail(null); setError(null); void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Inspection Report 读取失败")); }, [load, reload]);

  const notify = async (channel: "sms" | "email" | "whatsapp") => {
    if (!detail) return;
    const target = channel === "email" ? detail.customer.email : channel === "whatsapp" ? detail.customer.whatsapp ?? detail.customer.phone : detail.customer.phone;
    if (!target) { setError(`该客户没有可用${channelLabel[channel]}联系方式`); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      await recordFormalInspectionNotification({ inspectionReportId, channel, targetContact: target, noteOrReply: "已发起外部通知，待客户确认。" });
      const text = encodeURIComponent(`${detail.vehicle.plate} 检查结果 ${detail.report.reportNo}：${detail.report.summaryZh}`);
      const href = channel === "email" ? `mailto:${target}?subject=${encodeURIComponent(`Inspection Report ${detail.report.reportNo}`)}&body=${text}` : channel === "sms" ? `sms:${target}?body=${text}` : `https://wa.me/${target.replace(/\D/g, "")}?text=${text}`;
      window.open(href, "_blank", "noopener,noreferrer");
      setNotice("已留痕“通知已发起／待确认”；系统未把外部链接当作已送达。"); setReload((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "通知留痕失败"); } finally { setBusy(false); }
  };

  if (error && !detail) return <div className="p-5 text-center"><AlertCircle className="mx-auto text-rose-600" /><p className="mt-2 text-sm">{error}</p><button className="mt-3 rounded-lg border px-3 py-2 text-xs" onClick={() => setReload((value) => value + 1)}><RefreshCw size={13} className="mr-1 inline" />重试</button></div>;
  if (!detail) return <div className="m-5 h-[440px] animate-pulse rounded-[22px] bg-slate-100 dark:bg-slate-800" />;
  return <div className="px-3 py-3 sm:px-5"><div className="mx-auto max-w-[1280px]">
    <Link href="/orders/inspections" className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-ink-soft hover:text-primary"><ArrowLeft size={14} />返回检查结果列表</Link>
    <section className="mt-2 rounded-[22px] border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/40 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">检查结果 · Inspection Report</p><h1 className="mt-1 font-mono text-xl font-bold">{detail.report.reportNo}</h1><p className="mt-1 text-sm text-ink-soft">{detail.vehicle.plate} · {detail.vehicle.description} · {detail.customer.name ?? "未登记客户"}</p></div><span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary">{detail.report.status === "submitted" ? "已提交" : "草稿"}</span></div>
      {detail.sourceBusinessOrder ? <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50/40 p-3 text-xs">来源 Business Order：<Link className="font-bold text-primary underline" href={`/orders/business/${detail.sourceBusinessOrder.id}`}>{detail.sourceBusinessOrder.orderNo}</Link>（本检查结果仍独立归属车辆）</div> : <div className="mt-3 rounded-xl border border-line bg-surface p-3 text-xs text-ink-soft">独立检查结果：未关联 Business Order。</div>}
      <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_.8fr]"><section className="rounded-xl border border-line p-4"><h2 className="text-sm font-bold">检查结论</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{detail.report.summaryZh}</p><div className="mt-4 space-y-2">{detail.report.findings.map((finding) => <article key={finding.id} className="rounded-lg bg-surface p-3"><b className="text-sm">{finding.sortOrder}. {finding.findingZh}</b>{finding.recommendationZh ? <p className="mt-1 text-xs text-ink-soft">建议：{finding.recommendationZh}</p> : null}</article>)}</div></section><aside className="space-y-3"><section className="rounded-xl border border-line p-4"><h2 className="text-sm font-bold">检查事实</h2><p className="mt-2 text-xs text-ink-soft">检查人：{detail.inspectorName ?? "待补"}</p><p className="mt-1 text-xs text-ink-soft">创建：{formatDateTime(detail.report.createdAt)}</p><p className="mt-1 text-xs text-ink-soft">提交：{detail.report.submittedAt ? formatDateTime(detail.report.submittedAt) : "尚未提交"}</p></section><section className="rounded-xl border border-line p-4"><h2 className="text-sm font-bold">通知客户</h2><p className="mt-1 text-[11px] text-ink-soft">点击会先记录“已发起／待确认”，不会伪造送达。</p><div className="mt-3 flex flex-wrap gap-2">{(["whatsapp", "sms", "email"] as const).map((channel) => <button key={channel} type="button" disabled={busy} onClick={() => void notify(channel)} className="min-h-9 rounded-lg border border-primary-200 px-3 text-xs font-semibold text-primary disabled:opacity-50">{channelLabel[channel]}</button>)}</div></section></aside></div>
      <section className="mt-3 rounded-xl border border-line p-4"><h2 className="text-sm font-bold">客户通知留痕</h2>{detail.communications.length === 0 ? <p className="mt-2 text-xs text-ink-soft">尚未发起通知。</p> : <div className="mt-2 space-y-2">{detail.communications.map((communication) => <div key={communication.id} className="rounded-lg bg-surface px-3 py-2 text-xs"><b>{channelLabel[communication.channel]}</b> · {communication.targetContact} · <span className="font-semibold">{communication.status === "initiated" ? "已发起／待确认" : communication.status}</span><span className="ml-2 text-ink-soft">{formatDateTime(communication.initiatedAt)}</span></div>)}</div>}</section>
      {notice ? <p className="mt-3 text-xs font-semibold text-emerald-700">{notice}</p> : null}{error ? <p className="mt-3 text-xs font-semibold text-rose-600">{error}</p> : null}
    </section>
  </div></div>;
}
