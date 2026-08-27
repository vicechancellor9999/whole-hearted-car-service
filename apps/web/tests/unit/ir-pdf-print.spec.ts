import { expect, test } from "@playwright/test";
import {
  printPdfBytes,
  type PdfPrintDependencies,
  type PdfPrintWindow,
} from "../../src/lib/orders/ir-pdf-print";

interface ListenerRegistry {
  load: Set<() => void>;
  error: Set<() => void>;
}

function createPrintHarness(options: { printError?: Error; popupBlocked?: boolean } = {}) {
  const listeners: ListenerRegistry = { load: new Set(), error: new Set() };
  const calls: string[] = [];
  let capturedBlob: Blob | null = null;
  let openedUrl: string | null = null;
  let openedTarget: string | null = null;
  let revokedUrl: string | null = null;

  const popup: PdfPrintWindow = {
    focus() {
      calls.push("focus");
    },
    print() {
      calls.push("print");
      if (options.printError) throw options.printError;
    },
    close() {
      calls.push("close");
    },
    addEventListener(type, listener) {
      listeners[type].add(listener);
    },
    removeEventListener(type, listener) {
      listeners[type].delete(listener);
    },
  };

  const dependencies: PdfPrintDependencies = {
    createObjectURL(blob) {
      capturedBlob = blob;
      return "blob:exact-selected-attachment";
    },
    revokeObjectURL(url) {
      revokedUrl = url;
      calls.push("revoke");
    },
    openWindow(url, target) {
      openedUrl = url;
      openedTarget = target;
      return options.popupBlocked ? null : popup;
    },
    setTimeout() {
      return 17;
    },
    clearTimeout() {
      calls.push("clear-timeout");
    },
    loadTimeoutMs: 5_000,
  };

  return {
    calls,
    dependencies,
    dispatch(type: keyof ListenerRegistry) {
      for (const listener of [...listeners[type]]) listener();
    },
    get capturedBlob() {
      return capturedBlob;
    },
    get openedUrl() {
      return openedUrl;
    },
    get openedTarget() {
      return openedTarget;
    },
    get revokedUrl() {
      return revokedUrl;
    },
  };
}

const selectedAttachment = {
  metadata: {
    id: "ir-file-bilingual-v7",
    language: "bilingual" as const,
    fileName: "inspection-report-bilingual-v7.pdf",
  },
  bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x37, 0x0a, 0x01, 0xff]),
};

test("prints the exact selected attachment bytes only after its PDF window loads", async () => {
  const harness = createPrintHarness();

  const resultPromise = printPdfBytes(selectedAttachment, harness.dependencies);

  expect(harness.openedUrl).toBe("blob:exact-selected-attachment");
  expect(harness.openedTarget).toBe("_blank");
  expect(harness.calls).not.toContain("print");
  expect(harness.capturedBlob?.type).toBe("application/pdf");
  expect(Array.from(new Uint8Array(await harness.capturedBlob!.arrayBuffer()))).toEqual(
    Array.from(selectedAttachment.bytes),
  );

  harness.dispatch("load");

  await expect(resultPromise).resolves.toEqual({
    attachmentId: selectedAttachment.metadata.id,
    language: selectedAttachment.metadata.language,
    fileName: selectedAttachment.metadata.fileName,
  });
  expect(harness.calls).toEqual(["focus", "print", "clear-timeout", "close", "revoke"]);
  expect(harness.revokedUrl).toBe("blob:exact-selected-attachment");
});

test("rejects visibly actionable popup and print failures while cleaning the object URL", async () => {
  const blockedHarness = createPrintHarness({ popupBlocked: true });
  await expect(printPdfBytes(selectedAttachment, blockedHarness.dependencies)).rejects.toThrow(
    "浏览器阻止了打印窗口",
  );
  expect(blockedHarness.revokedUrl).toBe("blob:exact-selected-attachment");

  const printHarness = createPrintHarness({ printError: new Error("native print unavailable") });
  const printPromise = printPdfBytes(selectedAttachment, printHarness.dependencies);
  printHarness.dispatch("load");
  await expect(printPromise).rejects.toThrow("native print unavailable");
  expect(printHarness.calls).toEqual(["focus", "print", "clear-timeout", "close", "revoke"]);
  expect(printHarness.revokedUrl).toBe("blob:exact-selected-attachment");
});
