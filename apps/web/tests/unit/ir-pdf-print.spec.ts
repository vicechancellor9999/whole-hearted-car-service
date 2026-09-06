import { expect, test } from "@playwright/test";
import { printPdfBytes, type PdfPrintDependencies, type PdfPrintSurface } from "../../src/lib/orders/ir-pdf-print";

const attachment = {
  metadata: { id: "selected-en-r7", language: "en" as const, fileName: "customer-en-r7.pdf" },
  bytes: Uint8Array.from([37, 80, 68, 70, 255]),
};

function harness(options: { unsupported?: boolean; renderError?: boolean } = {}) {
  const calls: string[] = [];
  const events = { beforeprint: new Set<() => void>(), afterprint: new Set<() => void>() };
  let input: Uint8Array | undefined;
  let timeout: (() => void) | undefined;
  const surface: PdfPrintSurface = {
    focus: () => { calls.push("focus"); },
    print: () => { calls.push("print"); if (!options.unsupported) for (const fn of events.beforeprint) fn(); },
    dispose: () => { calls.push("dispose"); },
    addEventListener: (type, fn) => { events[type].add(fn); },
    removeEventListener: (type, fn) => { events[type].delete(fn); },
  };
  const dependencies: PdfPrintDependencies = {
    prepare: async (bytes) => { input = bytes; if (options.renderError) throw new Error("PDF 损坏"); calls.push("rendered-all-pages"); return surface; },
    setTimeout: (fn) => { timeout = fn; return 1; },
    clearTimeout: () => {},
  };
  return { calls, dependencies, get input() { return input; }, finish: () => { for (const fn of [...events.afterprint]) fn(); }, timeout: () => timeout?.() };
}

test("prints all pages of the exact selected PDF, keeping the surface until afterprint", async () => {
  const h = harness();
  await expect(printPdfBytes(attachment, h.dependencies)).resolves.toEqual({
    attachmentId: attachment.metadata.id, language: attachment.metadata.language, fileName: attachment.metadata.fileName,
  });
  expect(h.input).toEqual(attachment.bytes);
  expect(h.input).not.toBe(attachment.bytes);
  expect(h.calls).toEqual(["rendered-all-pages", "focus", "print"]);
  h.finish();
  expect(h.calls).toEqual(["rendered-all-pages", "focus", "print", "dispose"]);
});

test("aborting while the PDF surface is preparing never opens native print", async () => {
  const h = harness();
  const controller = new AbortController();
  let ready!: (value: PdfPrintSurface) => void;
  const surface = await h.dependencies.prepare(attachment.bytes, attachment.metadata.fileName);
  const result = printPdfBytes(attachment, { ...h.dependencies, prepare: () => new Promise((resolve) => { ready = resolve; }) }, controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); ready(surface);
  await rejected;
  expect(h.calls).not.toContain("print");
  expect(h.calls).toContain("dispose");
});

test("unsupported native printing has an actionable error rather than false success", async () => {
  const h = harness({ unsupported: true });
  const pending = printPdfBytes(attachment, h.dependencies);
  await Promise.resolve();
  h.timeout();
  await expect(pending).rejects.toThrow("下载 PDF");
  expect(h.calls).toContain("dispose");
});

test("render failure never calls print or mutates the selected PDF", async () => {
  const h = harness({ renderError: true });
  await expect(printPdfBytes(attachment, h.dependencies)).rejects.toThrow("PDF 损坏");
  expect(h.calls).not.toContain("print");
  expect(attachment.bytes).toEqual(Uint8Array.from([37, 80, 68, 70, 255]));
});
