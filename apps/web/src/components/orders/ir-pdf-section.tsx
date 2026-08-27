"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, FileCheck2, Maximize2, Printer, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import { api, ApiError } from "@/lib/api/client";
import type { GeneratedInspectionReportFileResult, InspectionReportDetailResponse } from "@/lib/api/mock-inspection-reports";
import type { IrPdfLanguage } from "@/lib/orders/ir-pdf";
import { printPdfBytes } from "@/lib/orders/ir-pdf-print";
import type { QuotationGenerationPreparation } from "./quotation-panel";
import { Dialog } from "@/components/ui/dialog";
import { PdfCanvasPreview } from "./pdf-canvas-preview";

const LANGUAGE_LABELS: Record<IrPdfLanguage, string> = { zh: "中文", en: "English", bilingual: "中英对照" };

interface IrPdfSectionProps {
  detail: InspectionReportDetailResponse;
  onUpdated?: (next: InspectionReportDetailResponse) => void;
  prepareQuotation?: () => Promise<QuotationGenerationPreparation | null>;
  readOnly?: boolean;
}

function newMutationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `inspection-files-${crypto.randomUUID()}`
    : `inspection-files-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generationIntentKey(reportId: string, prepared: QuotationGenerationPreparation): string {
  return JSON.stringify({
    reportId,
    expectedRevision: prepared.revision,
    contentRevision: prepared.contentRevision,
  });
}

function isGlobalRevisionConflict(error: unknown): error is ApiError {
  return error instanceof ApiError
    && error.status === 409
    && /版本已变化|revision/iu.test(error.message);
}

function generationTimeInJamaica(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value)).replaceAll("/", "-");
}

function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes.slice() as unknown as BlobPart], { type: "application/pdf" });
}

function downloadFile(file: GeneratedInspectionReportFileResult): void {
  const url = URL.createObjectURL(pdfBlob(file.bytes));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.metadata.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function IrPdfSection({ detail, onUpdated, prepareQuotation, readOnly = false }: IrPdfSectionProps) {
  const [language, setLanguage] = useState<IrPdfLanguage>("zh");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cacheMissing, setCacheMissing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<GeneratedInspectionReportFileResult | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.1);
  const generationIntentRef = useRef<{ key: string; mutationId: string } | null>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const activeBundle = detail.quotation.activeGeneratedBundle;

  useEffect(() => {
    setCacheMissing(false);
    setPreviewFile(null);
    setPreviewOpen(false);
    setPrintStatus(null);
  }, [activeBundle?.id]);

  const resolveLanguage = useCallback(async (nextLanguage: IrPdfLanguage) => {
    setBusy(true);
    setMessage(null);
    try {
      const file = await api.inspectionReports.generatedFile(detail.id, nextLanguage);
      setCacheMissing(false);
      return file;
    } catch (caught) {
      setCacheMissing(true);
      setMessage(caught instanceof Error ? caught.message : "客户文件缓存缺失或损坏，请重新生成");
      return null;
    } finally {
      setBusy(false);
    }
  }, [detail.id]);

  const generate = useCallback(async () => {
    if (readOnly || !prepareQuotation || !onUpdated) return;
    setBusy(true);
    setMessage(null);
    try {
      const prepared = await prepareQuotation();
      if (!prepared) {
        setMessage("已取消；报价未保存，没有生成正式文件。");
        return;
      }
      let currentPreparation = prepared;
      const key = generationIntentKey(detail.id, currentPreparation);
      let intent = generationIntentRef.current?.key === key
        ? generationIntentRef.current
        : { key, mutationId: newMutationId() };
      generationIntentRef.current = intent;
      let generated: Awaited<ReturnType<typeof api.inspectionReports.generateFiles>>;
      try {
        generated = await api.inspectionReports.generateFiles({
          reportId: detail.id,
          expectedRevision: currentPreparation.revision,
          mutationId: intent.mutationId,
        });
      } catch (caught) {
        if (!isGlobalRevisionConflict(caught)) throw caught;
        const latest = await api.inspectionReports.detail(detail.id);
        if (latest.quotation.contentRevision !== currentPreparation.contentRevision) {
          throw new ApiError(
            "Quotation 已被其他窗口修改，请核对；本页内容未覆盖，也未生成正式文件。",
            409,
          );
        }
        currentPreparation = {
          revision: latest.revision,
          contentRevision: latest.quotation.contentRevision,
        };
        onUpdated(latest);
        intent = {
          ...intent,
          key: generationIntentKey(detail.id, currentPreparation),
        };
        generationIntentRef.current = intent;
        generated = await api.inspectionReports.generateFiles({
          reportId: detail.id,
          expectedRevision: currentPreparation.revision,
          mutationId: intent.mutationId,
        });
      }
      const next = await api.inspectionReports.detail(detail.id);
      onUpdated(next);
      generationIntentRef.current = null;
      setCacheMissing(false);
      setMessage(`已生成 V${generated.bundle.generation} 三语客户文件（Jamaica ${generationTimeInJamaica(generated.bundle.generatedAt)}）。`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "正式文件生成失败，已保留当前报价与上一份文件");
    } finally {
      setBusy(false);
    }
  }, [detail.id, onUpdated, prepareQuotation, readOnly]);

  const openPreview = useCallback(async () => {
    const file = await resolveLanguage(language);
    if (!file) return;
    setPreviewFile(file);
    setZoom(1.1);
    setPrintStatus(null);
    setPreviewOpen(true);
    setMessage(`已打开 ${LANGUAGE_LABELS[language]} 缓存文件预览，未触发下载。`);
  }, [language, resolveLanguage]);

  const downloadCurrentLanguage = useCallback(async () => {
    const file = await resolveLanguage(language);
    if (!file) return;
    downloadFile(file);
    setMessage(`已下载 ${file.metadata.fileName}。`);
  }, [language, resolveLanguage]);

  const changePreviewLanguage = useCallback(async (nextLanguage: IrPdfLanguage) => {
    setLanguage(nextLanguage);
    const file = await resolveLanguage(nextLanguage);
    if (!file) return;
    setPreviewFile(file);
    setPrintStatus(null);
    setMessage(`已切换到 ${LANGUAGE_LABELS[nextLanguage]} 缓存文件；未生成新版本。`);
  }, [resolveLanguage]);

  const printPreview = useCallback(async () => {
    if (!previewFile || printing) return;
    setPrinting(true);
    setPrintStatus("正在打开打印窗口…");
    try {
      const printed = await printPdfBytes(previewFile);
      const nextMessage = `已调用 ${LANGUAGE_LABELS[printed.language]} 文件的浏览器打印对话框。`;
      setPrintStatus(nextMessage);
      setMessage(nextMessage);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "无法调用浏览器打印功能。";
      const nextMessage = `打印失败：${reason}`;
      setPrintStatus(nextMessage);
      setMessage(nextMessage);
    } finally {
      setPrinting(false);
    }
  }, [previewFile, printing]);

  const fitToWidth = useCallback(() => {
    const width = previewViewportRef.current?.clientWidth ?? window.innerWidth;
    setZoom(Math.max(0.5, Math.min(1.4, (width - 32) / 595.28)));
  }, []);

  const generationLabel = activeBundle
    ? `V${activeBundle.generation} · Jamaica ${generationTimeInJamaica(activeBundle.generatedAt)} · ${activeBundle.rendererVersion}`
    : "尚未生成";
  const staleLabel = !activeBundle
    ? "需先生成正式文件"
    : detail.quotation.generatedFileStale
      ? "已过期：仍可预览 / 下载，重新生成后替换"
      : "当前有效：与已保存 Quotation 一致";

  return (
    <section data-testid="ir-pdf-section" data-active-bundle-id={activeBundle?.id} className="mb-4 max-w-full min-w-0 overflow-hidden rounded-2xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Formal customer files</p>
          <h3 className="mt-1 font-bold text-ink dark:text-slate-100">客户文件（A4 / PDF）</h3>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-ink-soft dark:text-slate-400">先明确生成一次，再从同一组缓存中预览、下载或打印中文 / English / 中英对照。照片不进入文字报告。</p>
        </div>
        {!readOnly ? <button type="button" data-testid="ir-pdf-generate" disabled={busy} onClick={() => void generate()} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 motion-reduce:transition-none">
          {activeBundle || cacheMissing ? <RefreshCw size={14} aria-hidden /> : <FileCheck2 size={14} aria-hidden />}
          {busy ? "处理中…" : activeBundle || cacheMissing ? "重新生成" : "生成正式文件"}
        </button> : null}
      </div>

      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded-xl bg-surface px-3 py-2.5 dark:bg-slate-900/40"><p className="text-[10px] uppercase tracking-wide text-ink-faint">Current bundle</p><p data-testid="ir-pdf-generation" className="mt-1 break-words text-xs font-bold text-ink dark:text-slate-100">{generationLabel}</p></div>
        <div className={`min-w-0 rounded-xl px-3 py-2.5 ${detail.quotation.generatedFileStale || cacheMissing ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"}`}><p className="text-[10px] uppercase tracking-wide opacity-70">Cache state</p><p data-testid="ir-pdf-stale" className="mt-1 break-words text-xs font-bold">{cacheMissing ? "缓存缺失或损坏：请重新生成" : staleLabel}</p></div>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        <select aria-label="PDF 语言" data-testid="ir-pdf-language" value={language} onChange={(event) => setLanguage(event.target.value as IrPdfLanguage)} className="min-h-11 max-w-full rounded-lg border border-line bg-white px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-600 dark:bg-slate-900"><option value="zh">中文</option><option value="en">English</option><option value="bilingual">中英对照</option></select>
        <button ref={previewButtonRef} type="button" data-testid="ir-pdf-preview" disabled={busy || !activeBundle} onClick={() => void openPreview()} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:border-primary-300 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 motion-reduce:transition-none"><Eye size={14} aria-hidden />预览</button>
        <button type="button" data-testid="ir-pdf-download" disabled={busy || !activeBundle} onClick={() => void downloadCurrentLanguage()} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:border-primary-300 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 motion-reduce:transition-none"><Download size={14} aria-hidden />下载 PDF</button>
      </div>
      {readOnly && activeBundle && detail.quotation.generatedFileStale ? <p data-testid="ir-pdf-readonly-stale" className="mt-2 text-[11px] font-semibold text-amber-700">当前客户文件已过期；只读身份仍可查看、下载和打印这份已留档 PDF，但不能重新生成。</p> : null}
      {message ? <p role="status" data-testid="ir-pdf-status" className="mt-3 break-words text-[11px] font-semibold text-primary dark:text-primary-300">{message}</p> : null}

      <Dialog open={previewOpen && previewFile !== null} title={`Inspection Report · ${activeBundle ? `V${activeBundle.generation}` : "PDF"}`} onClose={() => setPreviewOpen(false)} dataTestId="ir-pdf-preview-dialog" closeTestId="ir-pdf-preview-close" closeLabel="关闭 PDF 预览" returnFocusElement={previewButtonRef.current} mobileFullscreen className="flex max-w-[1180px] flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 sm:h-[calc(100vh-2rem)]">
        {previewFile ? <>
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 sm:px-4">
            <select aria-label="预览语言" data-testid="ir-pdf-preview-language" value={language} disabled={busy} onChange={(event) => void changePreviewLanguage(event.target.value as IrPdfLanguage)} className="min-h-11 rounded-lg border border-line bg-white px-2.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-600 dark:bg-slate-800"><option value="zh">中文</option><option value="en">English</option><option value="bilingual">中英对照</option></select>
            <div className="flex items-center rounded-lg border border-line bg-white dark:border-slate-600 dark:bg-slate-800"><button type="button" aria-label="缩小" data-testid="ir-pdf-zoom-out" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.15).toFixed(2))))} className="grid h-11 w-11 place-items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><ZoomOut size={14} aria-hidden /></button><span className="min-w-12 text-center text-[11px] tabular-nums">{Math.round(zoom * 100)}%</span><button type="button" aria-label="放大" data-testid="ir-pdf-zoom-in" onClick={() => setZoom((value) => Math.min(2.25, Number((value + 0.15).toFixed(2))))} className="grid h-11 w-11 place-items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><ZoomIn size={14} aria-hidden /></button></div>
            <button type="button" data-testid="ir-pdf-fit" onClick={fitToWidth} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-white px-2.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-600 dark:bg-slate-800"><Maximize2 size={13} aria-hidden />适合宽度</button>
            <div className="ml-auto flex items-center gap-2"><button type="button" data-testid="ir-pdf-preview-print" aria-disabled={printing} onClick={() => void printPreview()} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-white px-2.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary aria-disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800"><Printer size={13} aria-hidden />{printing ? "打印中…" : "打印"}</button><button type="button" data-testid="ir-pdf-preview-download" onClick={() => downloadFile(previewFile)} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><Download size={13} aria-hidden />下载</button></div>
          </div>
          <div data-testid="ir-pdf-active-attachment" data-attachment-id={previewFile.metadata.id} data-language={previewFile.metadata.language} data-byte-length={previewFile.bytes.byteLength} className="border-b border-line bg-white px-4 py-2 text-[10px] text-ink-soft dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">{previewFile.metadata.fileName} · {previewFile.metadata.id} · {activeBundle?.rendererVersion}</div>
          {printStatus ? <p role="status" aria-live="polite" data-testid="ir-pdf-print-status" className={`border-b px-4 py-2 text-[11px] font-semibold ${printStatus.startsWith("打印失败") ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200" : "border-line bg-white text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-primary-300"}`}>{printStatus}</p> : null}
          <div ref={previewViewportRef} data-testid="ir-pdf-preview-viewport" className="min-h-0 flex-1 overflow-auto bg-slate-300 p-3 dark:bg-slate-900 sm:p-5"><div className="mx-auto w-max min-w-full bg-white shadow-xl"><PdfCanvasPreview bytes={previewFile.bytes} dataTestId="ir-pdf-canvas" scale={zoom} allowHorizontalOverflow thumbnailTestIdPrefix="ir-pdf-thumbnail" /></div></div>
        </> : null}
      </Dialog>
    </section>
  );
}
