"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormalInspectionReportDetail } from "@/lib/api/formal-inspections";
import type { InspectionDocumentLanguage } from "@/lib/orders/formal-inspection-document";
import { createFormalInspectionPdf } from "@/lib/orders/formal-inspection-pdf-download";
import { PdfCanvasPreview } from "./pdf-canvas-preview";
import { printPdfBytes } from "@/lib/orders/ir-pdf-print";

type Props = { detail: FormalInspectionReportDetail; language: InspectionDocumentLanguage; english: boolean; onReadyChange?: (ready: boolean) => void };
export function InspectionPdfDownload(props: Props) {
  // A refreshed source or different language must not expose the preceding file.
  const sourceKey = useMemo(() => JSON.stringify([props.language, props.detail]), [props.language, props.detail]);
  return <DownloadSession key={sourceKey} {...props} />;
}

function DownloadSession({ detail, language, english, onReadyChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewVersion, setPreviewVersion] = useState(0);
  const [printing, setPrinting] = useState(false);
  const printController = useRef<AbortController | null>(null);
  const controller = useRef<AbortController | null>(null);
  const fileUrl = useRef("");
  useEffect(() => { onReadyChange?.(Boolean(bytes)); return () => onReadyChange?.(false); }, [bytes, onReadyChange]);
  useEffect(() => () => { controller.current?.abort(); printController.current?.abort(); if (fileUrl.current) URL.revokeObjectURL(fileUrl.current); }, []);
  const fileName = `${detail.report.reportNo}-${language === "bilingual" ? "BI" : language.toUpperCase()}.pdf`;
  const generate = async () => {
    if (controller.current || fileUrl.current) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
    try {
      const blob = await createFormalInspectionPdf(detail, language, request.signal);
      const content = new Uint8Array(await blob.arrayBuffer());
      if (request.signal.aborted) return;
      fileUrl.current = URL.createObjectURL(blob); setUrl(fileUrl.current); setBytes(content);
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : (english ? "PDF generation failed. Please retry." : "PDF 生成失败，请重试。"));
    } finally {
      if (!request.signal.aborted) { controller.current = null; setBusy(false); }
    }
  };
  const print = async () => {
    if (!bytes || printController.current) return;
    const request = new AbortController(); printController.current = request; setPrinting(true); setError("");
    try { await printPdfBytes({ bytes, metadata: { id: fileName, fileName, language } }, undefined, request.signal); }
    catch (failure) { if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : (english ? "Printing failed. Download the PDF to continue." : "打印失败，可下载 PDF 后继续。")); }
    finally { if (!request.signal.aborted) { printController.current = null; setPrinting(false); } }
  };
  return <div className="w-full min-w-0">
    <div className="flex max-w-full flex-wrap items-center gap-2">
    {url ? <a href={url} download={fileName} className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-xs font-bold text-white">{english ? "Download PDF" : "下载 PDF"}</a>
      : <button type="button" disabled={busy} onClick={() => void generate()} className="min-h-11 rounded-xl border border-primary px-4 text-xs font-bold text-primary disabled:opacity-50">{busy ? (english ? "Generating PDF…" : "正在生成 PDF…") : (english ? "Generate PDF file" : "生成 PDF 文件")}</button>}
    {busy ? <button type="button" onClick={() => { controller.current?.abort(); controller.current = null; setBusy(false); }} className="min-h-11 rounded-xl border border-line px-3 text-xs">{english ? "Cancel" : "取消生成"}</button> : null}
    {error ? <p role="alert" className="max-w-sm text-xs text-state-danger-text">{error}</p> : null}
    {bytes ? <button type="button" disabled={printing} onClick={() => void print()} className="min-h-11 rounded-xl border border-primary px-4 text-xs font-bold text-primary disabled:opacity-50">{printing ? (english ? "Opening print…" : "正在启动打印…") : (english ? "Print this PDF" : "打印此 PDF")}</button> : null}
    </div>
    {bytes ? <section className="mt-3 min-w-0" aria-label={english ? "Download file preview" : "下载文件预览"}>
      <p className="mb-2 break-all text-xs text-ink-soft">{fileName} · {english ? "Preview, download and print use this same file." : "预览、下载和打印使用同一份文件。"}</p>
      {previewError ? <div className="mb-2 flex flex-wrap items-center gap-2"><p role="alert" className="text-xs text-state-danger-text">{previewError}</p><button type="button" onClick={() => { setPreviewError(""); setPreviewVersion((value) => value + 1); }} className="min-h-11 rounded-xl border border-line px-3 text-xs">{english ? "Reload preview" : "重新加载预览"}</button></div> : null}
      <div className="h-[72dvh] min-h-80 min-w-0 overflow-hidden rounded-xl border border-line"><PdfCanvasPreview key={previewVersion} bytes={bytes} fitWidth showZoomControls fillHeight compactToolbar dataTestId="inspection-download-pdf-canvas" onError={setPreviewError} /></div>
    </section> : null}
  </div>;
}
