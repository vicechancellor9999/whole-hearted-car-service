"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createFormalBusinessOrderMessage,
  editFormalBusinessOrderMessage,
  fetchFormalBusinessOrderMessages,
  fetchFormalMentionableAccounts,
  markFormalBusinessOrderMentionsRead,
  type FormalBusinessOrderMessage,
  type FormalMentionableAccount,
} from "@/lib/api/formal-business-order-collaboration";
import { formatDateTime } from "@/lib/utils";

export function FormalBusinessOrderMessages({ businessOrderId, currentAccountId, canCollaborate, highlightedMessageId, onMentionsRead }: {
  businessOrderId: number; currentAccountId: number; canCollaborate: boolean; highlightedMessageId: number | null; onMentionsRead(): void;
}) {
  const [messages, setMessages] = useState<FormalBusinessOrderMessage[]>([]);
  const [accounts, setAccounts] = useState<FormalMentionableAccount[]>([]);
  const [body, setBody] = useState("");
  const [mentionedIds, setMentionedIds] = useState<number[]>([]);
  const [editing, setEditing] = useState<FormalBusinessOrderMessage | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [page, mentionable] = await Promise.all([fetchFormalBusinessOrderMessages(businessOrderId), fetchFormalMentionableAccounts()]);
      setMessages(page.items); setAccounts(mentionable);
      await markFormalBusinessOrderMentionsRead(businessOrderId);
      onMentionsRead();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "留言读取失败"); }
    finally { setLoading(false); }
  }, [businessOrderId, onMentionsRead]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!body.trim()) return;
    setBusy(true); setError(null);
    try { const created = await createFormalBusinessOrderMessage(businessOrderId, { body, mentionedAccountIds: mentionedIds }); setMessages((current) => [...current, created]); setBody(""); setMentionedIds([]); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "留言发布失败"); }
    finally { setBusy(false); }
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault(); if (!editing || !editBody.trim()) return;
    setBusy(true); setError(null);
    try {
      const updated = await editFormalBusinessOrderMessage(businessOrderId, editing.id, { body: editBody, mentionedAccountIds: editing.mentions.map((item) => item.accountId), expectedVersion: editing.version });
      setMessages((current) => current.map((item) => item.id === updated.id ? updated : item)); setEditing(null); setEditBody("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "留言编辑失败"); }
    finally { setBusy(false); }
  };

  return <div>
    <div className="flex items-end justify-between gap-3 border-b border-line pb-3"><div><h2 className="text-sm font-bold">沟通交流</h2><p className="mt-1 text-xs text-ink-soft">本业务单的内部留言；可 @ 系统用户，刷新或重登后仍会保留。</p></div><span className="text-xs text-ink-soft">{messages.length} 条</span></div>
    {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error} <button type="button" onClick={() => void load()} className="ml-2 underline">重试</button></p> : null}
    {canCollaborate ? <form onSubmit={submit} className="mt-3 rounded-xl border border-primary/25 bg-primary-50/50 p-3"><label className="text-xs font-bold">写留言<textarea aria-label="留言内容" value={body} maxLength={4000} onChange={(event) => setBody(event.target.value)} required placeholder="输入本业务单的内部沟通内容…" className="mt-2 min-h-24 w-full rounded-lg border border-line bg-white p-3 text-sm" /></label><div className="mt-2 flex flex-wrap gap-2">{accounts.filter((account) => account.id !== currentAccountId).map((account) => <label key={account.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${mentionedIds.includes(account.id) ? "border-primary bg-primary text-white" : "border-line bg-white"}`}><input type="checkbox" className="sr-only" checked={mentionedIds.includes(account.id)} onChange={() => setMentionedIds((ids) => ids.includes(account.id) ? ids.filter((id) => id !== account.id) : [...ids, account.id])} />@{account.displayName}</label>)}</div><div className="mt-3 flex items-center justify-between"><span className="text-[11px] text-ink-soft">{body.length} / 4000</span><button disabled={busy || !body.trim()} className="min-h-9 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40">{busy ? "发送中…" : "发布留言"}</button></div></form> : <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft">当前账号可查看留言，但不能新增。</p>}
    <div className="mt-4 space-y-3" aria-live="polite">{loading ? <p className="text-xs text-ink-soft">正在读取留言…</p> : messages.length === 0 ? <p className="rounded-xl bg-surface px-3 py-5 text-center text-xs text-ink-soft">还没有留言。</p> : messages.map((message) => <article id={`business-order-message-${message.id}`} key={message.id} className={`rounded-xl border p-3 ${highlightedMessageId === message.id ? "border-amber-400 bg-amber-50" : "border-line"}`}><div className="flex flex-wrap items-start justify-between gap-2"><span><strong className="text-sm">{message.authorDisplayName}</strong><small className="ml-2 text-ink-soft">{message.authorRole}</small></span><span className="text-[11px] text-ink-soft">{formatDateTime(message.createdAt)}{message.editedAt ? " · 已编辑" : ""}</span></div>{editing?.id === message.id ? <form onSubmit={saveEdit} className="mt-3"><textarea aria-label="编辑留言内容" value={editBody} maxLength={4000} onChange={(event) => setEditBody(event.target.value)} className="min-h-20 w-full rounded-lg border border-line p-3 text-sm" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-line px-3 py-2 text-xs font-bold">取消</button><button disabled={busy || !editBody.trim()} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white">保存修改</button></div></form> : <><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{message.body}</p>{message.mentions.length > 0 ? <p className="mt-2 text-xs font-semibold text-primary">提及：{message.mentions.map((mention) => `@${mention.displayName}`).join("、")}</p> : null}{message.authorAccountId === currentAccountId ? <button type="button" onClick={() => { setEditing(message); setEditBody(message.body); }} className="mt-2 text-xs font-bold text-primary">编辑</button> : null}</>}</article>)}</div>
  </div>;
}
