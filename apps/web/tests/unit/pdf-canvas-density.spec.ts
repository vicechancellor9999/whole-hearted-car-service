import { expect, test } from "@playwright/test";

test("A4 PDF preview keeps at least two backing pixels per CSS pixel on low-density screens", async () => {
  const previewModule = await import("../../src/components/orders/pdf-canvas-preview");
  const resolveOutputScale = (
    previewModule as typeof previewModule & {
      resolvePdfCanvasOutputScale?: (devicePixelRatio: number) => number;
    }
  ).resolvePdfCanvasOutputScale;

  expect(resolveOutputScale).toBeDefined();
  expect(resolveOutputScale?.(1.1)).toBe(2);
  expect(resolveOutputScale?.(2)).toBe(2);
  expect(resolveOutputScale?.(4)).toBe(3);
});
