let releasePreviousPrint: (() => void) | undefined;

/** Print a snapshot outside the application scroll containers. Resolving means
 * the host entered print mode, not that a printer produced paper. */
export function printInspectionSheet(sheet: HTMLElement, fileName: string, signal?: AbortSignal): Promise<void> {
  releasePreviousPrint?.();
  if (signal?.aborted) return Promise.reject(new DOMException("Print cancelled", "AbortError"));
  const doc = sheet.ownerDocument;
  const host = doc.defaultView;
  if (!host || !sheet.isConnected) return Promise.reject(new Error("报告预览尚未准备好，请重新打开正式报告后重试。"));
  const originalTitle = doc.title;
  const surface = sheet.cloneNode(true) as HTMLElement;
  surface.id = "wh-inspection-html-print-surface";
  surface.style.zoom = "1";
  surface.style.display = "none";
  surface.setAttribute("aria-hidden", "true");
  const style = doc.createElement("style");
  style.textContent = `@media print {
    @page { size: A4; margin: 12mm; }
    html, body { width: auto !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; background: white !important; }
    body > *:not(#wh-inspection-html-print-surface) { display: none !important; }
    #wh-inspection-html-print-surface { display: block !important; position: static !important; width: 186mm !important; max-width: none !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; zoom: 1 !important; box-shadow: none !important; }
    #wh-inspection-html-print-surface, #wh-inspection-html-print-surface * { visibility: visible !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    #wh-inspection-html-print-surface thead { display: table-header-group; }
    #wh-inspection-html-print-surface tr { break-inside: avoid; }
    #wh-inspection-html-print-surface h3 { break-after: avoid; }
  }`;
  doc.head.append(style);
  doc.body.append(surface);
  return new Promise((resolve, reject) => {
    let entered = false;
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      host.removeEventListener("beforeprint", beforePrint);
      host.removeEventListener("afterprint", afterPrint);
      signal?.removeEventListener("abort", cancel);
      if (timer !== undefined) host.clearTimeout(timer);
      surface.remove();
      style.remove();
      if (doc.title === fileName) doc.title = originalTitle;
      if (releasePreviousPrint === cancel) releasePreviousPrint = undefined;
    };
    const beforePrint = () => {
      entered = true;
      if (timer !== undefined) host.clearTimeout(timer);
      resolve();
    };
    const afterPrint = () => {
      cleanup();
      if (!entered) reject(new Error("浏览器未确认打印启动，请重新尝试系统打印。"));
    };
    const cancel = () => {
      cleanup();
      reject(new DOMException("Print cancelled", "AbortError"));
    };
    releasePreviousPrint = cancel;
    host.addEventListener("beforeprint", beforePrint);
    host.addEventListener("afterprint", afterPrint);
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = host.setTimeout(() => {
      cleanup();
      reject(new Error("当前浏览器未启动系统打印。可再次点击打印；若仍无响应，请在 Safari / Chrome 打开同一报告后打印或存 PDF。"));
    }, 3000);
    try {
      doc.title = fileName;
      host.print();
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error("无法调用系统打印，请重试。"));
    }
  });
}
