import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { PdfCanvasPreview } from "../../src/components/orders/pdf-canvas-preview";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => { throw new Error("Invalid PDF structure"); },
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reports malformed PDF data to the workspace recovery flow", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const onError = vi.fn();
  render(<PdfCanvasPreview bytes={new Uint8Array([1, 2, 3])} onError={onError} />);
  await waitFor(() => expect(onError).toHaveBeenCalledWith("Invalid PDF structure"));
});
