import type { IrPdfLanguage } from "./ir-pdf";

export interface PdfPrintAttachment {
  readonly metadata: { readonly id: string; readonly language: IrPdfLanguage; readonly fileName: string };
  readonly bytes: Uint8Array;
}
export interface PdfPrintSurface {
  focus(): void;
  print(): void;
  dispose(): void;
  addEventListener(type: "beforeprint" | "afterprint", listener: () => void): void;
  removeEventListener(type: "beforeprint" | "afterprint", listener: () => void): void;
}
export interface PdfPrintDependencies {
  readonly prepare: (bytes: Uint8Array, fileName: string) => Promise<PdfPrintSurface>;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}
export interface PdfPrintResult {
  readonly attachmentId: string;
  readonly language: IrPdfLanguage;
  readonly fileName: string;
}

let releasePreviousSurface: (() => void) | undefined;

/** Render the saved PDF itself, not a second HTML rendition of business data.
 * A dedicated print-only surface avoids popup and embedded PDF viewer races.
 * 300 DPI canvases retain print clarity independently of preview zoom.
 */
async function preparePdfPrintSurface(bytes: Uint8Array, fileName: string): Promise<PdfPrintSurface> {
  releasePreviousSurface?.();
  const doc = document;
  const originalTitle = doc.title;
  const surface = doc.createElement("div");
  surface.id = "wh-pdf-print-surface";
  surface.setAttribute("aria-hidden", "true");
  surface.style.display = "none";
  doc.body.append(surface);
  const style = doc.createElement("style");
  const dispose = () => {
    surface.remove();
    style.remove();
    if (doc.title === fileName) doc.title = originalTitle;
    if (releasePreviousSurface === dispose) releasePreviousSurface = undefined;
  };
  releasePreviousSurface = dispose;
  style.textContent = "@media print{@page{size:A4;margin:0}html,body{margin:0!important;padding:0!important;width:auto!important;height:auto!important;overflow:visible!important;background:white!important}body>*:not(#wh-pdf-print-surface){display:none!important}#wh-pdf-print-surface{display:block!important;position:static!important;margin:0!important;padding:0!important}#wh-pdf-print-surface canvas{display:block!important;width:210mm!important;height:297mm!important;max-width:none!important;break-after:page;page-break-after:always;print-color-adjust:exact;-webkit-print-color-adjust:exact}#wh-pdf-print-surface canvas:last-child{break-after:auto;page-break-after:auto}}";
  doc.head.append(style);
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({ data: bytes });
    try {
      const pdf = await task.promise;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 300 / 72 });
        const canvas = doc.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.dataset.printPage = String(pageNumber);
        surface.append(canvas);
        await page.render({ canvas, viewport }).promise;
        page.cleanup();
      }
      surface.dataset.printPageCount = String(pdf.numPages);
    } finally {
      await task.destroy();
    }
    // Finish rendering before asking the native print implementation.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      focus: () => window.focus(),
      print: () => { doc.title = fileName; window.print(); },
      dispose,
      addEventListener: (type, fn) => window.addEventListener(type, fn),
      removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Resolves when the browser enters printing, not when paper has been printed.
 * Cancel and success both clean up on afterprint; unsupported hosts fail visibly.
 */
export async function printPdfBytes(
  file: PdfPrintAttachment,
  dependencies: PdfPrintDependencies = {
    prepare: preparePdfPrintSurface,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  },
  signal?: AbortSignal,
): Promise<PdfPrintResult> {
  signal?.throwIfAborted();
  const surface = await dependencies.prepare(file.bytes.slice(), file.metadata.fileName);
  if (signal?.aborted) { surface.dispose(); signal.throwIfAborted(); }
  return new Promise((resolve, reject) => {
    let enteredPrint = false;
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      surface.removeEventListener("beforeprint", beforePrint);
      surface.removeEventListener("afterprint", cleanup);
      signal?.removeEventListener("abort", abort);
      if (timeout !== undefined) dependencies.clearTimeout(timeout);
      surface.dispose();
    };
    const abort = () => { cleanup(); reject(new DOMException("Print cancelled", "AbortError")); };
    const beforePrint = () => {
      enteredPrint = true;
      if (timeout !== undefined) dependencies.clearTimeout(timeout);
      resolve({ attachmentId: file.metadata.id, language: file.metadata.language, fileName: file.metadata.fileName });
    };
    surface.addEventListener("beforeprint", beforePrint);
    surface.addEventListener("afterprint", cleanup);
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = dependencies.setTimeout(() => {
      if (enteredPrint) return;
      cleanup();
      reject(new Error("当前浏览器未启动系统打印。请下载 PDF 用本机阅读器打印，或在 Safari / Chrome 打开系统后重试。"));
    }, 3000);
    try {
      surface.focus();
      surface.print();
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error("无法调用系统打印，请下载 PDF 后打印。"));
    }
  });
}
