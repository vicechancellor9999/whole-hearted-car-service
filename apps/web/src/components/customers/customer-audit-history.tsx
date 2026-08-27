"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, FileClock } from "lucide-react";
import { api } from "@/lib/api/client";
import type { CustomerAuditEvent, CustomerRecord } from "@/lib/customers/types";
import type { EvidenceAsset } from "@/lib/customers/verification-types";
import { formatDateTime } from "@/lib/utils";
import { currentSessionKey } from "./detail-shared";
import { EvidenceAssetViewer } from "./evidence-asset-viewer";

interface CustomerAuditHistoryProps {
  customer: CustomerRecord;
  refreshKey?: number;
}

function evidenceAssets(customer: CustomerRecord): Map<string, EvidenceAsset> {
  const assets: EvidenceAsset[] = [];
  for (const record of customer.verificationArchive.kycRecords) {
    assets.push(record.frontAsset);
    if (record.backAsset) assets.push(record.backAsset);
  }
  for (const record of customer.verificationArchive.agreementRecords) {
    if (record.medium === "electronic") assets.push(record.signatureAsset, record.signedDocumentAsset);
    else if (record.paperScanAsset) assets.push(record.paperScanAsset);
  }
  return new Map(assets.map((asset) => [asset.id, asset]));
}

function safeValue(value: string | number | boolean | null): string {
  if (value === null || value === "") return "—";
  const text = String(value);
  return /data\s*:/i.test(text) ? "[证据内容已隐藏]" : text;
}

const FIELD_LABELS: Record<string, string> = {
  otpRecordId: "OTP 记录",
  phoneE164: "验证号码",
  requestedAt: "请求时间",
  verifiedAt: "验证时间",
  invalidatedAt: "作废时间",
  invalidationReason: "作废原因",
  kycRecordId: "KYC 记录",
  documentType: "证件类型",
  submittedAt: "提交时间",
  agreementId: "协议记录",
  agreementVersion: "协议版本",
  agreementMedium: "协议形式",
  signedAt: "签署时间",
  phone: "主要电话",
  nameSourceValue: "客户姓名",
  nameZh: "中文姓名",
  nameEn: "英文姓名",
  address: "地址",
  gender: "性别",
  birthDate: "生日",
  trn: "TRN 税号",
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function CustomerAuditHistory({ customer, refreshKey = 0 }: CustomerAuditHistoryProps) {
  const [events, setEvents] = useState<readonly CustomerAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [viewer, setViewer] = useState<{ asset: EvidenceAsset; trigger: HTMLElement } | null>(null);
  const assetById = useMemo(() => evidenceAssets(customer), [customer]);

  useEffect(() => {
    const sessionKey = currentSessionKey();
    let cancelled = false;
    setEvents([]);
    setViewer(null);
    setLoading(true);
    setError(null);
    void api.customers.auditHistory(customer.id).then((next) => {
      if (cancelled || currentSessionKey() !== sessionKey) return;
      setEvents(next);
      setLoading(false);
    }).catch((caught) => {
      if (cancelled || currentSessionKey() !== sessionKey) return;
      setEvents([]);
      setError(caught instanceof Error && caught.message ? caught.message : "审计记录读取失败");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [customer.id, refreshKey]);

  const visible = expanded ? events : events.slice(0, 4);

  return (
    <>
    <section data-testid="customer-audit-history" className="min-w-0 overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:border-slate-700 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface px-4 py-3 dark:border-slate-700 dark:bg-slate-900/50">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary dark:bg-primary/15 dark:text-primary-300"><FileClock size={15} aria-hidden /></span>
        <h3 className="text-sm font-bold text-ink dark:text-slate-100">客户审计记录</h3>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-ink-soft dark:bg-slate-700 dark:text-slate-300">{events.length}</span>
        <span className="ml-auto text-[10px] text-ink-soft dark:text-slate-400">操作人、时间、字段变化和关联证据</span>
      </div>
      <div className="p-4">
        {loading ? <p role="status" className="text-xs text-ink-soft dark:text-slate-400">正在读取审计记录…</p> : null}
        {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p> : null}
        {!loading && !error && events.length === 0 ? <p className="text-xs text-ink-soft dark:text-slate-400">暂无审计记录</p> : null}
        {visible.length > 0 ? (
          <ol className="space-y-2">
            {visible.map((event) => (
              <li key={event.id} data-testid={`customer-audit-event-${event.id}`} className="rounded-xl border border-line bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <p className="font-bold text-ink dark:text-slate-100">{event.summary}</p>
                  <p className="text-[10px] text-ink-soft dark:text-slate-400">{formatDateTime(event.occurredAt)} · {event.actorId}</p>
                </div>
                {event.reason ? <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-300">原因：{event.reason}</p> : null}
                {event.changes.length > 0 ? (
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {event.changes.map((change, index) => (
                      <li key={`${event.id}-${change.field}-${index}`} className="min-w-0 rounded-lg bg-surface px-2 py-1.5 text-[10px] text-ink-soft dark:bg-slate-800 dark:text-slate-300">
                        <span className="font-semibold text-ink dark:text-slate-100">{fieldLabel(change.field)}</span>
                        <span className="ml-1 break-all">{safeValue(change.before)} → {safeValue(change.after)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {event.evidenceAssetIds.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">关联证据</span>
                    {event.evidenceAssetIds.map((id) => {
                      const asset = assetById.get(id);
                      return asset ? (
                        <button key={id} type="button" onClick={(click) => setViewer({ asset, trigger: click.currentTarget })} className="rounded-lg border border-primary-200 px-2 py-1 font-mono text-[10px] font-semibold text-primary dark:border-primary-500/40 dark:text-primary-300">{id}</button>
                      ) : <span key={id} className="rounded-lg bg-surface px-2 py-1 font-mono text-[10px] text-ink-soft dark:bg-slate-800 dark:text-slate-400">{id}</span>;
                    })}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        {events.length > 4 ? (
          <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs font-semibold text-ink dark:border-slate-600 dark:text-slate-200">
            {expanded ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
            {expanded ? "收起审计记录" : `查看全部 ${events.length} 条审计记录`}
          </button>
        ) : null}
      </div>
    </section>
    <EvidenceAssetViewer asset={viewer?.asset ?? null} title="审计关联证据" returnFocusElement={viewer?.trigger} onClose={() => setViewer(null)} />
    </>
  );
}
