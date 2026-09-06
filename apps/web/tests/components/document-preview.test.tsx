import { describe, expect, it } from "vitest";
import { shouldConstrainPdfWidth, resolvePdfCanvasOutputScale } from "../../src/components/orders/pdf-canvas-preview";

describe("document magnification", () => {
  it("lets manual zoom exceed available width and returns to constrained fit mode", () => {
    expect(shouldConstrainPdfWidth("manual", true, false)).toBe(false);
    expect(shouldConstrainPdfWidth("fit", true, false)).toBe(true);
    expect(shouldConstrainPdfWidth("manual", false, false)).toBe(true);
    expect(shouldConstrainPdfWidth("manual", false, true)).toBe(false);
  });
  it("keeps zoomed-out text sharp without unlimited canvas allocation", () => {
    expect(resolvePdfCanvasOutputScale(0.55)).toBe(2);
    expect(resolvePdfCanvasOutputScale(4)).toBe(3);
  });
});
