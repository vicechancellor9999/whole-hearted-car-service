"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./pdf-reader.module.css";
import { loadPdfJs } from "../../lib/orders/pdfjs-loader";

// copyLabels is an explicit contract for identical, consecutive copies. Unlike
// pageLabels it names whole copies, each of which may span multiple pages.
function pageGroups(count: number, copyLabels?: readonly string[], pageLabels?: readonly string[]) {
  if (copyLabels?.length && count >= copyLabels.length && count % copyLabels.length === 0) {
    const size = count / copyLabels.length;
    return copyLabels.map((label, index) => ({ label, start: index * size + 1, end: (index + 1) * size }));
  }
  return Array.from({ length: count }, (_, index) => ({ label: pageLabels?.length === count ? pageLabels[index] : "", start: index + 1, end: index + 1 }));
}

function groupPageLabel(groups: ReturnType<typeof pageGroups>, page: number) {
  return groups.find((group) => page >= group.start && page <= group.end)?.label ?? "";
}

export function resolvePdfCanvasOutputScale(devicePixelRatio: number) {
  return Math.min(3, Math.max(2, devicePixelRatio || 1));
}

export function shouldConstrainPdfWidth(zoomMode: "fit" | "manual", showZoomControls: boolean, allowHorizontalOverflow: boolean) {
  return zoomMode === "fit" || (!showZoomControls && !allowHorizontalOverflow);
}

function configureCanvasForDisplay(
  canvas: HTMLCanvasElement,
  viewport: { width: number; height: number },
) {
  const outputScale = resolvePdfCanvasOutputScale(window.devicePixelRatio);
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
        const pdfjs = await loadPdfJs();
        const task = pdfjs.getDocument({ data: bytes.slice() });
        const pdf = await task.promise;
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvasRef.current) { await task.destroy(); return; }
        const viewport = page.getViewport({ scale: 0.16 });
        const canvas = canvasRef.current;
        const { transform } = configureCanvasForDisplay(canvas, viewport);
        await page.render({ canvas, viewport, transform: [...transform] }).promise;
        await task.destroy();
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
  fillHeight = false,
  compactToolbar = false,
  continuousPages = false,
  pageLabels,
  copyLabels,
  onError,
}: {
  bytes: Uint8Array;
  dataTestId?: string;
  scale?: number;
  allowHorizontalOverflow?: boolean;
  thumbnailTestIdPrefix?: string;
  fitWidth?: boolean;
  showZoomControls?: boolean;
  fillHeight?: boolean;
  compactToolbar?: boolean;
  continuousPages?: boolean;
  pageLabels?: readonly string[];
  copyLabels?: readonly string[];
  onError?: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [zoomMode, setZoomMode] = useState<"fit" | "manual">(fitWidth ? "fit" : "manual");
  const [zoomPercent, setZoomPercent] = useState(Math.round(scale * 100));
  const [fitPercent, setFitPercent] = useState(100);
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [rendering, setRendering] = useState(false);
  const renderedPage = continuousPages ? 1 : currentPage;
  const clampZoom = (value: number) => Math.min(300, Math.max(50, value));

  useEffect(() => {
    if (error) onError?.(error);
  }, [error, onError]);

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
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const task = pdfjs.getDocument({ data: bytes.slice() });
        const pdf = await task.promise;
        if (!cancelled) { setError(null); setPageCount(pdf.numPages); setCurrentPage(1); }
        await task.destroy();
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "预览渲染失败");
      }
    })();
    return () => { cancelled = true; };
  }, [bytes]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const task = pdfjs.getDocument({ data: bytes.slice() });
        const pdf = await task.promise;
        try {
          if (cancelled || !containerRef.current) return;
          setError(null);
          setRendering(true);
          const container = containerRef.current;
          container.replaceChildren();
          const groups = pageGroups(pdf.numPages, copyLabels, pageLabels);
          const pages = continuousPages ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : [Math.min(Math.max(1, renderedPage), pdf.numPages)];
          for (const pageNumber of pages) {
            const page = await pdf.getPage(pageNumber);
            if (cancelled) return;
            const baseViewport = page.getViewport({ scale: 1 });
            const availableWidth = (viewportRef.current?.clientWidth ?? baseViewport.width) - (compactToolbar ? 32 : 0);
            const fitScale = Math.max(0.25, Math.min(compactToolbar ? 1.65 : 2, availableWidth / baseViewport.width));
            const renderScale = fitWidth && zoomMode === "fit" ? fitScale : zoomPercent / 100;
            if (fitWidth && zoomMode === "fit") setFitPercent(Math.round(fitScale * 100));
            const viewport = page.getViewport({ scale: renderScale });
            const canvas = document.createElement("canvas");
            const { transform } = configureCanvasForDisplay(canvas, viewport);
            const constrainWidth = shouldConstrainPdfWidth(zoomMode, showZoomControls, allowHorizontalOverflow);
            canvas.className = `mx-auto block border border-line bg-white dark:border-slate-700 ${compactToolbar ? styles.paper : "rounded-lg"}${constrainWidth ? " max-w-full" : ""}`;
            canvas.setAttribute("data-testid", dataTestId);
            canvas.setAttribute("data-page", String(pageNumber));
            if (continuousPages) {
              const section = document.createElement("section");
              section.dataset.pdfPage = String(pageNumber);
              section.className = styles.pageSection;
              section.style.width = `${viewport.width}px`;
              if (constrainWidth) section.style.maxWidth = "100%";
              const heading = document.createElement("h3");
              const label = groupPageLabel(groups, pageNumber);
              heading.textContent = `${label ? label + " · " : ""}第 ${pageNumber} / ${pdf.numPages} 页`;
              heading.className = styles.pageHeading;
              section.append(heading, canvas);
              container.append(section);
            } else container.append(canvas);
            await page.render({ canvas, viewport, transform: [...transform] }).promise;
          }
          // Resizing or zooming replaces the canvases; keep the reader on the
          // same copy instead of leaving its page indicator ahead of the view.
          if (continuousPages && !cancelled) {
            const viewport = viewportRef.current;
            const section = container.querySelector<HTMLElement>(`[data-pdf-page="${currentPageRef.current}"]`);
            if (viewport && section) viewport.scrollTo({ top: viewport.scrollTop + section.getBoundingClientRect().top - viewport.getBoundingClientRect().top, behavior: "instant" });
          }
        } finally {
          await task.destroy();
          if (!cancelled) setRendering(false);
        }
      } catch (caught) {
        console.error("[pdf-preview]", caught);
        if (!cancelled) setError(caught instanceof Error ? caught.message : "预览渲染失败");
      }
    })();
    return () => { cancelled = true; };
  }, [allowHorizontalOverflow, bytes, compactToolbar, continuousPages, renderedPage, pageLabels, copyLabels, dataTestId, fitWidth, showZoomControls, viewportWidth, zoomMode, zoomPercent]);

  const selectPage = (pageNumber: number) => {
    const nextPage = Math.min(pageCount, Math.max(1, pageNumber));
    setCurrentPage(nextPage);
    if (!continuousPages) return;
    const viewport = viewportRef.current;
    const section = containerRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${nextPage}"]`);
    if (viewport && section) viewport.scrollTo({ top: viewport.scrollTop + section.getBoundingClientRect().top - viewport.getBoundingClientRect().top, behavior: "instant" });
  };
  const trackVisiblePage = () => {
    if (!continuousPages || rendering || !viewportRef.current) return;
    const top = viewportRef.current.getBoundingClientRect().top + 80;
    const sections = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-pdf-page]") ?? []);
    const visible = sections.find((section) => section.getBoundingClientRect().bottom > top);
    if (visible) setCurrentPage(Number(visible.dataset.pdfPage));
  };

  const displayedPercent = zoomMode === "fit" ? fitPercent : zoomPercent;
  const groups = pageGroups(pageCount, copyLabels, pageLabels);
  const hasContinuationPages = groups.some((group) => group.end > group.start);
  const copyPageMismatch = Boolean(copyLabels?.length && pageCount && (pageCount < copyLabels.length || pageCount % copyLabels.length));
  const changeZoom = (delta: number) => {
    setZoomPercent(clampZoom(displayedPercent + delta));
    setZoomMode("manual");
  };

  return (
    <div className={compactToolbar ? styles.reader : fillHeight ? "flex h-full min-h-0 min-w-0 flex-col bg-slate-200 dark:bg-slate-900" : "mt-3 min-w-0 rounded-xl border border-line bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"} data-testid="pdf-canvas-preview">
      {continuousPages && pageCount > 0 ? <div className={styles.copyNavigation}>
        <span>{`共 ${pageCount} 页 · 连续预览`}</span>
        <nav aria-label="单据联次">{groups.map((group) => {
          const range = group.start === group.end ? String(group.start) : `${group.start}–${group.end}`;
          return <button type="button" key={group.start} aria-current={currentPage >= group.start && currentPage <= group.end ? "page" : undefined} aria-label={`${group.label ? group.label + " · " : ""}第 ${range} 页`} onClick={() => selectPage(group.start)}>{group.label || `第 ${range} 页`}{group.end > group.start ? <span className={styles.copyRange}>第 {range} 页</span> : null}</button>;
        })}</nav>
        {hasContinuationPages ? <select className={styles.pageSelect} aria-label="选择页面" value={currentPage} onChange={(event) => selectPage(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index} value={index + 1}>{groupPageLabel(groups, index + 1)} · 第 {index + 1} / {pageCount} 页</option>)}</select> : null}
        {copyPageMismatch ? <p role="alert">页数与成套联别不符，请逐页核对；可返回单据历史选择其他版本。</p> : null}
        {rendering ? <span role="status">加载页面…</span> : null}
      </div> : null}
      {pageCount > 0 && (!fillHeight || showThumbnails) ? (
        <div data-testid={`${thumbnailTestIdPrefix}-list`} className="mb-2 flex max-h-44 max-w-full shrink-0 gap-2 overflow-auto p-2">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <PdfPageThumbnail
              key={pageNumber}
              bytes={bytes}
              pageNumber={pageNumber}
              current={currentPage === pageNumber}
              onSelect={() => selectPage(pageNumber)}
              dataTestId={`${thumbnailTestIdPrefix}-${pageNumber}`}
            />
          ))}
        </div>
      ) : null}
      {pageCount > 1 && !compactToolbar ? (
        <div className="mb-2 flex items-center justify-center gap-3 text-xs">
          <button type="button" data-testid="pdf-preview-prev" disabled={currentPage <= 1} onClick={() => setCurrentPage((value) => Math.max(1, value - 1))} className="min-h-11 rounded-lg border border-line px-3 font-semibold disabled:opacity-40 dark:border-slate-600">← 上一页</button>
          <span data-testid="pdf-preview-pager">{currentPage} / {pageCount}</span>
          <button type="button" data-testid="pdf-preview-next" disabled={currentPage >= pageCount} onClick={() => setCurrentPage((value) => Math.min(pageCount, value + 1))} className="min-h-11 rounded-lg border border-line px-3 font-semibold disabled:opacity-40 dark:border-slate-600">下一页 →</button>
        </div>
      ) : null}
      {showZoomControls && !compactToolbar ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-b border-line bg-card p-1.5 text-xs">{fillHeight ? <span className="mr-auto hidden pl-1 sm:inline">第 {currentPage} / {pageCount || "…"} 页{pageCount > 1 ? <button type="button" aria-expanded={showThumbnails} onClick={() => setShowThumbnails(!showThumbnails)} className="ml-2 min-h-11 px-2 underline">{showThumbnails ? "收起缩略图" : "选择页面"}</button> : null}</span> : null}<button type="button" aria-label="缩小 PDF" onClick={() => changeZoom(-10)} className="grid h-11 w-11 place-items-center rounded-lg border border-line bg-layer-2 text-base font-bold">−</button><span className="min-w-10 text-center font-semibold tabular-nums">{displayedPercent}%</span><button type="button" aria-label="放大 PDF" onClick={() => changeZoom(10)} className="grid h-11 w-11 place-items-center rounded-lg border border-line bg-layer-2 text-base font-bold">+</button><button type="button" onClick={() => setZoomMode("fit")} className={`min-h-11 rounded-lg border px-3 font-semibold ${zoomMode === "fit" ? "border-primary bg-primary-50 text-primary" : "border-line bg-layer-2"}`}>适合宽度</button><button type="button" onClick={() => { setZoomPercent(100); setZoomMode("manual"); }} className={`min-h-11 rounded-lg border px-3 font-semibold ${zoomMode === "manual" && zoomPercent === 100 ? "border-primary bg-primary-50 text-primary" : "border-line bg-layer-2"}`}>100%</button></div> : null}
      <div ref={viewportRef} onScroll={trackVisiblePage} tabIndex={0} aria-label="单据页面，可滚动查看" aria-busy={rendering} className={fillHeight ? "min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain" : "min-w-0 overflow-auto"}><div ref={containerRef} className={fillHeight ? "w-max min-w-full py-3" : "min-w-0"} /></div>
      {compactToolbar ? <div className={styles.controls} aria-label="阅读工具">
        <div className={styles.controlGroup}>
          <button type="button" aria-label="上一页" data-testid="pdf-preview-prev" disabled={currentPage <= 1} onClick={() => selectPage(currentPage - 1)}>←</button>
          {continuousPages ? <span data-testid="pdf-preview-pager" className={styles.pageNumber}>{currentPage} / {pageCount || "…"}</span> : <button type="button" aria-label="选择页面" aria-expanded={showThumbnails} onClick={() => setShowThumbnails((value) => !value)} data-testid="pdf-preview-pager" className={styles.pageNumber}>{currentPage} / {pageCount || "…"}</button>}
          <button type="button" aria-label="下一页" data-testid="pdf-preview-next" disabled={currentPage >= pageCount} onClick={() => selectPage(currentPage + 1)}>→</button>
        </div>
        <div className={styles.controlGroup}>
          <button type="button" aria-label="缩小 PDF" onClick={() => changeZoom(-10)}>−</button>
          <select aria-label="预览比例" value={zoomMode === "fit" ? "fit" : String(zoomPercent)} onChange={(event) => { if (event.target.value === "fit") setZoomMode("fit"); else { setZoomPercent(Number(event.target.value)); setZoomMode("manual"); } }}>
            <option value="fit">适合宽度</option>
            {[...new Set([75, 100, 125, 150, 200, 250, 300, zoomPercent])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value}%</option>)}
          </select>
          <button type="button" aria-label="放大 PDF" onClick={() => changeZoom(10)}>+</button>
        </div>
      </div> : null}
      {error ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}
    </div>
  );
}
