import type { IrPdfLanguage } from "./ir-pdf";

export interface PdfPrintAttachment {
  readonly metadata: {
    readonly id: string;
    readonly language: IrPdfLanguage;
    readonly fileName: string;
  };
  readonly bytes: Uint8Array;
}

export interface PdfPrintWindow {
  focus(): void;
  print(): void;
  close(): void;
  addEventListener(type: "load" | "error", listener: () => void): void;
  removeEventListener(type: "load" | "error", listener: () => void): void;
}

export interface PdfPrintDependencies {
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly openWindow: (url: string, target: "_blank") => PdfPrintWindow | null;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly loadTimeoutMs?: number;
}

export interface PdfPrintResult {
  readonly attachmentId: string;
  readonly language: IrPdfLanguage;
  readonly fileName: string;
}

const DEFAULT_LOAD_TIMEOUT_MS = 15_000;

function defaultDependencies(): PdfPrintDependencies {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    openWindow: (url, target) => {
      const opened = window.open(url, target);
      if (opened) {
        try {
          opened.opener = null;
        } catch {
          // Some native PDF viewers expose a restricted WindowProxy. Printing
          // remains safe because the object URL contains no application HTML.
        }
      }
      return opened;
    },
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

function pdfBlobFromExactBytes(bytes: Uint8Array): Blob {
  const copiedBytes = new Uint8Array(bytes.byteLength);
  copiedBytes.set(bytes);
  return new Blob([copiedBytes.buffer], { type: "application/pdf" });
}

/**
 * Opens the selected generated attachment in a dedicated PDF browsing context
 * and invokes the browser print dialog only after that context has loaded.
 */
export function printPdfBytes(
  file: PdfPrintAttachment,
  dependencies: PdfPrintDependencies = defaultDependencies(),
): Promise<PdfPrintResult> {
  const objectUrl = dependencies.createObjectURL(pdfBlobFromExactBytes(file.bytes));
  const printWindow = dependencies.openWindow(objectUrl, "_blank");

  if (!printWindow) {
    dependencies.revokeObjectURL(objectUrl);
    return Promise.reject(new Error("浏览器阻止了打印窗口，请允许弹出窗口后重试。"));
  }
  const activePrintWindow: PdfPrintWindow = printWindow;

  return new Promise<PdfPrintResult>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: unknown;

    const cleanup = () => {
      activePrintWindow.removeEventListener("load", handleLoad);
      activePrintWindow.removeEventListener("error", handleLoadError);
      if (timeoutHandle !== undefined) dependencies.clearTimeout(timeoutHandle);
      try {
        activePrintWindow.close();
      } finally {
        dependencies.revokeObjectURL(objectUrl);
      }
    };

    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    function handleLoad() {
      if (settled) return;
      settled = true;
      try {
        activePrintWindow.focus();
        activePrintWindow.print();
        cleanup();
        resolve({
          attachmentId: file.metadata.id,
          language: file.metadata.language,
          fileName: file.metadata.fileName,
        });
      } catch (caught) {
        settled = false;
        finishWithError(caught instanceof Error ? caught : new Error("无法调用浏览器打印功能。"));
      }
    }

    function handleLoadError() {
      finishWithError(new Error("PDF 打印窗口加载失败，请重试。"));
    }

    activePrintWindow.addEventListener("load", handleLoad);
    activePrintWindow.addEventListener("error", handleLoadError);
    timeoutHandle = dependencies.setTimeout(
      () => finishWithError(new Error("PDF 打印窗口加载超时，请重试。")),
      dependencies.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS,
    );
  });
}
