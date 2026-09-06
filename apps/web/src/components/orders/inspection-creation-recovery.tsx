"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { FormalInspectionReport } from "@/lib/api/formal-inspections";
import { useI18n } from "@/lib/i18n/language";

export type InspectionCreationDraft = {
  inspectionTeamId: string;
  inspectorId: string;
  summaryZh: string;
  specialCaseNotesZh: string;
  plateQuery: string;
  selectedVehicle: { id: number; title: string; detail: string } | null;
  error?: string;
  sourceBusinessOrderId?: number;
  recoveryAttemptId?: string;
};

export type InspectionCreationAttempt = {
  id: string;
  draft: InspectionCreationDraft;
  status: "pending" | "unconfirmed" | "saved";
  report?: Pick<FormalInspectionReport, "id" | "reportNo">;
  error?: string;
  updatedAt?: number;
};

const positiveId = z.number().int().positive().refine(Number.isSafeInteger);
const attemptSchema = z.object({
  id: z.string().min(1).max(128), status: z.enum(["pending", "unconfirmed", "saved"]), updatedAt: z.number().finite(),
  draft: z.object({ inspectionTeamId: z.string(), inspectorId: z.string(), summaryZh: z.string().max(100_000), specialCaseNotesZh: z.string().max(100_000), plateQuery: z.string(), selectedVehicle: z.object({ id: positiveId, title: z.string(), detail: z.string() }).nullable(), sourceBusinessOrderId: positiveId.optional(), recoveryAttemptId: z.string().optional(), error: z.string().optional() }),
  report: z.object({ id: positiveId, reportNo: z.string().min(1) }).optional(), error: z.string().optional(),
}).refine(value => value.status !== "saved" || Boolean(value.report));
const recoveryKey = (accountId: number) => `wh:inspection-creation:v1:${accountId}`;
function readAttempts(accountId?: number, fallback: InspectionCreationAttempt[] = []): InspectionCreationAttempt[] {
  if (!accountId) return fallback;
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(recoveryKey(accountId)) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(value => {
      const parsed = attemptSchema.safeParse(value);
      return parsed.success && Date.now() - parsed.data.updatedAt < 86_400_000 && parsed.data.updatedAt <= Date.now() + 60_000 ? [parsed.data] : [];
    });
  } catch { return fallback; }
}
function saveAttempts(accountId: number | undefined, attempts: InspectionCreationAttempt[]): boolean {
  if (!accountId) return false;
  try {
    sessionStorage.setItem(recoveryKey(accountId), JSON.stringify(attempts.map(value => attemptSchema.parse(value))));
    return true;
  } catch { return false; }
}
const restoreAttempts = (accountId?: number) => readAttempts(accountId).map(attempt => attempt.status === "pending"
  ? { ...attempt, status: "unconfirmed" as const, error: "上次创建结果尚未确认，请先核对列表，避免重复创建。" } : attempt);

function latestAttempts(accountId: number | undefined, local: { accountId?: number; attempts: InspectionCreationAttempt[] }) {
  const known = local.accountId === accountId ? local.attempts : [];
  return readAttempts(accountId, known).map(entry => {
    const previous = known.find(value => value.id === entry.id);
    // Reading the same persisted pending snapshot must not undo refresh recovery.
    return entry.status === "pending" && previous?.status === "unconfirmed" && previous.updatedAt === entry.updatedAt ? previous : entry;
  });
}

export function useInspectionCreationRecovery(accountId?: number, sourceBusinessOrderId?: number) {
  const scope = useMemo(() => ({ accountId }), [accountId]);
  const activeScope = useRef<typeof scope | null>(scope);
  useEffect(() => {
    activeScope.current = scope;
    return () => { activeScope.current = null; };
  }, [scope]);
  const isCurrentScope = useCallback(() => activeScope.current === scope, [scope]);
  const [state, setState] = useState(() => ({ accountId, attempts: restoreAttempts(accountId) }));
  const activeAccount = useRef(accountId);
  const local = useRef(state);
  const [storageAvailable, setStorageAvailable] = useState(Boolean(accountId));
  const [draft, setDraft] = useState<InspectionCreationDraft | undefined>();
  useEffect(() => {
    activeAccount.current = accountId;
    let active = true;
    if (local.current.accountId !== accountId) {
      local.current = { accountId, attempts: restoreAttempts(accountId) };
      void Promise.resolve().then(() => { if (active) { setState(local.current); setDraft(undefined); setStorageAvailable(Boolean(accountId)); } });
    }
    return () => { active = false; };
  }, [accountId]);
  const track = useCallback((attempt: InspectionCreationAttempt) => {
    // A late response from a previous page must not overwrite newer submissions.
    const current = latestAttempts(accountId, local.current);
    const entry = { ...attempt, updatedAt: Date.now() };
    const attempts = [...current.filter(value => value.id !== entry.id), entry];
    const stored = saveAttempts(accountId, attempts);
    if (activeAccount.current === accountId) {
      local.current = { accountId, attempts }; setState(local.current); setStorageAvailable(stored);
    }
  }, [accountId]);
  const dismiss = (id: string) => {
    const attempts = latestAttempts(accountId, local.current).filter(entry => entry.id !== id);
    const stored = saveAttempts(accountId, attempts);
    setStorageAvailable(stored);
    // Keep a retryable entry visible if an existing persistent copy cannot be removed.
    if (!stored && accountId) return;
    local.current = { accountId, attempts }; setState(local.current);
  };
  const restore = (attempt: InspectionCreationAttempt) => {
    if (attempt.status !== "unconfirmed") return;
    setDraft({ ...attempt.draft, recoveryAttemptId: attempt.id, error: attempt.error });
  };
  const attempts = state.accountId === accountId ? state.attempts.filter(entry => !sourceBusinessOrderId || entry.draft.sourceBusinessOrderId === sourceBusinessOrderId) : [];
  return { attempts, draft: state.accountId === accountId ? draft : undefined, track, dismiss, restore, storageAvailable, isCurrentScope, clearDraft: () => setDraft(undefined) };
}

export function InspectionCreationRecoveryPanel({ attempts, onRestore, onDismiss, storageAvailable = false }: {
  attempts: InspectionCreationAttempt[];
  storageAvailable?: boolean;
  onRestore(attempt: InspectionCreationAttempt): void;
  onDismiss(id: string): void;
}) {
  const english = useI18n().language === "en";
  if (!attempts.length) return null;
  return <section aria-label={english ? "Inspection creation recovery" : "检查创建恢复"} className="my-2 max-h-64 shrink-0 overflow-y-auto rounded-xl border border-line bg-card p-3 text-sm">
    <p className="mb-2 text-xs text-ink-soft">{storageAvailable ? (english ? "Submission recovery is kept in this tab for 24 hours for the same account. Verify unconfirmed results before submitting again." : "提交记录在当前标签页为同一账号暂存 24 小时；未确认结果请先核对再决定是否重试。") : (english ? "Local recovery is unavailable. Keep this page open or copy your inputs before refreshing; cleanup can be retried here." : "本机暂存不可用。刷新前请先复制填写内容或核对列表；提示清理失败时可在这里重试。")}</p>
    {attempts.map((attempt, index) => <article key={attempt.id} className="border-t border-line py-2 first:border-0">
      <p role={attempt.status === "unconfirmed" ? "alert" : "status"} className="font-semibold">
        {attempt.status === "pending" ? (english ? "Saving inspection…" : "正在保存检查结果…") : attempt.status === "saved" ? (english ? "Inspection created" : "检查结果已创建") : (english ? "Check this inspection submission" : "这次检查提交需要核对")}
        <span className="ml-2 text-xs font-normal text-ink-soft">#{index + 1}</span>
      </p>
      <p className="mt-1 break-words font-semibold">{attempt.draft.selectedVehicle?.title || attempt.draft.plateQuery || (english ? "Vehicle details in draft" : "车辆信息见恢复草稿")}</p>
      {attempt.draft.sourceBusinessOrderId ? <a href={`/orders/business/${attempt.draft.sourceBusinessOrderId}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-primary underline">{english ? "Open source Business Order" : "查看来源业务单"} #{attempt.draft.sourceBusinessOrderId}</a> : null}
      {attempt.status === "unconfirmed" ? <><p className="mt-1 break-words text-state-danger-text">{attempt.error}</p><p className="mt-1 line-clamp-2 text-ink-soft">{attempt.draft.summaryZh}</p></> : null}
      {attempt.status === "saved" && attempt.report ? <p className="mt-1 font-mono text-xs">{attempt.report.reportNo}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {attempt.status === "unconfirmed" ? <button type="button" onClick={() => onRestore(attempt)} className="min-h-11 rounded-lg border border-primary px-3 font-semibold text-primary">{english ? "Restore draft and check" : "恢复填写并核对"}</button> : null}
        {attempt.status === "unconfirmed" ? <button type="button" onClick={() => onDismiss(attempt.id)} className="min-h-11 rounded-lg border border-line px-3">{english ? "Checked; dismiss reminder" : "已核对，移除此提示"}</button> : null}
        {attempt.status === "saved" && attempt.report ? <><a href={`/orders/inspections/${attempt.report.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 font-semibold text-primary">{english ? "Open created report" : "打开已创建报告"}</a><button type="button" onClick={() => onDismiss(attempt.id)} className="min-h-11 rounded-lg border border-line px-3">{english ? "Done" : "完成"}</button></> : <a href={`/orders/inspections${attempt.draft.plateQuery.trim() ? `?search=${encodeURIComponent(attempt.draft.plateQuery.trim())}` : ""}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center px-2 text-primary underline">{english ? "Check list in new tab" : "新标签页核对列表"}</a>}
      </div>
    </article>)}
  </section>;
}
