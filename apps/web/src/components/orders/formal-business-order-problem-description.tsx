"use client";

import { FormEvent, useMemo, useState } from "react";
import { Clock3, Pencil } from "lucide-react";
import { ActionDialog } from "@/components/shared/action-dialog";
import {
  appendFormalProblemDescription,
  type FormalBusinessOrderProblemDescriptionContext,
  type FormalProblemDescriptionVersion,
} from "@/lib/api/formal-business-orders";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/language";

type EditScope = "business_order" | "repair_round";

function normalizedPair(value: { contentZh: string | null; contentEn: string | null } | null) {
  return `${value?.contentZh?.trim() ?? ""}\u0000${value?.contentEn?.trim() ?? ""}`;
}

export function descriptionsDiffer(
  order: FormalProblemDescriptionVersion | null,
  round: FormalProblemDescriptionVersion | null,
): boolean {
  return normalizedPair(order) !== normalizedPair(round);
}

function displayContent(
  description: { contentZh: string | null; contentEn: string | null } | null,
  english: boolean,
) {
  if (!description) return null;
  return english
    ? description.contentEn?.trim() || null
    : description.contentZh?.trim() || description.contentEn?.trim() || null;
}

export function FormalBusinessOrderProblemDescription({
  businessOrderId,
  context,
  canWrite,
  onSaved,
}: {
  businessOrderId: number;
  context: FormalBusinessOrderProblemDescriptionContext;
  canWrite: boolean;
  onSaved(context: FormalBusinessOrderProblemDescriptionContext): void;
}) {
  const { language } = useI18n();
  const english = language === "en";
  const [scope, setScope] = useState<EditScope | null>(null);
  const [contentZh, setContentZh] = useState("");
  const [contentEn, setContentEn] = useState("");
  const [reason, setReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orderContent = displayContent(context.current, english);
  const roundContent = displayContent(context.currentRound, english);
  const currentContent = orderContent ?? (english && context.current ? "Translation required" : null);
  const currentRoundContent = roundContent ?? (english && context.currentRound ? "Translation required" : null);
  const showRound = Boolean(
    context.currentRound && descriptionsDiffer(context.current, context.currentRound),
  );
  const hasVisibleContent = Boolean(currentContent || (showRound && currentRoundContent));
  const timeline = useMemo(() => [
    ...context.businessOrderHistory.map((version) => ({ ...version, scope: "business_order" as const })),
    ...context.currentRoundHistory.map((version) => ({ ...version, scope: "repair_round" as const })),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [context]);

  const openEditor = (nextScope: EditScope) => {
    const active = nextScope === "business_order" ? context.current : context.currentRound;
    setScope(nextScope);
    setContentZh(active?.contentZh ?? "");
    setContentEn(active?.contentEn ?? "");
    setReason("");
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scope) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await appendFormalProblemDescription(businessOrderId, {
        scope,
        repairRoundId: scope === "repair_round" ? context.currentRound?.repairRoundId : null,
        expectedVersion: scope === "business_order"
          ? context.current?.versionNo ?? 0
          : context.currentRound?.versionNo ?? 0,
        contentZh,
        contentEn,
        reason,
      });
      onSaved(updated);
      setScope(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (english ? "Could not save the problem description" : "问题描述保存失败"));
    } finally {
      setSaving(false);
    }
  };

  const historyButton = <button type="button" aria-expanded={historyOpen} aria-label={historyOpen ? (english ? "Hide problem history" : "收起问题历史") : (english ? "View problem history" : "查看问题历史")} onClick={() => setHistoryOpen((open) => !open)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-card px-2.5 text-xs font-bold text-ink-soft"><Clock3 size={13} />{historyOpen ? (english ? "Hide" : "收起") : (english ? "History" : "历史")}</button>;
  const businessOrderActions = <div className="flex shrink-0 items-center gap-1.5">
    {historyButton}
    {canWrite ? <button type="button" aria-label={english ? "Edit Business Order problem description" : "修改整单问题描述"} onClick={() => openEditor("business_order")} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-accent bg-card px-2.5 text-xs font-bold text-accent"><Pencil size={13} />{english ? "Edit" : "修改"}</button> : null}
  </div>;

  return (
    <section data-testid="business-order-problem-context" className="mb-3 border-b border-line pb-3">
      {!hasVisibleContent ? <div data-testid="business-order-problem-empty" className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-sm font-bold text-ink">{english ? "Problem description" : "问题描述"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? "Current problem description pending" : "当前问题描述待补"}</p></div>
        <div className="flex shrink-0 items-center gap-1.5">{historyButton}{canWrite ? <button type="button" aria-label={english ? "Edit problem description" : "修改问题描述"} onClick={() => openEditor("business_order")} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-accent px-2.5 text-xs font-bold text-accent"><Pencil size={13} />{english ? "Add details" : "补充描述"}</button> : null}</div>
      </div> : <div className={`grid gap-2 ${showRound ? "lg:grid-cols-2" : ""}`}>
        {currentContent ? <article data-testid="business-order-current-problem" className="flex items-start justify-between gap-3 rounded-xl bg-accent-subtle px-3 py-2">
          <p className="whitespace-pre-wrap text-sm leading-5 text-ink min-[900px]:line-clamp-2">{currentContent}</p>
          {businessOrderActions}
        </article> : null}

        {showRound && currentRoundContent ? <article data-testid="repair-round-current-problem" className="flex items-start justify-between gap-3 rounded-xl bg-state-warning-subtle px-3 py-2">
          <p className="whitespace-pre-wrap text-sm leading-5 text-ink">{currentRoundContent}</p>
          <div className="flex shrink-0 items-center gap-1.5">{!currentContent ? businessOrderActions : null}{canWrite ? <button type="button" aria-label={english ? "Edit repair-round problem description" : "修改本轮问题描述"} onClick={() => openEditor("repair_round")} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-state-warning-border bg-card px-2.5 text-xs font-bold text-state-warning-text"><Pencil size={13} />{english ? "Edit round" : "修改本轮"}</button> : null}</div>
        </article> : null}
        {!showRound && canWrite && context.currentRound ? <button type="button" onClick={() => openEditor("repair_round")} className="justify-self-start text-xs font-semibold text-primary hover:underline">{english ? "Set a separate description for this repair round" : "为本轮单独设置问题描述"}</button> : null}
      </div>}

      {historyOpen ? <div className="mt-4 border-t border-line pt-4">
        <h3 className="text-xs font-bold">{english ? "Original description and version history" : "原始内容与版本历史"}</h3>
        <article className="mt-2 rounded-xl bg-layer-2 p-3 text-xs">
          <div className="flex flex-wrap justify-between gap-2"><strong>{english ? "Original description" : "创建时原始问题描述"}</strong><span className="text-ink-soft">{context.original.confirmedByName} · {formatDateTime(context.original.confirmedAt)}</span></div>
          <p className="mt-2 whitespace-pre-wrap leading-5">{displayContent(context.original, english) ?? (context.original.contentZh?.trim() || (english ? "Not entered at creation" : "创建时未填写"))}</p>
          {english && !context.original.contentEn?.trim() && context.original.contentZh?.trim() ? <p className="mt-1 text-ink-soft">English translation pending · Chinese original shown</p> : null}
        </article>
        {timeline.length ? <ol className="mt-2 divide-y divide-line rounded-xl border border-line">{timeline.map((version) => <li key={`${version.scope}-${version.id}`} className="p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong>{version.scope === "business_order" ? (english ? `Business Order v${version.versionNo}` : `整单版本 ${version.versionNo}`) : (english ? `Round ${version.roundNo} v${version.versionNo}` : `第 ${version.roundNo} 轮版本 ${version.versionNo}`)}</strong><span className="text-ink-soft">{version.createdByName} · {formatDateTime(version.createdAt)}</span></div><p className="mt-1 text-ink-soft">{version.changeReason}</p><p className="mt-2 whitespace-pre-wrap leading-5">{displayContent(version, english) ?? (version.contentZh?.trim() || (english ? "Not entered" : "未填写"))}</p>{english && !version.contentEn?.trim() && version.contentZh?.trim() ? <p className="mt-1 text-ink-soft">English translation pending · Chinese original shown</p> : null}</li>)}</ol> : null}
      </div> : null}

      <ActionDialog open={scope !== null} title={scope === "business_order" ? (english ? "Edit Business Order problem description" : "修改整张业务单问题描述") : (english ? "Edit repair-round problem description" : "修改本轮问题描述")} description={english ? "Saving creates a new version. Previous versions remain in history." : "保存会新增一个版本，旧版本继续保留在历史中。"} onClose={() => { if (!saving) setScope(null); }}>
        <form onSubmit={submit}>
          <label className="block text-xs font-bold">{english ? "Chinese content" : "中文内容"}<textarea value={contentZh} onChange={(event) => setContentZh(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-line bg-layer-2 p-3 text-sm leading-6 text-ink" /></label>
          <label className="mt-3 block text-xs font-bold">{english ? "English content" : "英文内容"}<textarea value={contentEn} onChange={(event) => setContentEn(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-line bg-layer-2 p-3 text-sm leading-6 text-ink" /></label>
          <label className="mt-3 block text-xs font-bold">{english ? "Reason for change" : "修改原因"}<input required value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-sm text-ink" /></label>
          {error ? <p role="alert" className="mt-3 rounded-lg border border-state-danger-border bg-state-danger-subtle px-3 py-2 text-xs font-semibold text-state-danger-text">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setScope(null)} className="min-h-10 rounded-lg border border-line px-4 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={saving || !reason.trim() || (!contentZh.trim() && !contentEn.trim())} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">{saving ? (english ? "Saving…" : "正在保存…") : (english ? "Save new version" : "保存新版本")}</button></div>
        </form>
      </ActionDialog>
    </section>
  );
}
