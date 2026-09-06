import { afterEach, expect, it, vi } from "vitest";
import { printPdfBytes } from "../../src/lib/orders/ir-pdf-print";

const rendering = vi.hoisted(() => ({ bytes: undefined as Uint8Array | undefined, pages: [] as number[], destroy: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: ({ data }: { data: Uint8Array }) => {
    rendering.bytes = data;
    return {
      promise: Promise.resolve({ numPages: 2, getPage: async (number: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 595.28 * scale, height: 841.89 * scale }),
        render: () => ({ promise: Promise.resolve().then(() => { rendering.pages.push(number); }) }),
        cleanup: () => {},
      }) }),
      destroy: rendering.destroy,
    };
  },
}));

afterEach(() => { window.dispatchEvent(new Event("afterprint")); vi.restoreAllMocks(); vi.unstubAllGlobals(); rendering.pages.length = 0; });

it("prepares both A4 pages at 300 DPI before native printing and restores the screen after cancellation", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.spyOn(window, "focus").mockImplementation(() => {});
  const oldTitle = document.title;
  const print = vi.spyOn(window, "print").mockImplementation(() => {
    expect(rendering.pages).toEqual([1, 2]);
    const surface = document.getElementById("wh-pdf-print-surface")!;
    expect(surface.dataset.printPageCount).toBe("2");
    expect(surface.style.display).toBe("none");
    const pages = Array.from(surface.querySelectorAll("canvas"));
    expect(pages.map((canvas) => [canvas.width, canvas.height])).toEqual([[2481, 3508], [2481, 3508]]);
    expect(document.head.textContent).toContain("@page{size:A4;margin:0}");
    window.dispatchEvent(new Event("beforeprint"));
  });
  const bytes = new Uint8Array([1, 2, 3]);
  await printPdfBytes({ metadata: { id: "42-en", language: "en", fileName: "CUS-R7-EN.pdf" }, bytes });
  expect(print).toHaveBeenCalledOnce();
  expect(rendering.bytes).toEqual(bytes);
  expect(rendering.bytes).not.toBe(bytes);
  expect(document.title).toBe("CUS-R7-EN.pdf");
  expect(document.getElementById("wh-pdf-print-surface")).not.toBeNull();
  window.dispatchEvent(new Event("afterprint"));
  expect(document.getElementById("wh-pdf-print-surface")).toBeNull();
  expect(document.title).toBe(oldTitle);
});
