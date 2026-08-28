"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { ImagePlus, Pencil, Send, X } from "lucide-react";
import {
  createFormalBusinessOrderMessage,
  editFormalBusinessOrderMessage,
  fetchFormalBusinessOrderMessages,
  fetchFormalMentionableAccounts,
  markFormalBusinessOrderMentionsRead,
  type FormalBusinessOrderMessage,
  type FormalMentionableAccount,
} from "@/lib/api/formal-business-order-collaboration";
import { uploadFormalBusinessOrderAttachment } from "@/lib/api/formal-business-order-attachments";
import { formatDateTime } from "@/lib/utils";

const COMMENT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_COMMENT_IMAGES = 8;

function attachmentUrl(businessOrderId: number, attachmentId: number) {
  return `/api/formal/business-orders/${businessOrderId}/attachments/${attachmentId}`;
}

function authorInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "W";
}

export function FormalBusinessOrderMessages({
  businessOrderId,
  currentAccountId,
  canCollaborate,
  highlightedMessageId,
  onMentionsRead,
}: {
  businessOrderId: number;
  currentAccountId: number;
  canCollaborate: boolean;
  highlightedMessageId: number | null;
  onMentionsRead(): void;
}) {
  const [messages, setMessages] = useState<FormalBusinessOrderMessage[]>([]);
  const [accounts, setAccounts] = useState<FormalMentionableAccount[]>([]);
  const [body, setBody] = useState("");
  const [mentionedIds, setMentionedIds] = useState<number[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [editing, setEditing] = useState<FormalBusinessOrderMessage | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const photoPreviews = useMemo(() => selectedPhotos.map((file) => ({ file, url: URL.createObjectURL(file) })), [selectedPhotos]);
  useEffect(() => () => { photoPreviews.forEach((preview) => URL.revokeObjectURL(preview.url)); }, [photoPreviews]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [page, mentionable] = await Promise.all([
        fetchFormalBusinessOrderMessages(businessOrderId),
        fetchFormalMentionableAccounts(),
      ]);
      setMessages(page.items);
      setAccounts(mentionable);
      await markFormalBusinessOrderMentionsRead(businessOrderId);
      onMentionsRead();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "评论读取失败");
    } finally {
      setLoading(false);
    }
  }, [businessOrderId, onMentionsRead]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchFormalBusinessOrderMessages(businessOrderId),
      fetchFormalMentionableAccounts(),
    ]).then(async ([page, mentionable]) => {
      if (!active) return;
      setMessages(page.items);
      setAccounts(mentionable);
      await markFormalBusinessOrderMentionsRead(businessOrderId);
      if (active) onMentionsRead();
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "评论读取失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [businessOrderId, onMentionsRead]);

  const addPhotos = (files: File[]) => {
    const images = files.filter((file) => COMMENT_IMAGE_TYPES.has(file.type));
    if (images.length !== files.length) setError("评论照片只支持 JPG、PNG 或 WebP");
    setSelectedPhotos((current) => {
      const merged = [...current, ...images];
      if (merged.length > MAX_COMMENT_IMAGES) setError(`每条评论最多上传 ${MAX_COMMENT_IMAGES} 张照片`);
      return merged.slice(0, MAX_COMMENT_IMAGES);
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim() && selectedPhotos.length === 0) return;
    setBusy(true);
    setError(null);
    let uploadedCount = 0;
    try {
      const uploaded = [];
      for (const file of selectedPhotos) {
        const attachment = await uploadFormalBusinessOrderAttachment(businessOrderId, {
          file,
          category: "service_photo",
          caption: "评论照片",
        });
        uploaded.push(attachment);
        uploadedCount += 1;
      }
      const created = await createFormalBusinessOrderMessage(businessOrderId, {
        body: body.trim() || "上传了照片",
        mentionedAccountIds: mentionedIds,
        attachmentIds: uploaded.map((attachment) => attachment.id),
      });
      setMessages((current) => [...current, created]);
      setBody("");
      setMentionedIds([]);
      setSelectedPhotos([]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "评论发布失败";
      setError(uploadedCount > 0 ? `照片已保存到业务附件，但评论发布失败：${message}` : message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || !editBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await editFormalBusinessOrderMessage(businessOrderId, editing.id, {
        body: editBody,
        mentionedAccountIds: editing.mentions.map((item) => item.accountId),
        expectedVersion: editing.version,
      });
      setMessages((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditing(null);
      setEditBody("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "评论编辑失败");
    } finally {
      setBusy(false);
    }
  };

  const pastePhotos = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => COMMENT_IMAGE_TYPES.has(file.type));
    if (files.length > 0) addPhotos(files);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-end justify-between gap-3 border-b border-line pb-3">
        <div><h2 className="text-sm font-bold">评论区</h2><p className="mt-1 text-xs text-ink-soft">围绕本业务单留言、@同事并分享现场照片。</p></div>
        <span className="text-xs text-ink-soft">{messages.length} 条评论</span>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">重新读取</button></p> : null}

      {canCollaborate ? (
        <form onSubmit={submit} className="mt-4 border-b border-line pb-4">
          <textarea aria-label="评论内容" value={body} maxLength={4000} onChange={(event) => setBody(event.target.value)} onPaste={pastePhotos} required placeholder="写下评论；可以粘贴照片或 @ 同事…" className="min-h-24 w-full resize-y rounded-lg border border-line bg-white p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
          {photoPreviews.length > 0 ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{photoPreviews.map((preview, index) => <figure key={`${preview.file.name}-${preview.file.lastModified}-${index}`} className="relative overflow-hidden rounded-lg border border-line bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt={preview.file.name} className="aspect-[4/3] w-full object-cover" />
            <button type="button" aria-label={`移除照片 ${preview.file.name}`} onClick={() => setSelectedPhotos((current) => current.filter((_, candidateIndex) => candidateIndex !== index))} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white"><X size={14} /></button>
          </figure>)}</div> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-xs font-semibold text-ink hover:border-primary hover:text-primary"><ImagePlus size={15} /> 添加照片<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => { addPhotos(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
            <span className="text-[11px] text-ink-soft">支持选择、粘贴照片 · 最多 {MAX_COMMENT_IMAGES} 张</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{accounts.filter((account) => account.id !== currentAccountId).map((account) => <label key={account.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${mentionedIds.includes(account.id) ? "border-primary bg-primary text-white" : "border-line bg-white"}`}><input type="checkbox" className="sr-only" checked={mentionedIds.includes(account.id)} onChange={() => setMentionedIds((ids) => ids.includes(account.id) ? ids.filter((id) => id !== account.id) : [...ids, account.id])} />@{account.displayName}</label>)}</div>
          <div className="mt-3 flex items-center justify-between gap-3"><span className="text-[11px] text-ink-soft">{body.length} / 4000</span><button disabled={busy || (!body.trim() && selectedPhotos.length === 0)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40"><Send size={14} /> {busy ? "发布中…" : "发布评论"}</button></div>
        </form>
      ) : <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft">当前账号可查看评论。</p>}

      <div className="divide-y divide-line" aria-live="polite">
        {loading ? <p className="py-6 text-xs text-ink-soft">正在读取评论…</p> : messages.length === 0 ? <p className="py-10 text-center text-xs text-ink-soft">还没有评论。</p> : messages.map((message) => <article id={`business-order-message-${message.id}`} key={message.id} className={`grid grid-cols-[36px_minmax(0,1fr)] gap-3 py-4 ${highlightedMessageId === message.id ? "bg-amber-50 px-3" : ""}`}>
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-slate-800 text-xs font-bold text-white">{authorInitial(message.authorDisplayName)}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><p><strong className="text-sm">{message.authorDisplayName}</strong><small className="ml-2 text-ink-soft">{message.authorRole}</small></p><time className="text-[11px] text-ink-soft">{formatDateTime(message.createdAt)}{message.editedAt ? " · 已编辑" : ""}</time></div>
            {editing?.id === message.id ? <form onSubmit={saveEdit} className="mt-3"><textarea aria-label="编辑评论内容" value={editBody} maxLength={4000} onChange={(event) => setEditBody(event.target.value)} className="min-h-20 w-full rounded-lg border border-line p-3 text-sm" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-line px-3 py-2 text-xs font-bold">取消</button><button disabled={busy || !editBody.trim()} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white">保存修改</button></div></form> : <>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
              {message.attachments.length > 0 ? <div className="mt-3 grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-3">{message.attachments.map((attachment) => <a key={attachment.id} href={attachmentUrl(businessOrderId, attachment.id)} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-line bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachmentUrl(businessOrderId, attachment.id)} alt={attachment.caption ?? attachment.originalName} className="aspect-[4/3] w-full object-cover" />
              </a>)}</div> : null}
              <div className="mt-2 flex flex-wrap items-center gap-3">{message.mentions.length > 0 ? <p className="text-xs font-semibold text-primary">{message.mentions.map((mention) => `@${mention.displayName}`).join("、")}</p> : null}{message.authorAccountId === currentAccountId ? <button type="button" onClick={() => { setEditing(message); setEditBody(message.body); }} className="inline-flex items-center gap-1 text-xs font-bold text-primary"><Pencil size={12} /> 编辑</button> : null}</div>
            </>}
          </div>
        </article>)}
      </div>
    </div>
  );
}
