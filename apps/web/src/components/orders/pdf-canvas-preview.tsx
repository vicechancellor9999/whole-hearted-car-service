"use client";

import { useEffect, useRef, useState } from "react";

function configureCanvasForDisplay(
  canvas: HTMLCanvasElement,
  viewport: { width: number; height: number },
) {
  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = "auto";
  return { transform: [outputScale, 0, 0, outputScale, 0, 0] as const };
}

function PdfPageThumbnail({
  bytes,
  pageNumber,
  current,
  onSelect,
  dataTestId,
}: {
  bytes: Uint8Array;
  pageNumber: number;
  current: boolean;
  onSelect: () => void;
  dataTestId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ data: bytes.slice() });
        const pdf = await task.promise;
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale: 0.16 });
        const canvas = canvasRef.current;
        const { transform } = configureCanvasForDisplay(canvas, viewport);
        await page.render({ canvas, viewport, transform: [...transform] }).promise;
      } catch {
        // The main preview owns the visible error state. A missing thumbnail
        // never prevents page navigation through the labeled button.
      }
    })();
    return () => { cancelled = true; };
  }, [bytes, pageNumber]);

  return (
    <button
      type="button"
      data-testid={dataTestId}
      data-page={pageNumber}
      aria-current={current ? "page" : undefined}
      aria-label={`预览第 ${pageNumber} 页`}
      onClick={onSelect}
      className={`shrink-0 rounded-lg border p-1 text-[10px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none ${current ? "border-primary bg-primary-50 text-primary" : "border-line bg-white text-ink-soft hover:border-primary-200 dark:border-slate-600 dark:bg-slate-800"}`}
    >
      <canvas ref={canvasRef} aria-hidden className="block rounded-sm bg-white" />
      <span className="mt-1 block">{pageNumber}</span>
    </button>
  );
}

/** pdf.js canvas preview with real selectable page thumbnails. */
export function PdfCanvasPreview({
  bytes,
  dataTestId = "pdf-canvas",
  scale = 1.35,
  allowHorizontalOverflow = false,
  thumbnailTestIdPrefix = "pdf-preview-thumbnail",
  fitWidth = false,
  showZoomControls = false,
}: {
  bytes: Uint8Array;
  dataTestId?: string;
  scale?: number;
  allowHorizontalOverflow?: boolean;
  thumbnailTestIdPrefix?: string;
  fitWidth?: boolean;
  showZoomControls?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [zoomMode, setZoomMode] = useState<"fit" | "manual">(fitWidth ? "fit" : "manual");
  const [zoomPercent, setZoomPercent] = useState(Math.round(scale * 100));
  const [fitPercent, setFitPercent] = useState(100);
  const clampZoom = (value: number) => Math.min(200, Math.max(50, value));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setViewportWidth(Math.max(1, Math.floor(viewport.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // A different attachment starts at page 1. Page changes themselves must not
  // run this reset or Next/Previous would immediately jump back to page 1.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPageCount(0);
    setCurrentPage(1);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ data: bytes.slice() });
        const pdf = await task.promise;
        if (!cancelled) setPageCount(pdf.numPages);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "预览渲染失败");
      }
    })();
    return () => { cancelled = true; };
  }, [bytes]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ data: bytes.slice() });
        const pdf = await task.promise;
        const pageNumber = Math.min(Math.max(1, currentPage), pdf.numPages);
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.max(0.25, Math.min(2, (viewportRef.current?.clientWidth ?? baseViewport.width) / baseViewport.width));
        const renderScale = fitWidth && zoomMode === "fit" ? fitScale : zoomPercent / 100;
        if (fitWidth && zoomMode === "fit") setFitPercent(Math.round(fitScale * 100));
        const viewport = page.getViewport({ scale: renderScale });
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        const canvas = document.createElement("canvas");
        const { transform } = configureCanvasForDisplay(canvas, viewport);
        const constrainWidth = zoomMode === "fit" || !allowHorizontalOverflow;
        canvas.className = `mx-auto block rounded-lg border border-line bg-white dark:border-slate-700${constrainWidth ? " max-w-full" : ""}`;
        canvas.setAttribute("data-testid", dataTestId);
        canvas.setAttribute("data-page", String(pageNumber));
        container.appendChild(canvas);
        await page.render({ canvas, viewport, transform: [...transform] }).promise;
      } catch (caught) {
        console.error("[pdf-preview]", caught);
        if (!cancelled) setError(caught instanceof Error ? caught.message : "预览渲染失败");
      }
    })();
    return () => { cancelled = true; };
  }, [allowHorizontalOverflow, bytes, currentPage, dataTestId, fitWidth, viewportWidth, zoomMode, zoomPercent]);

  const displayedPercent = zoomMode === "fit" ? fitPercent : zoomPercent;
  const changeZoom = (delta: number) => {
    setZoomPercent(clampZoom(displayedPercent + delta));
    setZoomMode("manual");
  };

  return (
    <div className="mt-3 min-w-0 rounded-xl border border-line bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900" data-testid="pdf-canvas-preview">
      {pageCount > 0 ? (
        <div data-testid={`${thumbnailTestIdPrefix}-list`} className="mb-3 flex max-w-full flex-wrap gap-2 pb-1">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <PdfPageThumbnail
              key={pageNumber}
              bytes={bytes}
              pageNumber={pageNumber}
              current={currentPage === pageNumber}
              onSelect={() => setCurrentPage(pageNumber)}
              dataTestId={`${thumbnailTestIdPrefix}-${pageNumber}`}
            />
          ))}
        </div>
      ) : null}
      {pageCount > 1 ? (
        <div className="mb-2 flex items-center justify-center gap-3 text-xs">
          <button type="button" data-testid="pdf-preview-prev" disabled={currentPage <= 1} onClick={() => setCurrentPage((value) => Math.max(1, value - 1))} className="min-h-8 rounded-lg border border-line px-3 font-semibold disabled:opacity-40 dark:border-slate-600">← 上一页</button>
          <span data-testid="pdf-preview-pager">{currentPage} / {pageCount}</span>
          <button type="button" data-testid="pdf-preview-next" disabled={currentPage >= pageCount} onClick={() => setCurrentPage((value) => Math.min(pageCount, value + 1))} className="min-h-8 rounded-lg border border-line px-3 font-semibold disabled:opacity-40 dark:border-slate-600">下一页 →</button>
        </div>
      ) : null}
      {showZoomControls ? <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5 text-xs"><button type="button" aria-label="缩小 PDF" onClick={() => changeZoom(-10)} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-layer-2 text-base font-bold">−</button><span className="min-w-14 text-center font-semibold tabular-nums">{displayedPercent}%</span><button type="button" aria-label="放大 PDF" onClick={() => changeZoom(10)} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-layer-2 text-base font-bold">+</button><button type="button" onClick={() => setZoomMode("fit")} className={`min-h-8 rounded-lg border px-3 font-semibold ${zoomMode === "fit" ? "border-primary bg-primary-50 text-primary" : "border-line bg-layer-2"}`}>适合宽度</button><button type="button" onClick={() => { setZoomPercent(100); setZoomMode("manual"); }} className={`min-h-8 rounded-lg border px-3 font-semibold ${zoomMode === "manual" && zoomPercent === 100 ? "border-primary bg-primary-50 text-primary" : "border-line bg-layer-2"}`}>100%</button></div> : null}
      <div ref={viewportRef} className="min-w-0 overflow-auto"><div ref={containerRef} className="min-w-0" /></div>
      {error ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}
    </div>
  );
}
