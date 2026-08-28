import { expect, test } from "@playwright/test";
import { isEditablePasteTarget, selectSingleDocumentImage } from "../../src/lib/customers/document-image-selection";

const jpeg = (name = "license.jpg", size = 10) => new File([new Uint8Array(size)], name, { type: "image/jpeg" });

test("document image selection accepts one supported image and rejects ambiguous input", () => {
  expect(selectSingleDocumentImage([jpeg()])).toMatchObject({ file: expect.any(File) });
  expect(selectSingleDocumentImage([])).toEqual({ error: "仅支持 JPEG 或 PNG 图片" });
  expect(selectSingleDocumentImage([new File(["x"], "x.gif", { type: "image/gif" })])).toEqual({ error: "仅支持 JPEG 或 PNG 图片" });
  expect(selectSingleDocumentImage([jpeg("a.jpg"), jpeg("b.jpg")])).toEqual({ error: "一次只能添加一张驾驶证正面" });
  expect(selectSingleDocumentImage([jpeg("large.jpg", 12 * 1024 * 1024 + 1)])).toEqual({ error: "图片必须小于 12 MB" });
});

test("paste guard protects text editing targets", () => {
  expect(isEditablePasteTarget({ tagName: "INPUT", isContentEditable: false })).toBe(true);
  expect(isEditablePasteTarget({ tagName: "textarea", isContentEditable: false })).toBe(true);
  expect(isEditablePasteTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  expect(isEditablePasteTarget({ tagName: "BUTTON", isContentEditable: false })).toBe(false);
  expect(isEditablePasteTarget(null)).toBe(false);
});
