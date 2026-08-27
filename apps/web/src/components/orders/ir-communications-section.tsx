"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Mail, MessageCircle, Send, UserRoundCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import type {
  InspectionReportDetailResponse,
  InspectionCommunicationStaleDetails,
  RecordInspectionCustomerResponseInput,
  SendInspectionReportNotificationInput,
} from "@/lib/api/mock-inspection-reports";
import type { IrPdfLanguage } from "@/lib/orders/ir-pdf";
import { formatIrJamaicaDateTime } from "@/lib/orders/ir-communication-time";

const LANGUAGE_LABELS: Record<IrPdfLanguage, string> = { zh: "中文", en: "English", bilingual: "中英对照" };
const CHANNEL_LABELS = { sms: "短信", email: "Email", whatsapp: "WhatsApp", paper: "纸质", in_person: "当面" } as const;
const RESPONSE_LABELS = { interested: "有意向", not_interested: "没意向", legacy_unclassified: "旧记录待分类" } as const;
const PROVIDER_MODE_LABELS = { mock_sms: "模拟短信", mock_email: "模拟邮件", manual_whatsapp: "WhatsApp 前台确认" } as const;
const PROVIDER_RESULT_LABELS = { accepted: "已接受", confirmed_sent: "已确认发送" } as const;

function stableMutationId(ref: React.MutableRefObject<{ key: string; id: string } | null>, key: string, prefix: string): string {
  if (ref.current?.key !== key) ref.current = { key, id: `${prefix}-${crypto.randomUUID()}` };
  return ref.current.id;
}

function currentSessionScope(): string {
  if (typeof window === "undefined") return "server";
  return window.localStorage.getItem("wh_session") ?? "anonymous";
}

function staleDetails(error: unknown): InspectionCommunicationStaleDetails | null {
  const details = (error as { details?: unknown } | null)?.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const candidate = details as Partial<InspectionCommunicationStaleDetails>;
  return candidate.code === "INSPECTION_COMMUNICATION_STALE"
    && Number.isSafeInteger(candidate.latestRevision)
    && candidate.summary !== undefined
    ? candidate as InspectionCommunicationStaleDetails
    : null;
}

function demoReportUrl(detail: InspectionReportDetailResponse, language: IrPdfLanguage): string {
  return `https://demo.wholehearted.example/inspection-reports/${encodeURIComponent(detail.id)}/${language}`;
}

type NotificationChannel = "sms" | "email" | "whatsapp";

export function buildInspectionNotificationMessage(
  detail: InspectionReportDetailResponse,
  language: IrPdfLanguage,
  channel: NotificationChannel,
): string {
  const modelZh = detail.vehicle.modelZh ?? detail.vehicle.modelEn ?? "车型待补";
  const modelEn = detail.vehicle.modelEn ?? detail.vehicle.modelZh ?? "model pending";
  const parkingZh = detail.parkingNotice ? [
    `取车通知日为 ${detail.parkingNotice.notificationDate}（D），${detail.parkingNotice.graceThroughDate}（D+1）为免费宽限日；从 ${detail.parkingNotice.chargeStartsDate}（D+2）起按每天 JMD ${detail.parkingNotice.dailyRateJmd.toLocaleString("en-US")} 计停车费，取车当天不计费。`,
  ] : [];
  const parkingEn = detail.parkingNotice ? [
    `Pickup notice date is ${detail.parkingNotice.notificationDate} (D). ${detail.parkingNotice.graceThroughDate} (D+1) is the free grace day; parking is JMD ${detail.parkingNotice.dailyRateJmd.toLocaleString("en-US")} per day from ${detail.parkingNotice.chargeStartsDate} (D+2), excluding the pickup day.`,
  ] : [];
  const attachment = detail.quotation.activeGeneratedBundle?.attachments.find((candidate) => candidate.language === language);
  const bundleLabel = detail.quotation.activeGeneratedBundle && attachment
    ? `V${detail.quotation.activeGeneratedBundle.generation} · ${attachment.fileName}`
    : "当前语言文件待生成";
  const customerDeliveryZh = channel === "email"
    ? `本次模拟邮件附件：${bundleLabel}。`
    : `演示链接：${demoReportUrl(detail, language)}`;
  const customerDeliveryEn = channel === "email"
    ? `Mock email attachment: ${bundleLabel}.`
    : `Demo report link: ${demoReportUrl(detail, language)}`;
  const zh = [
    `${detail.customer.nameZh} 您好，`,
    `您的车辆（${modelZh} · ${detail.vehicle.plate}）检查结果已准备好。`,
    "请查看所选语言的客户文件，并请回复是否有意向安排后续维修。",
    customerDeliveryZh,
    ...(detail.parkingNotice ? ["如暂不安排维修，请及时联系前台取车。"] : []),
    ...parkingZh,
    "感谢您。",
    "Whole Hearted Car Service Ltd. · Kingston",
  ].join("\n");
  const enName = detail.customer.nameEn || detail.customer.nameZh;
  const en = [
    `Dear ${enName},`,
    `The inspection result for your vehicle (${modelEn} · ${detail.vehicle.plate}) is ready.`,
    "Please review the selected customer file and reply whether you would like to arrange the next repair step.",
    customerDeliveryEn,
    ...(detail.parkingNotice ? ["If you are not arranging repairs now, please contact the front desk to arrange timely pickup."] : []),
    ...parkingEn,
    "Thank you.",
    "Whole Hearted Car Service Ltd. · Kingston",
  ].join("\n");
  return language === "zh" ? zh : language === "en" ? en : `${zh}\n\n${en}`;
}

function finalCustomerMessage(
  draft: string,
  channel: NotificationChannel,
  language: IrPdfLanguage,
  selectedBundleLabel: string,
  reportDemoUrl: string,
): string {
  const normalized = draft.trim();
  if (channel === "email") {
    const label = language === "zh" ? "本次模拟邮件附件" : language === "en" ? "Mock email attachment" : "本次模拟邮件附件 / Mock email attachment";
    if (
      normalized.includes(`本次模拟邮件附件：${selectedBundleLabel}`)
      || normalized.includes(`Mock email attachment: ${selectedBundleLabel}`)
      || normalized.includes(`本次模拟邮件附件 / Mock email attachment：${selectedBundleLabel}`)
    ) return normalized;
    return `${normalized.split(selectedBundleLabel).join("").trim()}\n${label}：${selectedBundleLabel}`;
  }
  const label = language === "zh" ? "演示链接" : language === "en" ? "Demo report link" : "演示链接 / Demo report link";
  if (
    normalized.includes(`演示链接：${reportDemoUrl}`)
    || normalized.includes(`Demo report link: ${reportDemoUrl}`)
    || normalized.includes(`演示链接 / Demo report link：${reportDemoUrl}`)
  ) return normalized;
  return `${normalized.split(reportDemoUrl).join("").trim()}\n${label}：${reportDemoUrl}`;
}

export function IrCommunicationsSection({
  detail,
  canOperate,
  quotationDirty,
  onRefresh,
}: {
  detail: InspectionReportDetailResponse;
  canOperate: boolean;
  quotationDirty?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const availableLanguages = useMemo(
    () => detail.quotation.generatedFileStale
      ? []
      : detail.quotation.activeGeneratedBundle?.attachments.map((attachment) => attachment.language) ?? [],
    [detail.quotation.activeGeneratedBundle, detail.quotation.generatedFileStale],
  );
  const [language, setLanguage] = useState<IrPdfLanguage>(availableLanguages[0] ?? "zh");
  const [channel, setChannel] = useState<NotificationChannel>("sms");
  const [message, setMessage] = useState(() => buildInspectionNotificationMessage(detail, language, "sms"));
  const [subject, setSubject] = useState(`Inspection Report ${detail.reportNo}`);
  const [whatsappOpenedIntent, setWhatsappOpenedIntent] = useState<string | null>(null);
  const [responseResult, setResponseResult] = useState<"interested" | "not_interested">(detail.currentResponse ?? "interested");
  const [responseNote, setResponseNote] = useState("");
  const [busy, setBusy] = useState<"notification" | "response" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expectedRevision, setExpectedRevision] = useState(detail.revision);
  const [notificationStaleReview, setNotificationStaleReview] = useState<{ intentKey: string; details: InspectionCommunicationStaleDetails; refreshReady: boolean } | null>(null);
  const [responseStaleReview, setResponseStaleReview] = useState<{ intentKey: string; details: InspectionCommunicationStaleDetails } | null>(null);
  const notificationIntentRef = useRef<{ key: string; id: string } | null>(null);
  const responseIntentRef = useRef<{ key: string; id: string } | null>(null);
  const scopeRef = useRef<{ reportId: string; sessionScope: string; generation: number }>({ reportId: detail.id, sessionScope: currentSessionScope(), generation: 0 });
  const sessionScope = currentSessionScope();

  useEffect(() => {
    const nextLanguage = availableLanguages[0] ?? "zh";
    setLanguage(nextLanguage);
    setMessage(buildInspectionNotificationMessage(detail, nextLanguage, "sms"));
    setSubject(`Inspection Report ${detail.reportNo}`);
    setChannel("sms");
    setWhatsappOpenedIntent(null);
    setResponseResult(detail.currentResponse ?? "interested");
    setResponseNote("");
    setNotice(null);
    setExpectedRevision(detail.revision);
    setNotificationStaleReview(null);
    setResponseStaleReview(null);
    notificationIntentRef.current = null;
    responseIntentRef.current = null;
    scopeRef.current = { reportId: detail.id, sessionScope, generation: scopeRef.current.generation + 1 };
    return () => { scopeRef.current.generation += 1; };
  }, [detail.id, sessionScope]);

  useEffect(() => {
    setExpectedRevision(detail.revision);
  }, [detail.id, detail.revision]);

  const setTemplateLanguage = (nextLanguage: IrPdfLanguage) => {
    setLanguage(nextLanguage);
    setMessage(buildInspectionNotificationMessage(detail, nextLanguage, channel));
    setWhatsappOpenedIntent(null);
    setNotificationStaleReview(null);
  };

  const setNotificationChannel = (nextChannel: NotificationChannel) => {
    setMessage((current) => current === buildInspectionNotificationMessage(detail, language, channel)
      ? buildInspectionNotificationMessage(detail, language, nextChannel)
      : current);
    setChannel(nextChannel);
    setWhatsappOpenedIntent(null);
    setNotificationStaleReview(null);
  };

  const fileReady = availableLanguages.includes(language);
  const target = channel === "email" ? detail.customer.email : detail.customer.phone;
  const selectedAttachment = detail.quotation.activeGeneratedBundle?.attachments.find((attachment) => attachment.language === language) ?? null;
  const selectedBundleLabel = detail.quotation.activeGeneratedBundle && selectedAttachment
    ? `V${detail.quotation.activeGeneratedBundle.generation} · ${selectedAttachment.fileName}`
    : "当前语言文件待生成";
  const reportDemoUrl = demoReportUrl(detail, language);
  const finalMessage = finalCustomerMessage(message, channel, language, selectedBundleLabel, reportDemoUrl);
  const disabledReason = quotationDirty
    ? "Quotation 有尚未保存的修改；请保存并重新生成客户文件后再发送。"
    : !fileReady
    ? detail.quotation.generatedFileStale ? "客户文件已过期，请先重新生成。" : "尚未生成当前客户文件，请先在上方生成。"
    : !target
      ? channel === "email" ? "客户 Email 待补，不能发送。" : "客户电话待补，不能发送。"
      : null;
  const notificationBusinessIntentKey = JSON.stringify({ reportId: detail.id, channel, language, target, message: finalMessage, subject: channel === "email" ? subject.trim() : null });
  const responseBusinessIntentKey = JSON.stringify({ reportId: detail.id, result: responseResult, note: responseNote.trim() });
  const notificationNeedsReview = notificationStaleReview !== null;
  const responseNeedsReview = responseStaleReview !== null;
  const disabledReasonId = disabledReason ? "ir-notification-disabled-reason" : undefined;
  const staleCurrentResponseEvent = responseStaleReview?.details.summary.responseHistory
    .filter((event) => event.result !== "legacy_unclassified")
    .at(-1) ?? null;

  const captureScope = () => ({ ...scopeRef.current });
  const scopeIsCurrent = (scope: ReturnType<typeof captureScope>) => scopeRef.current.generation === scope.generation
    && scopeRef.current.reportId === scope.reportId
    && scopeRef.current.sessionScope === scope.sessionScope
    && currentSessionScope() === scope.sessionScope;

  const refreshNotificationFacts = async () => {
    if (!notificationStaleReview) return;
    const scope = captureScope();
    setBusy("notification");
    try {
      await onRefresh();
      if (!scopeIsCurrent(scope)) return;
      setNotificationStaleReview((current) => current ? { ...current, refreshReady: true } : null);
      setNotice("已读取最新客户、文件与沟通事实；请核对后明确确认。");
    } catch {
      if (scopeIsCurrent(scope)) setNotice("最新详情刷新失败；草稿和同一 mutation 意图已保留，禁止重新发送直至刷新成功。");
    } finally {
      if (scopeIsCurrent(scope)) setBusy(null);
    }
  };

  const send = async () => {
    const normalizedMessage = finalMessage;
    if (!normalizedMessage || disabledReason || notificationNeedsReview) return;
    const key = notificationBusinessIntentKey;
    const mutationId = stableMutationId(notificationIntentRef, key, "ir-notification");
    const base = { reportId: detail.id, expectedRevision, mutationId, language, message: normalizedMessage };
    const input: SendInspectionReportNotificationInput = channel === "email"
      ? { ...base, channel: "email", subject: subject.trim() }
      : channel === "whatsapp"
        ? { ...base, channel: "whatsapp", confirmedSent: true }
        : { ...base, channel: "sms" };
    setBusy("notification");
    setNotice(null);
    const scope = captureScope();
    try {
      const result = await api.inspectionReports.sendNotification(input);
      if (!scopeIsCurrent(scope)) return;
      setNotice(result.replayed
        ? "已确认此前通知记录，未重复发送。"
        : channel === "whatsapp"
          ? "前台已确认 WhatsApp 发送并记录；这不代表客户已读。"
          : `${channel === "email" ? "Mock 邮件" : "Mock 短信"} provider 已接受并记录；这不代表客户已收到或已读。`);
      notificationIntentRef.current = null;
      setWhatsappOpenedIntent(null);
      setNotificationStaleReview(null);
      try {
        await onRefresh();
        if (!scopeIsCurrent(scope)) return;
      } catch {
        if (scopeIsCurrent(scope)) setNotice("通知已记录；详情刷新失败，请手动刷新页面。");
      }
    } catch (caught) {
      if (!scopeIsCurrent(scope)) return;
      const stale = staleDetails(caught);
      if (stale) {
        setExpectedRevision(stale.latestRevision);
        setNotificationStaleReview({ intentKey: key, details: stale, refreshReady: false });
        setNotice("全局事实已变化；已保留通知草稿和同一 mutation 意图。只有完整详情刷新成功后才能核对并重试。");
        try {
          await onRefresh();
          if (!scopeIsCurrent(scope)) return;
          setNotificationStaleReview((current) => current ? { ...current, refreshReady: true } : null);
          setNotice("已读取最新客户、文件与沟通事实；请核对后明确确认。");
        } catch {
          if (scopeIsCurrent(scope)) setNotice("最新详情刷新失败；草稿已保留，禁止重新发送直至刷新成功。");
        }
      } else {
        setNotice(caught instanceof Error ? caught.message : "通知失败，请按同一意图重试。");
      }
    } finally {
      if (scopeIsCurrent(scope)) setBusy(null);
    }
  };

  const openWhatsapp = () => {
    if (!target || disabledReason || !message.trim() || notificationNeedsReview) return;
    const digits = target.replace(/\D/gu, "");
    const finalWhatsAppText = finalMessage;
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(finalWhatsAppText)}`, "_blank", "noopener,noreferrer");
    setWhatsappOpenedIntent(notificationBusinessIntentKey);
    setNotice("已打开 WhatsApp；这一步不会写入发送记录。实际发送后请回来确认。");
  };

  const recordResponse = async () => {
    if (responseNeedsReview) return;
    const inputKey = responseBusinessIntentKey;
    const input: RecordInspectionCustomerResponseInput = {
      reportId: detail.id,
      expectedRevision,
      mutationId: stableMutationId(responseIntentRef, inputKey, "ir-response"),
      result: responseResult,
      note: responseNote.trim(),
    };
    setBusy("response");
    setNotice(null);
    const scope = captureScope();
    try {
      const result = await api.inspectionReports.recordResponse(input);
      if (!scopeIsCurrent(scope)) return;
      setNotice(result.replayed ? "已确认此前客户回复记录。" : "客户回复已追加；此前分类历史仍完整保留。");
      responseIntentRef.current = null;
      setResponseStaleReview(null);
      setResponseNote("");
      try {
        await onRefresh();
        if (!scopeIsCurrent(scope)) return;
      } catch {
        if (scopeIsCurrent(scope)) setNotice("客户回复已记录；详情刷新失败，请手动刷新页面。");
      }
    } catch (caught) {
      if (!scopeIsCurrent(scope)) return;
      const stale = staleDetails(caught);
      if (stale) {
        setExpectedRevision(stale.latestRevision);
        setResponseStaleReview({ intentKey: inputKey, details: stale });
        setNotice("全局事实已变化；已保留回复输入并刷新摘要。请核对最新沟通事实后重试。");
        try { await onRefresh(); } catch { /* keep server-provided summary visible */ }
      } else {
        setNotice(caught instanceof Error ? caught.message : "客户回复保存失败，请按同一意图重试。");
      }
    } finally {
      if (scopeIsCurrent(scope)) setBusy(null);
    }
  };

  return (
    <section data-testid="inspection-communications" className="mt-4 grid gap-4 lg:grid-cols-2">
      <article data-testid="ir-notification-panel" className="rounded-2xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Customer notification</p><h2 className="mt-1 text-sm font-bold">通知客户</h2></div><Send size={18} className="text-primary" aria-hidden /></div>
        <p className="mt-2 text-[11px] text-ink-soft">只能发送当前、未过期的客户 PDF；现场照片不会进入 PDF。短信为模拟发送并附非本机演示链接，WhatsApp 打开与记录分两步。</p>
        {canOperate ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold">语言<select data-testid="ir-notification-language" aria-describedby={disabledReasonId} aria-label="客户文件语言" value={language} onChange={(event) => setTemplateLanguage(event.target.value as IrPdfLanguage)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 dark:bg-slate-900">{(["zh", "en", "bilingual"] as const).map((value) => <option key={value} value={value}>{LANGUAGE_LABELS[value]}</option>)}</select></label>
              <label className="text-xs font-semibold">渠道<select data-testid="ir-notification-channel" aria-describedby={disabledReasonId} aria-label="通知渠道" value={channel} onChange={(event) => setNotificationChannel(event.target.value as NotificationChannel)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 dark:bg-slate-900"><option value="sms">短信（模拟）</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></label>
            </div>
            <p data-testid="ir-notification-target" className="text-[11px] text-ink-soft">发送到：{target || "待补"}</p>
            <div data-testid="ir-notification-delivery-facts" className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-[11px] leading-5 text-ink-soft dark:bg-slate-900">
              {channel === "email" ? <><p><strong className="text-ink">模拟邮件（Mock provider）</strong> · 发送到 {target || "待补"}</p><p>当前附件：{selectedBundleLabel}。Provider 接受不代表客户已收到或已读。</p></> : <><p><strong className="text-ink">{channel === "sms" ? "模拟短信（Mock provider）" : "WhatsApp 前台手工发送"}</strong> · {selectedBundleLabel}</p><p>演示链接（非 localhost）：{reportDemoUrl}。{channel === "whatsapp" ? "打开链接不会写记录，实际发送后需前台确认。" : "Provider 接受不代表客户已收到或已读。"}</p></>}
            </div>
            {channel === "email" ? <label className="block text-xs font-semibold">主题<input data-testid="ir-notification-subject" aria-describedby={disabledReasonId} value={subject} onChange={(event) => setSubject(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 dark:bg-slate-900" /></label> : null}
            <label className="block text-xs font-semibold">最终发送文字<textarea data-testid="ir-notification-message" aria-describedby={disabledReasonId} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 leading-5 dark:bg-slate-900" /></label>
            {disabledReason ? <p id="ir-notification-disabled-reason" role="status" data-testid="ir-notification-disabled-reason" className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">{disabledReason}</p> : null}
            {notificationNeedsReview ? <div data-testid="ir-stale-review" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"><p>最新 revision {notificationStaleReview.details.latestRevision} · {notificationStaleReview.details.summary.communicationStatus === "closed" ? "客户已回复" : notificationStaleReview.details.summary.communicationStatus === "awaiting_reply" ? "已通知待回复" : "尚未通知"}。请核对最新客户、文件与沟通事实。</p>{notificationStaleReview.refreshReady ? <button type="button" data-testid="ir-stale-review-confirm" onClick={() => setNotificationStaleReview(null)} className="mt-2 min-h-11 rounded-lg border border-amber-400 bg-white px-3 font-semibold">已核对最新事实</button> : <button type="button" data-testid="ir-stale-refresh" disabled={busy !== null} onClick={() => void refreshNotificationFacts()} className="mt-2 min-h-11 rounded-lg border border-amber-400 bg-white px-3 font-semibold disabled:opacity-40">重新读取最新事实</button>}</div> : null}
            {channel === "whatsapp" ? <div className="flex flex-wrap gap-2"><button type="button" data-testid="ir-whatsapp-open" aria-describedby={disabledReasonId} disabled={Boolean(disabledReason) || busy !== null || notificationNeedsReview} onClick={openWhatsapp} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-300 px-3 text-xs font-semibold text-emerald-700 disabled:opacity-40"><ExternalLink size={14} />打开 WhatsApp</button><button type="button" data-testid="ir-whatsapp-confirm" aria-describedby={disabledReasonId} disabled={Boolean(disabledReason) || whatsappOpenedIntent !== notificationBusinessIntentKey || busy !== null || notificationNeedsReview} onClick={() => void send()} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-40"><MessageCircle size={14} />已发送并记录</button></div> : <button type="button" data-testid="ir-notification-send" aria-describedby={disabledReasonId} disabled={Boolean(disabledReason) || !message.trim() || (channel === "email" && !subject.trim()) || busy !== null || notificationNeedsReview} onClick={() => void send()} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white disabled:opacity-40">{channel === "email" ? <Mail size={14} /> : <Send size={14} />}{busy === "notification" ? "发送中…" : "发送并记录"}</button>}
          </div>
        ) : <p data-testid="ir-communications-readonly" className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-ink-soft dark:bg-slate-900">当前身份只读；可查看完整通知历史与客户回复。</p>}
        <div data-testid="ir-notification-history" className="mt-4 space-y-2"><h3 className="text-xs font-bold">通知历史</h3>{detail.notificationHistory.length === 0 ? <p className="text-xs text-ink-soft">尚无成功正式通知。</p> : detail.notificationHistory.slice().reverse().map((event) => <div key={event.id} data-event-id={event.id} className="rounded-lg border border-line p-2 text-[11px]"><p className="break-all font-mono text-[10px] font-semibold text-primary">{event.id}</p><p className="mt-1 font-semibold">{CHANNEL_LABELS[event.channel as keyof typeof CHANNEL_LABELS] ?? event.channel} · {event.language ? LANGUAGE_LABELS[event.language] : "旧记录"} · Jamaica {formatIrJamaicaDateTime(event.recordedAt)}</p><p className="mt-1 break-words text-ink-soft">{event.target ?? "旧记录目标待核"} · {event.providerMode ? `${PROVIDER_MODE_LABELS[event.providerMode as keyof typeof PROVIDER_MODE_LABELS] ?? event.providerMode}（${event.providerMode}） · ` : ""}{event.providerResult ? `${PROVIDER_RESULT_LABELS[event.providerResult as keyof typeof PROVIDER_RESULT_LABELS] ?? event.providerResult}（${event.providerResult}）` : event.source}</p>{event.fileName ? <p className="mt-1 break-all font-mono text-ink-soft">{event.fileName}</p> : null}{event.demoReportUrl ? <a href={event.demoReportUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all font-semibold text-primary hover:underline">演示报告链接（非 localhost）：{event.demoReportUrl}</a> : null}{event.subject ? <p className="mt-1">{event.subject}</p> : null}{event.message ? <p className="mt-1 whitespace-pre-wrap">{event.message}</p> : null}<p className="mt-1 break-all text-ink-faint">{event.actorName ?? event.actorId ?? "旧记录操作人待核"}{event.providerReference ? ` · ${event.providerReference}` : ""}</p></div>)}</div>
      </article>

      <article data-testid="ir-response-panel" className="rounded-2xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Customer response</p><h2 className="mt-1 text-sm font-bold">客户回复</h2></div><UserRoundCheck size={18} className="text-primary" aria-hidden /></div>
        <p className="mt-2 text-[11px] text-ink-soft">回复由前台手工记录，不是从短信、Email 或 WhatsApp 自动读取。客户可以改变主意；每次分类都追加为新事件，并由服务端自动串联此前有效分类。</p>
        <p data-testid="ir-current-response" className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-ink dark:bg-slate-900">当前结论：{detail.currentResponse ? RESPONSE_LABELS[detail.currentResponse] : "待记录"}</p>
        {canOperate ? <div className="mt-3 space-y-3"><fieldset><legend className="text-xs font-semibold">本次要记录的分类</legend><div className="mt-1 flex flex-wrap gap-3">{(["interested", "not_interested"] as const).map((value) => <label key={value} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-xs"><input type="radio" name="ir-response-result" value={value} checked={responseResult === value} onChange={() => setResponseResult(value)} />{RESPONSE_LABELS[value]}</label>)}</div></fieldset><label className="block text-xs font-semibold">备注<textarea data-testid="ir-response-note" rows={4} value={responseNote} onChange={(event) => setResponseNote(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 dark:bg-slate-900" /></label>{responseNeedsReview ? <div data-testid="ir-response-stale-review" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"><p>沟通事实已变化；以下是服务器返回的最新摘要（下方详情历史可能仍待刷新）。</p><p data-testid="ir-response-stale-summary" className="mt-1 break-words font-semibold">当前结论：{responseStaleReview.details.summary.currentResponse ? RESPONSE_LABELS[responseStaleReview.details.summary.currentResponse] : "待记录"}{staleCurrentResponseEvent ? ` · ${staleCurrentResponseEvent.id} · Jamaica ${formatIrJamaicaDateTime(staleCurrentResponseEvent.recordedAt)}${staleCurrentResponseEvent.note ? ` · ${staleCurrentResponseEvent.note}` : ""}` : ""}</p><button type="button" data-testid="ir-response-stale-review-confirm" onClick={() => setResponseStaleReview(null)} className="mt-2 min-h-11 rounded-lg border border-amber-400 bg-white px-3 font-semibold">已核对最新事实</button></div> : null}<button type="button" data-testid="ir-response-save" disabled={busy !== null || responseNeedsReview} onClick={() => void recordResponse()} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-white disabled:opacity-40">{busy === "response" ? "保存中…" : "记录客户回复"}</button></div> : null}
        <div data-testid="ir-response-history" className="mt-4 space-y-2"><h3 className="text-xs font-bold">回复历史</h3>{detail.responseHistory.length === 0 ? <p className="text-xs text-ink-soft">尚无客户回复。</p> : detail.responseHistory.slice().reverse().map((event) => <div key={event.id} data-event-id={event.id} className="rounded-lg border border-line p-2 text-[11px]"><p className="break-all font-mono text-[10px] font-semibold text-primary">{event.id}</p><p className="mt-1 font-semibold">{RESPONSE_LABELS[event.result]} · Jamaica {formatIrJamaicaDateTime(event.recordedAt)}</p>{event.note ? <p className="mt-1 whitespace-pre-wrap">{event.note}</p> : null}<p className="mt-1 text-ink-faint">{event.actorName ?? event.actorId ?? "旧记录操作人待核"}{event.supersedesEventId ? ` · 修订 ${event.supersedesEventId}` : ""}</p></div>)}</div>
      </article>
      {notice ? <p data-testid="ir-communications-status" role="status" className="lg:col-span-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary">{notice}</p> : null}
    </section>
  );
}
