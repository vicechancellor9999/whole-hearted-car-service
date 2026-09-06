"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { Camera, FileText, LoaderCircle, Paperclip, Upload, X } from "lucide-react";
import {
  fetchFormalBusinessOrderAttachments,
  uploadFormalBusinessOrderAttachment,
  type FormalBusinessOrderAttachment,
  type FormalBusinessOrderAttachmentCategory,
} from "@/lib/api/formal-business-order-attachments";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/language";
import {
  captureVehicleDocumentFrame,
  documentCameraConstraints,
} from "@/lib/customers/vehicle-document-camera";

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
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);

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

  useEffect(() => {
    if (cameraStream && cameraVideoRef.current) cameraVideoRef.current.srcObject = cameraStream;
    return () => cameraStream?.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

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
  const closeCamera = () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
  };
  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(english ? "No camera or document camera is available in this browser." : "当前浏览器没有检测到可用的摄像头或高拍仪。");
      return;
    }
    closeCamera();
    setCameraStarting(true);
    setCameraError(null);
    try {
      setCameraStream(await navigator.mediaDevices.getUserMedia(documentCameraConstraints()));
    } catch {
      setCameraError(english ? "Could not open the camera. Check the device and browser permission." : "无法打开摄像头，请确认设备已连接并允许浏览器使用摄像头。");
    } finally {
      setCameraStarting(false);
    }
  };
  const captureFromCamera = async () => {
    if (!cameraVideoRef.current) return;
    setCameraError(null);
    try {
      const file = await captureVehicleDocumentFrame(cameraVideoRef.current);
      await uploadFiles([file]);
      closeCamera();
    } catch (caught) {
      setCameraError(english ? "Could not capture the camera image. Try again." : (caught instanceof Error ? caught.message : "摄像头拍照失败，请重试"));
    }
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
          <div><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-accent-subtle text-accent">{busy ? <LoaderCircle size={19} className="animate-spin" /> : <Upload size={19} />}</span><strong className="mt-2 block text-xs">{english ? "Drop, paste or add attachments" : "拖入、粘贴或添加附件"}</strong><small className="mt-1 block text-ink-soft">{english ? "JPG, PNG, WebP or PDF · Up to 25 MB each" : "JPG、PNG、WebP、PDF · 单个不超过 25 MB"}</small><div className="mt-3 flex flex-wrap justify-center gap-2"><label className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-primary bg-card px-3 text-xs font-bold text-primary"><Upload size={15} aria-hidden />{english ? "Select files" : "选择附件"}<input type="file" multiple accept={ACCEPTED_FILES} disabled={busy} className="sr-only" onChange={(event) => { void uploadFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label><button type="button" data-testid="business-order-camera-open" disabled={busy || cameraStarting || Boolean(cameraStream)} onClick={() => void openCamera()} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-white disabled:opacity-45"><Camera size={15} aria-hidden />{cameraStarting ? (english ? "Opening…" : "正在打开…") : (english ? "Use camera" : "调用摄像头")}</button></div></div>
        </div>
        {cameraStream ? <div className="overflow-hidden rounded-xl border border-primary/35 bg-slate-950 lg:col-start-2"><video ref={cameraVideoRef} autoPlay playsInline muted data-testid="business-order-camera-preview" className="max-h-72 w-full object-contain" /><div className="grid grid-cols-2 gap-2 bg-card p-2"><button type="button" data-testid="business-order-camera-capture" disabled={busy} onClick={() => void captureFromCamera()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-white disabled:opacity-45"><Camera size={15} aria-hidden />{english ? "Capture and upload" : "拍照并上传"}</button><button type="button" data-testid="business-order-camera-close" onClick={closeCamera} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-layer-2 px-3 text-xs font-bold text-ink"><X size={15} aria-hidden />{english ? "Close preview" : "关闭取景"}</button></div></div> : null}
        {cameraError ? <p role="alert" className="rounded-lg border border-state-warning-border bg-state-warning-subtle px-3 py-2 text-xs font-semibold text-state-warning-text lg:col-start-2">{cameraError}</p> : null}
      </div> : <p className="mt-3 rounded-xl bg-layer-2 px-3 py-2 text-xs text-ink-soft">{english ? "This account can view attachments but cannot upload new files." : "当前账号可查看附件，但不能上传新文件。"}</p>}
      {error ? <p role="alert" className="mt-3 rounded-lg border border-state-danger-border bg-state-danger-subtle px-3 py-2 text-xs font-semibold text-state-danger-text">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">{english ? "Reload" : "重新读取"}</button></p> : null}
      {attachments.length === 0 ? <div className="mt-3 grid min-h-32 place-items-center rounded-xl border border-dashed border-line text-xs text-ink-soft"><Paperclip size={18} /><span>{english ? "No Business Order attachments yet." : "还没有业务附件。"}</span></div> : <div className="mt-3 flex flex-wrap gap-2">{attachments.map((attachment) => <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="group grid h-24 w-full min-w-0 grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-xl border border-line bg-layer-2 hover:border-accent sm:w-[280px]">
        {attachment.mediaType.startsWith("image/") ? <div className="h-full overflow-hidden bg-layer-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.url} alt={attachment.caption ?? attachment.originalName} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        </div> : <div className="grid h-full place-items-center bg-layer-1 text-primary"><FileText size={26} /></div>}
        <div className="min-w-0 p-2.5"><span className="inline-block rounded bg-accent-subtle px-1.5 py-0.5 text-[10px] font-bold text-accent">{labels[attachment.category]}</span><p title={attachment.caption || attachment.originalName} className="mt-1 truncate text-xs font-bold">{attachment.caption || attachment.originalName}</p><small className="mt-1 block truncate text-ink-soft">{attachment.uploaderDisplayName} · {formatDateTime(attachment.linkedAt)}</small></div>
      </a>)}</div>}
    </div>
  );
}
