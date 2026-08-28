"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { ExternalLink, FileText, LoaderCircle, Paperclip, Printer, Upload } from "lucide-react";
import {
  formalDocumentKindLabel,
  type FormalBusinessOrderDocument,
} from "@/lib/api/formal-business-orders";
import {
  fetchFormalBusinessOrderAttachments,
  uploadFormalBusinessOrderAttachment,
  type FormalBusinessOrderAttachment,
  type FormalBusinessOrderAttachmentCategory,
} from "@/lib/api/formal-business-order-attachments";
import { formatDateTime } from "@/lib/utils";

const ATTACHMENT_CATEGORY_LABELS: Record<FormalBusinessOrderAttachmentCategory, string> = {
  customer_signature: "客户签字",
  service_photo: "服务照片",
  financial_evidence: "财务凭证",
  other: "其他附件",
};

const ACCEPTED_FILES = "image/jpeg,image/png,image/webp,application/pdf";

export function FormalBusinessOrderDocumentsWorkspace({
  businessOrderId,
  documents,
  canWrite,
  busy,
  onGenerate,
}: {
  businessOrderId: number;
  documents: FormalBusinessOrderDocument[];
  canWrite: boolean;
  busy: boolean;
  onGenerate(kind: FormalBusinessOrderDocument["kind"]): Promise<FormalBusinessOrderDocument | null>;
}) {
  const newestDocumentId = useMemo(() => [...documents].sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt))[0]?.id ?? null, [documents]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(newestDocumentId);
  const [attachments, setAttachments] = useState<FormalBusinessOrderAttachment[]>([]);
  const [category, setCategory] = useState<FormalBusinessOrderAttachmentCategory>("customer_signature");
  const [caption, setCaption] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

  const loadAttachments = useCallback(async () => {
    setAttachmentError(null);
    try {
      const page = await fetchFormalBusinessOrderAttachments(businessOrderId);
      setAttachments(page.items);
    } catch (caught) {
      setAttachmentError(caught instanceof Error ? caught.message : "业务附件读取失败");
    }
  }, [businessOrderId]);

  useEffect(() => {
    let active = true;
    void fetchFormalBusinessOrderAttachments(businessOrderId)
      .then((page) => { if (active) setAttachments(page.items); })
      .catch((caught) => { if (active) setAttachmentError(caught instanceof Error ? caught.message : "业务附件读取失败"); });
    return () => { active = false; };
  }, [businessOrderId]);

  const uploadFiles = async (files: File[]) => {
    if (!canWrite || files.length === 0) return;
    setAttachmentBusy(true);
    setAttachmentError(null);
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
      setAttachmentError(caught instanceof Error ? caught.message : "业务附件上传失败");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const generateAndSelect = async (kind: FormalBusinessOrderDocument["kind"]) => {
    const document = await onGenerate(kind);
    if (document) setSelectedDocumentId(document.id);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) void uploadFiles(files);
  };

  const effectiveSelectedDocumentId = documents.some((document) => document.id === selectedDocumentId)
    ? selectedDocumentId
    : newestDocumentId;
  const selectedDocument = documents.find((document) => document.id === effectiveSelectedDocumentId) ?? null;
  const previewUrl = selectedDocument ? `/orders/business/${businessOrderId}/documents/${selectedDocument.id}/print?embed=1` : null;
  const printUrl = selectedDocument ? `/orders/business/${businessOrderId}/documents/${selectedDocument.id}/print` : null;

  return (
    <div className="space-y-4">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-bold">三联、预览与打印</h2><p className="mt-1 text-xs text-ink-soft">每次生成都会冻结当时的业务事实；选择文件后可直接预览并调用系统打印。</p></div>
          {canWrite ? <div className="flex flex-wrap gap-2"><button disabled={busy} type="button" onClick={() => void generateAndSelect("customer_copy")} className="min-h-9 rounded-lg bg-primary px-3 text-xs font-bold text-white disabled:opacity-50">生成客户联</button><button disabled={busy} type="button" onClick={() => void generateAndSelect("office_archive")} className="min-h-9 rounded-lg border border-primary px-3 text-xs font-bold text-primary disabled:opacity-50">生成办公室签字留底联</button><button disabled={busy} type="button" onClick={() => void generateAndSelect("mechanic_work")} className="min-h-9 rounded-lg border border-primary px-3 text-xs font-bold text-primary disabled:opacity-50">生成维修工联</button></div> : null}
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-xl border border-line bg-layer-2">
            {documents.length === 0 ? <p className="px-3 py-8 text-center text-xs text-ink-soft">尚未生成正式打印文件。</p> : documents.map((document) => <button key={document.id} type="button" onClick={() => setSelectedDocumentId(document.id)} className={`block w-full border-b border-line px-3 py-3 text-left text-xs last:border-0 ${effectiveSelectedDocumentId === document.id ? "bg-primary-50 text-primary" : "hover:bg-surface"}`}><strong className="block">{document.documentNo}</strong><span className="mt-1 block text-ink-soft">{formalDocumentKindLabel(document.kind)} · V{document.chargeVersionNo}</span><time className="mt-1 block text-[10px] text-ink-soft">{formatDateTime(document.generatedAt)}</time></button>)}
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-surface/50">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-card px-3 py-2">
              <div className="inline-flex items-center gap-2"><FileText size={15} className="text-primary" /><strong className="text-xs">单据预览</strong>{selectedDocument ? <span className="text-[11px] text-ink-soft">{selectedDocument.documentNo}</span> : null}</div>
              <div className="flex gap-2"><button type="button" disabled={!selectedDocument} onClick={() => previewRef.current?.contentWindow?.print()} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-white disabled:opacity-40"><Printer size={14} />系统打印</button>{printUrl ? <a href={printUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold"><ExternalLink size={13} />新窗口</a> : null}</div>
            </div>
            {previewUrl ? <iframe ref={previewRef} title="正式单据预览" src={previewUrl} className="h-[680px] w-full bg-white" /> : <div className="grid h-72 place-items-center text-xs text-ink-soft">选择或生成一份正式文件后在这里预览。</div>}
          </div>
        </div>
      </section>

      <section className="border-t border-line pt-4">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-bold">业务附件</h2><p className="mt-1 text-xs text-ink-soft">客户签字扫描件、维修照片、财务凭证和其他相关资料统一归档在本业务单。</p></div><span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-soft">{attachments.length} 份</span></div>
        {canWrite ? <div className="mt-3 grid gap-3 rounded-xl border border-line bg-surface/60 p-3 lg:grid-cols-[180px_minmax(0,1fr)]">
          <div className="space-y-2"><label className="block text-xs font-semibold">附件类别<select value={category} onChange={(event) => setCategory(event.target.value as FormalBusinessOrderAttachmentCategory)} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-ink">{Object.entries(ATTACHMENT_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block text-xs font-semibold">说明（可选）<input value={caption} onChange={(event) => setCaption(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-layer-2 px-3 text-ink" /></label></div>
          <div tabIndex={0} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onPaste={onPaste} className="grid min-h-28 place-items-center rounded-xl border border-dashed border-accent bg-layer-2 p-4 text-center outline-none focus:ring-2 focus:ring-accent/20">
            <label className="cursor-pointer"><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-primary-50 text-primary">{attachmentBusy ? <LoaderCircle size={19} className="animate-spin" /> : <Upload size={19} />}</span><strong className="mt-2 block text-xs">拖入、粘贴或选择附件</strong><small className="mt-1 block text-ink-soft">JPG、PNG、WebP、PDF · 单个不超过 25 MB</small><input type="file" multiple accept={ACCEPTED_FILES} disabled={attachmentBusy} className="sr-only" onChange={(event) => { void uploadFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
          </div>
        </div> : null}
        {attachmentError ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{attachmentError}<button type="button" onClick={() => void loadAttachments()} className="ml-2 underline">重新读取</button></p> : null}
        {attachments.length === 0 ? <div className="mt-3 grid min-h-24 place-items-center rounded-xl border border-dashed border-line text-xs text-ink-soft"><Paperclip size={18} /><span>还没有业务附件。</span></div> : <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{attachments.map((attachment) => <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-line bg-layer-2 hover:border-accent">
          {attachment.mediaType.startsWith("image/") ? <div className="overflow-hidden bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachment.url} alt={attachment.caption ?? attachment.originalName} className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" />
          </div> : <div className="grid aspect-[4/3] place-items-center bg-surface text-primary"><FileText size={30} /></div>}
          <div className="p-3"><p className="flex items-center gap-1.5 text-xs font-bold"><span className="rounded bg-primary-50 px-1.5 py-0.5 text-[10px] text-primary">{ATTACHMENT_CATEGORY_LABELS[attachment.category]}</span>{attachment.caption || attachment.originalName}</p><small className="mt-1 block truncate text-ink-soft">{attachment.uploaderDisplayName} · {formatDateTime(attachment.linkedAt)}</small></div>
        </a>)}</div>}
      </section>
    </div>
  );
}
