"use client";

import { useCallback, useEffect, useState, type ClipboardEvent, type DragEvent } from "react";
import { FileText, LoaderCircle, Paperclip, Upload } from "lucide-react";
import {
  fetchFormalBusinessOrderAttachments,
  uploadFormalBusinessOrderAttachment,
  type FormalBusinessOrderAttachment,
  type FormalBusinessOrderAttachmentCategory,
} from "@/lib/api/formal-business-order-attachments";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/language";

const CATEGORY_LABELS: Record<FormalBusinessOrderAttachmentCategory, string> = {
  customer_signature: "客户签字",
  service_photo: "服务照片",
  financial_evidence: "财务凭证",
  other: "其他附件",
};
const CATEGORY_LABELS_EN: Record<FormalBusinessOrderAttachmentCategory, string> = {
  customer_signature: "Customer signature",
  service_photo: "Service photo",
  financial_evidence: "Financial evidence",
  other: "Other attachment",
};
const ACCEPTED_FILES = "image/jpeg,image/png,image/webp,application/pdf";

export function FormalBusinessOrderAttachmentsWorkspace({
  businessOrderId,
  canWrite,
}: {
  businessOrderId: number;
  canWrite: boolean;
}) {
  const { language } = useI18n();
  const english = language === "en";
  const labels = english ? CATEGORY_LABELS_EN : CATEGORY_LABELS;
  const [attachments, setAttachments] = useState<FormalBusinessOrderAttachment[]>([]);
  const [category, setCategory] = useState<FormalBusinessOrderAttachmentCategory>("customer_signature");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await fetchFormalBusinessOrderAttachments(businessOrderId);
      setAttachments(page.items);
    } catch (caught) {
      setError(english ? "Could not load Business Order attachments" : (caught instanceof Error ? caught.message : "业务附件读取失败"));
    }
  }, [businessOrderId, english]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadFiles = async (files: File[]) => {
    if (!canWrite || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded: FormalBusinessOrderAttachment[] = [];
      for (const file of files) {
        uploaded.push(await uploadFormalBusinessOrderAttachment(businessOrderId, {
          file,
          category,
          caption: caption.trim() || null,
        }));
      }
      setAttachments((current) => [...uploaded, ...current]);
      setCaption("");
    } catch (caught) {
      setError(english ? "Could not upload the Business Order attachment" : (caught instanceof Error ? caught.message : "业务附件上传失败"));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void uploadFiles(Array.from(event.dataTransfer.files));
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length) void uploadFiles(files);
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-sm font-bold">{english ? "Business attachments" : "业务附件"}</h2><p className="mt-1 text-xs text-ink-soft">{english ? "Keep customer signatures, repair photos, financial evidence and related files with this Business Order." : "客户签字扫描件、维修照片、财务凭证和其他相关资料统一归档在本业务单。"}</p></div>
        <span className="rounded-full bg-layer-2 px-3 py-1 text-xs font-semibold text-ink-soft">{english ? `${attachments.length} files` : `${attachments.length} 份`}</span>
      </div>
      {canWrite ? <div className="mt-3 grid gap-3 rounded-xl border border-line bg-layer-1 p-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-2">
          <fieldset><legend className="text-xs font-semibold">{english ? "Attachment category" : "附件类别"}</legend><div className="mt-1 grid grid-cols-2 gap-1">{Object.entries(labels).map(([value, label]) => <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value as FormalBusinessOrderAttachmentCategory)} className={`min-h-9 rounded-lg border px-2 text-[11px] font-bold ${category === value ? "border-primary bg-primary text-white" : "border-line bg-layer-2 text-ink"}`}>{label}</button>)}</div></fieldset>
          <label className="block text-xs font-semibold">{english ? "Description (optional)" : "说明（可选）"}<input value={caption} onChange={(event) => setCaption(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-ink" /></label>
        </div>
        <div tabIndex={0} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onPaste={onPaste} className="grid min-h-32 place-items-center rounded-xl border border-dashed border-accent bg-layer-2 p-4 text-center outline-none focus:ring-2 focus:ring-accent/20">
          <label className="cursor-pointer"><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-accent-subtle text-accent">{busy ? <LoaderCircle size={19} className="animate-spin" /> : <Upload size={19} />}</span><strong className="mt-2 block text-xs">{english ? "Drop, paste or select attachments" : "拖入、粘贴或选择附件"}</strong><small className="mt-1 block text-ink-soft">{english ? "JPG, PNG, WebP or PDF · Up to 25 MB each" : "JPG、PNG、WebP、PDF · 单个不超过 25 MB"}</small><input type="file" multiple accept={ACCEPTED_FILES} disabled={busy} className="sr-only" onChange={(event) => { void uploadFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
        </div>
      </div> : <p className="mt-3 rounded-xl bg-layer-2 px-3 py-2 text-xs text-ink-soft">{english ? "This account can view attachments but cannot upload new files." : "当前账号可查看附件，但不能上传新文件。"}</p>}
      {error ? <p role="alert" className="mt-3 rounded-lg border border-state-danger-border bg-state-danger-subtle px-3 py-2 text-xs font-semibold text-state-danger-text">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">{english ? "Reload" : "重新读取"}</button></p> : null}
      {attachments.length === 0 ? <div className="mt-3 grid min-h-32 place-items-center rounded-xl border border-dashed border-line text-xs text-ink-soft"><Paperclip size={18} /><span>{english ? "No Business Order attachments yet." : "还没有业务附件。"}</span></div> : <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{attachments.map((attachment) => <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-line bg-layer-2 hover:border-accent">
        {attachment.mediaType.startsWith("image/") ? <div className="overflow-hidden bg-layer-1">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={attachment.url} alt={attachment.caption ?? attachment.originalName} className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" /></div> : <div className="grid aspect-[4/3] place-items-center bg-layer-1 text-primary"><FileText size={30} /></div>}
        <div className="p-3"><p className="flex items-center gap-1.5 text-xs font-bold"><span className="rounded bg-accent-subtle px-1.5 py-0.5 text-[10px] text-accent">{labels[attachment.category]}</span>{attachment.caption || attachment.originalName}</p><small className="mt-1 block truncate text-ink-soft">{attachment.uploaderDisplayName} · {formatDateTime(attachment.linkedAt)}</small></div>
      </a>)}</div>}
    </div>
  );
}
