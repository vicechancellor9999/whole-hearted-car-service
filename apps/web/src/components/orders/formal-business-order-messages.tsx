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
import { useI18n } from "@/lib/i18n/language";

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
  const { language } = useI18n();
  const english = language === "en";
  const readError = english ? "Could not load comments" : "评论读取失败";
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
      setError(english ? readError : (caught instanceof Error ? caught.message : readError));
    } finally {
      setLoading(false);
    }
  }, [businessOrderId, english, onMentionsRead, readError]);

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
      if (active) setError(english ? readError : (caught instanceof Error ? caught.message : readError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [businessOrderId, english, onMentionsRead, readError]);

  const addPhotos = (files: File[]) => {
    const images = files.filter((file) => COMMENT_IMAGE_TYPES.has(file.type));
    if (images.length !== files.length) setError(english ? "Comment photos must be JPG, PNG or WebP files" : "评论照片只支持 JPG、PNG 或 WebP");
    setSelectedPhotos((current) => {
      const merged = [...current, ...images];
      if (merged.length > MAX_COMMENT_IMAGES) setError(english ? `Each comment can include up to ${MAX_COMMENT_IMAGES} photos` : `每条评论最多上传 ${MAX_COMMENT_IMAGES} 张照片`);
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
          caption: english ? "Comment photo" : "评论照片",
        });
        uploaded.push(attachment);
        uploadedCount += 1;
      }
      const created = await createFormalBusinessOrderMessage(businessOrderId, {
        body: body.trim() || (english ? "Uploaded photos" : "上传了照片"),
        mentionedAccountIds: mentionedIds,
        attachmentIds: uploaded.map((attachment) => attachment.id),
      });
      setMessages((current) => [...current, created]);
      setBody("");
      setMentionedIds([]);
      setSelectedPhotos([]);
    } catch (caught) {
      const message = english ? "Could not post the comment" : (caught instanceof Error ? caught.message : "评论发布失败");
      setError(uploadedCount > 0 ? (english ? `The photos were saved as Business Order attachments, but the comment could not be posted: ${message}` : `照片已保存到业务附件，但评论发布失败：${message}`) : message);
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
      setError(english ? "Could not save the edited comment" : (caught instanceof Error ? caught.message : "评论编辑失败"));
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
        <div><h2 className="text-sm font-bold">{english ? "Comments" : "评论区"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? "Discuss this Business Order, mention colleagues and share workshop photos." : "围绕本业务单留言、@同事并分享现场照片。"}</p></div>
        <span className="text-xs text-ink-soft">{english ? `${messages.length} comments` : `${messages.length} 条评论`}</span>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">{english ? "Reload" : "重新读取"}</button></p> : null}

      {canCollaborate ? (
        <form onSubmit={submit} className="mt-4 border-b border-line pb-4">
          <textarea aria-label={english ? "Comment" : "评论内容"} value={body} maxLength={4000} onChange={(event) => setBody(event.target.value)} onPaste={pastePhotos} required placeholder={english ? "Write a comment; paste photos or mention a colleague…" : "写下评论；可以粘贴照片或 @ 同事…"} className="min-h-24 w-full resize-y rounded-lg border border-line bg-layer-2 p-3 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/10" />
          {photoPreviews.length > 0 ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{photoPreviews.map((preview, index) => <figure key={`${preview.file.name}-${preview.file.lastModified}-${index}`} className="relative overflow-hidden rounded-lg border border-line bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt={preview.file.name} className="aspect-[4/3] w-full object-cover" />
            <button type="button" aria-label={english ? `Remove photo ${preview.file.name}` : `移除照片 ${preview.file.name}`} onClick={() => setSelectedPhotos((current) => current.filter((_, candidateIndex) => candidateIndex !== index))} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white"><X size={14} /></button>
          </figure>)}</div> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-xs font-semibold text-ink hover:border-primary hover:text-primary"><ImagePlus size={15} /> {english ? "Add photos" : "添加照片"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => { addPhotos(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
            <span className="text-[11px] text-ink-soft">{english ? `Select or paste photos · Up to ${MAX_COMMENT_IMAGES}` : `支持选择、粘贴照片 · 最多 ${MAX_COMMENT_IMAGES} 张`}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{accounts.filter((account) => account.id !== currentAccountId).map((account) => <label key={account.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${mentionedIds.includes(account.id) ? "border-accent-solid bg-accent-solid text-accent-foreground" : "border-line bg-layer-2"}`}><input type="checkbox" className="sr-only" checked={mentionedIds.includes(account.id)} onChange={() => setMentionedIds((ids) => ids.includes(account.id) ? ids.filter((id) => id !== account.id) : [...ids, account.id])} />@{account.displayName}</label>)}</div>
          <div className="mt-3 flex items-center justify-between gap-3"><span className="text-[11px] text-ink-soft">{body.length} / 4000</span><button disabled={busy || (!body.trim() && selectedPhotos.length === 0)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-40"><Send size={14} /> {busy ? (english ? "Posting…" : "发布中…") : (english ? "Post comment" : "发布评论")}</button></div>
        </form>
      ) : <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft">{english ? "This account can view comments." : "当前账号可查看评论。"}</p>}

      <div className="divide-y divide-line" aria-live="polite">
        {loading ? <p className="py-6 text-xs text-ink-soft">{english ? "Loading comments…" : "正在读取评论…"}</p> : messages.length === 0 ? <p className="py-10 text-center text-xs text-ink-soft">{english ? "No comments yet." : "还没有评论。"}</p> : messages.map((message) => <article id={`business-order-message-${message.id}`} key={message.id} className={`grid grid-cols-[36px_minmax(0,1fr)] gap-3 py-4 ${highlightedMessageId === message.id ? "bg-state-warning-subtle px-3" : ""}`}>
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-accent-solid text-xs font-bold text-accent-foreground">{authorInitial(message.authorDisplayName)}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><p><strong className="text-sm">{message.authorDisplayName}</strong><small className="ml-2 text-ink-soft">{english && message.authorRole === "超级管理员" ? "Super Administrator" : message.authorRole}</small></p><time className="text-[11px] text-ink-soft">{formatDateTime(message.createdAt)}{message.editedAt ? (english ? " · Edited" : " · 已编辑") : ""}</time></div>
            {editing?.id === message.id ? <form onSubmit={saveEdit} className="mt-3"><textarea aria-label={english ? "Edit comment" : "编辑评论内容"} value={editBody} maxLength={4000} onChange={(event) => setEditBody(event.target.value)} className="min-h-20 w-full rounded-lg border border-line p-3 text-sm" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-line px-3 py-2 text-xs font-bold">{english ? "Cancel" : "取消"}</button><button disabled={busy || !editBody.trim()} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white">{english ? "Save changes" : "保存修改"}</button></div></form> : <>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
              {message.attachments.length > 0 ? <div className="mt-3 grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-3">{message.attachments.map((attachment) => <a key={attachment.id} href={attachmentUrl(businessOrderId, attachment.id)} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-line bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachmentUrl(businessOrderId, attachment.id)} alt={attachment.caption ?? attachment.originalName} className="aspect-[4/3] w-full object-cover" />
              </a>)}</div> : null}
              <div className="mt-2 flex flex-wrap items-center gap-3">{message.mentions.length > 0 ? <p className="text-xs font-semibold text-primary">{message.mentions.map((mention) => `@${mention.displayName}`).join(english ? ", " : "、")}</p> : null}{message.authorAccountId === currentAccountId ? <button type="button" onClick={() => { setEditing(message); setEditBody(message.body); }} className="inline-flex items-center gap-1 text-xs font-bold text-primary"><Pencil size={12} /> {english ? "Edit" : "编辑"}</button> : null}</div>
            </>}
          </div>
        </article>)}
      </div>
    </div>
  );
}
