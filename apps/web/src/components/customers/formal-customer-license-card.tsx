"use client";

import { AlertTriangle, Eye, History, RefreshCw, ScanLine, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  deriveFormalCustomerLicenseDetail,
  fetchFormalCustomerLicenseHistory,
  type FormalCustomerLicenseDetail,
  type FormalCustomerLicenseRecord,
  type FormalCustomerLicenseStatus,
} from "@/lib/customers/formal-customer-license-detail";
import { FormalCustomerLicenseDialog } from "@/components/customers/formal-customer-license-dialog";

const statusLabel: Record<FormalCustomerLicenseDetail["status"], string> = {
  missing: "待补",
  pending_verification: "待核验",
  verified: "已核验",
  needs_reverification: "需重新核验",
};

const statusClass: Record<FormalCustomerLicenseDetail["status"], string> = {
  missing: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  pending_verification: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  verified: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  needs_reverification: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

export function FormalCustomerLicenseCard({
  customerNo,
  organization,
  primaryContactName,
  hasPrimaryContact,
}: {
  customerNo: string;
  organization: boolean;
  primaryContactName: string | null;
  hasPrimaryContact: boolean;
}) {
  const [records, setRecords] = useState<FormalCustomerLicenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [role, setRole] = useState<NonNullable<Session["formal"]>["role"] | null>(null);

  const subjectAvailable = !organization || hasPrimaryContact;
  const load = useCallback(async () => {
    if (!subjectAvailable) {
      setRecords([]);
      setError(null);
      setLoading(false);
      return [];
    }
    setLoading(true);
    setError(null);
    try {
      const next = await fetchFormalCustomerLicenseHistory(customerNo);
      setRecords(next);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "驾驶证记录读取失败");
      return [];
    } finally {
      setLoading(false);
    }
  }, [customerNo, subjectAvailable]);

  useEffect(() => {
    const readRole = () => {
      try {
        const raw = window.localStorage.getItem("wh_session");
        const session = raw ? JSON.parse(raw) as Session : null;
        setRole(session?.formal?.role ?? null);
      } catch {
        setRole(null);
      }
    };
    readRole();
    window.addEventListener("wh:formal-session-changed", readRole);
    return () => window.removeEventListener("wh:formal-session-changed", readRole);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const detail = useMemo(() => deriveFormalCustomerLicenseDetail(records), [records]);
  const canWrite = role === "super_admin" || role === "front_desk";
  const cardTitle = organization ? "主要联系人驾驶证" : "客户驾驶证";

  const acceptSaved = async (record: FormalCustomerLicenseRecord) => {
    const next = await load();
    const confirmed = deriveFormalCustomerLicenseDetail(next).current;
    if (confirmed?.id !== record.id) throw new Error("新记录尚未读取成功，请保留窗口并重试");
    setDialogOpen(false);
    setHistoryOpen(true);
    setNotice("驾驶证记录已保存，旧记录继续保留在历史中。");
  };

  return (
    <section data-testid="formal-customer-license-card" className="overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:border-slate-700 dark:bg-slate-800/70">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-4 dark:bg-slate-900/50 sm:px-5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-50 text-primary dark:bg-primary/15"><ScanLine size={20} aria-hidden /></span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink dark:text-slate-100">{cardTitle}</h3>
          <p className="mt-0.5 truncate text-[11px] text-ink-soft dark:text-slate-400">
            {organization ? primaryContactName ? `证件主体：${primaryContactName}` : "证件主体：公司主要联系人" : `证件主体：${customerNo}`}
          </p>
        </div>
        <span data-testid="formal-customer-license-status" className={cn("ml-auto rounded-full px-3 py-1 text-[11px] font-bold", statusClass[detail.status])}>
          {loading ? "读取中" : statusLabel[detail.status]}
        </span>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {!subjectAvailable ? (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>公司尚未设置主要联系人。先在公司联系人中建立主要联系人关系，之后即可在这里补录其驾驶证。</span>
          </div>
        ) : error ? (
          <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
            <button type="button" onClick={() => void load()} className="ml-3 inline-flex items-center gap-1 underline"><RefreshCw size={12} aria-hidden />重试</button>
          </div>
        ) : loading ? (
          <p role="status" className="text-xs text-ink-soft">正在读取驾驶证记录…</p>
        ) : detail.current ? (
          <CurrentRecord record={detail.current} />
        ) : (
          <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-ink-soft dark:bg-slate-900/60 dark:text-slate-300">
            当前没有驾驶证记录，可继续办理业务；资料到齐后从这里补录。
          </p>
        )}

        {notice ? <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          {canWrite && subjectAvailable && !loading && !error ? (
            <button type="button" data-testid="formal-customer-license-open" onClick={() => { setNotice(null); setDialogOpen(true); }} className="min-h-9 rounded-lg bg-primary px-3.5 text-xs font-bold text-white">
              {detail.current ? "替换证件" : "补录驾驶证"}
            </button>
          ) : role === "owner" ? (
            <span className="rounded-lg border border-line px-3 py-2 text-[11px] font-semibold text-ink-soft dark:border-slate-600 dark:text-slate-300">老板账号只读</span>
          ) : null}
          {detail.historyCount > 0 ? (
            <button type="button" data-testid="formal-customer-license-history-toggle" onClick={() => setHistoryOpen((open) => !open)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3.5 text-xs font-semibold text-ink-soft hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:text-slate-300">
              <History size={14} aria-hidden />{historyOpen ? "收起历史" : `查看历史（${detail.historyCount}）`}
            </button>
          ) : null}
        </div>

        {historyOpen ? <HistoryList records={detail.records} /> : null}
      </div>

      {dialogOpen ? (
        <FormalCustomerLicenseDialog
          customerNo={customerNo}
          organization={organization}
          replacing={Boolean(detail.current)}
          onClose={() => setDialogOpen(false)}
          onSaved={acceptSaved}
        />
      ) : null}
    </section>
  );
}

function CurrentRecord({ record }: { record: FormalCustomerLicenseRecord }) {
  return (
    <div data-testid="formal-customer-license-current" className="grid gap-2 rounded-xl border border-line p-3 dark:border-slate-700 sm:grid-cols-2 lg:grid-cols-4">
      <ProfileField label="证件姓名" value={record.profile.name} />
      <ProfileField label="出生日期" value={record.profile.birthDate} />
      <ProfileField label="性别" value={record.profile.sex === "M" ? "M / 男" : "F / 女"} />
      <ProfileField label="证件地址" value={record.profile.address} wide />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-soft sm:col-span-2 lg:col-span-4">
        <span className="inline-flex items-center gap-1"><ShieldCheck size={12} aria-hidden />{record.verifiedBy ? `核验账号 #${record.verifiedBy}` : "尚未核验"}</span>
        <span>{jamaicaDateTime(record.verifiedAt ?? record.createdAt)}（牙买加时间）</span>
        <a href={`/api/formal/customer-driver-license-records/${record.id}/file`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><Eye size={12} aria-hidden />查看证件原图</a>
      </div>
    </div>
  );
}

function HistoryList({ records }: { records: FormalCustomerLicenseRecord[] }) {
  return (
    <div data-testid="formal-customer-license-history" className="space-y-2 border-t border-line pt-4">
      <p className="text-[11px] font-semibold text-ink-soft">不可变历史 · 最新记录在前</p>
      {records.map((record) => (
        <div key={record.id} className="flex flex-col gap-2 rounded-xl border border-line px-3 py-2.5 text-xs dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-ink dark:text-slate-100">#{record.id} · {record.profile.name}</p>
            <p className="mt-1 text-[10px] text-ink-soft">{jamaicaDateTime(record.createdAt)} · {statusLabel[record.status]}</p>
            {record.supersededAt ? <p className="mt-1 text-[10px] text-ink-soft">已于 {jamaicaDateTime(record.supersededAt)} 被新记录替换</p> : null}
          </div>
          <a href={`/api/formal/customer-driver-license-records/${record.id}/file`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-[11px] font-semibold text-primary dark:border-slate-600"><Eye size={12} aria-hidden />查看证件原图</a>
        </div>
      ))}
    </div>
  );
}

function ProfileField({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? "sm:col-span-2 lg:col-span-4" : undefined}><p className="text-[10px] font-semibold text-ink-faint dark:text-slate-400">{label}</p><p className="mt-1 break-words text-xs font-semibold text-ink dark:text-slate-100">{value}</p></div>;
}

function jamaicaDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replaceAll("/", "-");
}

export function formalCustomerLicenseStatusLabel(status: FormalCustomerLicenseStatus): string {
  return statusLabel[status];
}
