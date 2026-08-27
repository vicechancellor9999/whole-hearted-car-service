"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Copy, MessageCircle, Mail, RotateCcw, Smartphone, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { draftPickupNoticeTexts, type PickupNoticeDrafts } from "@/lib/orders/pickup-notice";
import { quickOrderFinance, type QuickOrder } from "@/lib/orders/quick-order-types";
import type { CustomerVehicleWorkspaceResponse } from "@/lib/customers/types";
import { cn, formatJMDFull } from "@/lib/utils";

type ChannelKind = "sms" | "whatsapp" | "email";
const CHANNEL_LABELS: Record<ChannelKind, string> = { sms: "短信 Twilio", whatsapp: "WhatsApp", email: "Email" };

interface ChannelDraft {
  readonly done: boolean;
  readonly language: "zh" | "en";
  readonly text: string;
}

export function QuickPickupNoticeDialog({
  order,
  customer,
  vehicle,
  onClose,
  onDone,
}: {
  order: QuickOrder;
  customer: CustomerVehicleWorkspaceResponse["customers"][number] | null;
  vehicle: CustomerVehicleWorkspaceResponse["vehicles"][number] | null;
  onClose: () => void;
  onDone: (updated: QuickOrder) => void;
}) {
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [drafts, setDrafts] = useState<PickupNoticeDrafts | null>(null);
  const [channels, setChannels] = useState<Record<ChannelKind, ChannelDraft>>({
    sms: { done: false, language: "zh", text: "" },
    whatsapp: { done: false, language: "zh", text: "" },
    email: { done: false, language: "zh", text: "" },
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pickupIntentRef = useRef<{
    key: string;
    expectedRevision: number;
    mutationId: string;
  } | null>(null);

  const regenerate = () => {
    const next = draftPickupNoticeTexts({ customer, vehicle, order, now: new Date() });
    setDrafts(next);
    setChannels((current) => ({
      sms: { ...current.sms, text: next[current.sms.language] },
      whatsapp: { ...current.whatsapp, text: next[current.whatsapp.language] },
      email: { ...current.email, text: next[current.email.language] },
    }));
  };

  useEffect(() => { regenerate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const setChannel = (kind: ChannelKind, patch: Partial<ChannelDraft>) => {
    setChannels((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }));
  };

  const setChannelLanguage = (kind: ChannelKind, language: "zh" | "en") => {
    setChannels((current) => {
      const text = drafts ? drafts[language] : current[kind].text;
      return { ...current, [kind]: { ...current[kind], language, text } };
    });
  };

  const finance = quickOrderFinance(order);
  const doneCount = Object.values(channels).filter((channel) => channel.done).length;
  const smsTarget = customer?.phone ? `发到 OTP 手机号 ${customer.phone}` : "该客户没有手机号，无法发短信";

  const whatsappLink = useMemo(() => {
    const channel = channels.whatsapp;
    const digits = (customer?.phone ?? "").replace(/\D/g, "");
    return `https://wa.me/${digits}?text=${encodeURIComponent(channel.text)}`;
  }, [channels.whatsapp, customer?.phone]);

  const submit = async () => {
    if (doneCount === 0) { setError("至少完成一个通知渠道（短信/WhatsApp/Email）"); return; }
    setPending(true);
    setError(null);
    try {
      const doneChannels = (["sms", "whatsapp", "email"] as const)
        .filter((kind) => channels[kind].done)
        .map((kind) => ({ kind, language: channels[kind].language, text: channels[kind].text }));
      const key = JSON.stringify(doneChannels);
      let intent = pickupIntentRef.current;
      if (!intent || intent.key !== key) {
        const workspace = await api.billing.workspace();
        intent = {
          key,
          expectedRevision: workspace.revision,
          mutationId: `parking-source-${crypto.randomUUID()}`,
        };
        pickupIntentRef.current = intent;
      }
      const committed = await api.quickOrders.notifyPickup(order.id, {
        orderId: order.id,
        expectedRevision: intent.expectedRevision,
        mutationId: intent.mutationId,
        channels: doneChannels,
      });
      pickupIntentRef.current = null;
      onDone({ ...order, pickupNotice: committed.pickupNotice });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "通知记录失败");
      setPending(false);
    }
  };

  const inputClass = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";

  return (
    <div role="dialog" aria-modal="true" aria-label="通知客户取车" data-testid="quick-pickup-dialog"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="my-auto w-full max-w-2xl overflow-hidden rounded-[22px] border border-line bg-white shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between border-b border-line p-4 dark:border-slate-700 sm:px-5">
          <div>
            <h2 className="text-base font-bold text-ink dark:text-slate-100">通知客户取车</h2>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">
              AI 起草中英两版文案，可自由编辑；短信/WhatsApp/Email 人工执行，至少完成一项后开始记时
            </p>
          </div>
          <button type="button" data-testid="quick-pickup-close" onClick={onClose} aria-label="关闭"
            className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm text-ink-soft hover:text-ink dark:border-slate-600 dark:text-slate-300">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4 sm:p-5">
          {/* AI 文案 */}
          <section data-testid="quick-pickup-drafts">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-bold text-ink dark:text-slate-200">AI 文案（{lang === "zh" ? "中文" : "English"}版）</p>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-line p-0.5 dark:border-slate-600">
                  {(["zh", "en"] as const).map((value) => (
                    <button key={value} type="button" data-testid={`quick-pickup-lang-${value}`}
                      onClick={() => setLang(value)}
                      className={cn("rounded-md px-2.5 py-1 text-xs font-semibold", lang === value ? "bg-primary text-white" : "text-ink-soft hover:text-ink dark:text-slate-300")}>
                      {value === "zh" ? "中文" : "English"}
                    </button>
                  ))}
                </div>
                <button type="button" data-testid="quick-pickup-regenerate" onClick={regenerate}
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-300">
                  <RotateCcw size={11} /> 恢复 AI 稿
                </button>
              </div>
            </div>
            <textarea data-testid={`quick-pickup-draft-${lang}`} rows={6} className={inputClass}
              value={drafts?.[lang] ?? ""}
              onChange={(event) => setDrafts((current) => current ? { ...current, [lang]: event.target.value } : current)} />
            <p className="mt-1 text-[11px] text-ink-faint dark:text-slate-500">
              最迟取车日期默认 {drafts?.deadlineDate ?? ""}（宽限日）；次日（D+2）起按 JMD 2,500/天计停车费。当前余额：{finance.balanceJmd > 0 ? <b className="text-rose-600">{formatJMDFull(finance.balanceJmd)}</b> : "已结清"}。
            </p>
          </section>

          {/* 渠道 */}
          <section data-testid="quick-pickup-channels" className="space-y-2">
            <p className="text-xs font-bold text-ink dark:text-slate-200">通知渠道（人工执行，至少一项）</p>
            {(["sms", "whatsapp", "email"] as const).map((kind) => {
              const channel = channels[kind];
              const Icon = kind === "sms" ? Smartphone : kind === "whatsapp" ? MessageCircle : Mail;
              const disabled = kind === "sms" && !customer?.phone || kind === "email" && !customer?.email;
              return (
                <div key={kind} data-testid={`quick-pickup-channel-${kind}`}
                  className={cn("rounded-xl border p-3 dark:border-slate-700", channel.done ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/5" : "border-line bg-white/60 dark:bg-slate-800/60", disabled && "opacity-50")}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-ink dark:text-slate-200">
                      <Icon size={14} className="text-primary" /> {CHANNEL_LABELS[kind]}
                      <span className="font-normal text-ink-faint dark:text-slate-500">
                        {kind === "sms" ? smsTarget : kind === "whatsapp" ? "生成 WhatsApp 链接再发" : customer?.email ? `发到 ${customer.email}` : "该客户没有 Email"}
                      </span>
                    </p>
                    <div className="flex items-center gap-2">
                      <select aria-label={`${CHANNEL_LABELS[kind]}语言`} data-testid={`quick-pickup-channel-${kind}-lang`}
                        value={channel.language} disabled={disabled}
                        onChange={(event) => setChannelLanguage(kind, event.target.value as "zh" | "en")}
                        className="rounded-lg border border-line bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-700">
                        <option value="zh">中文</option>
                        <option value="en">English</option>
                      </select>
                      {kind === "whatsapp" && (
                        <button type="button" data-testid={`quick-pickup-copy-${kind}`} disabled={disabled}
                          onClick={() => { void navigator.clipboard?.writeText(whatsappLink); }}
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-300">
                          <Copy size={11} /> 复制链接
                        </button>
                      )}
                      <button type="button" data-testid={`quick-pickup-mark-${kind}`} disabled={disabled}
                        onClick={() => setChannel(kind, { done: !channel.done })}
                        className={cn("inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold",
                          channel.done ? "bg-emerald-600 text-white" : "border border-line text-ink-soft hover:border-primary-200 dark:border-slate-600 dark:text-slate-300")}>
                        <CheckCircle2 size={12} /> {channel.done ? "已发送" : "标记已发送"}
                      </button>
                    </div>
                  </div>
                  <textarea rows={2} className={cn(inputClass, "mt-2 text-xs")} value={channel.text} disabled={disabled}
                    data-testid={`quick-pickup-text-${kind}`}
                    onChange={(event) => setChannel(kind, { text: event.target.value })} />
                </div>
              );
            })}
          </section>

          {error && <p data-testid="quick-pickup-error" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-line pt-3 dark:border-slate-700">
            <button type="button" onClick={onClose} className="inline-flex min-h-9 items-center rounded-lg border border-line px-4 text-xs font-semibold text-ink-soft hover:text-ink dark:border-slate-600 dark:text-slate-300">取消</button>
            <button type="button" data-testid="quick-pickup-confirm" disabled={pending} onClick={() => void submit()}
              className="inline-flex min-h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-50">
              {doneCount > 0 ? `已发送 ${doneCount} 项，确认并开始记时` : "确认并开始记时"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
