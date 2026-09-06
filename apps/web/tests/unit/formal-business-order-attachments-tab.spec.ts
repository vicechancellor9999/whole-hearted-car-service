import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const component = (relative: string) => readFileSync(path.join(process.cwd(), "src/components", relative), "utf8");

test("Business Order exposes attachments as a dedicated fifth workspace", () => {
  const tabs = component("orders/formal-business-order-tabs.tsx");
  const detail = component("orders/formal-business-order-detail.tsx");
  expect(tabs).toContain('| "attachments"');
  expect(tabs).toContain('id: "attachments"');
  expect(tabs).toContain('labelZh: "业务附件"');
  expect(detail).toContain('id="business-order-attachments-workspace"');
  expect(detail).toContain("FormalBusinessOrderAttachmentsWorkspace");
});

test("document preview no longer duplicates the attachment center", () => {
  const documents = component("orders/formal-business-order-documents-workspace.tsx");
  const attachments = component("orders/formal-business-order-attachments-workspace.tsx");
  expect(documents).not.toContain("Business attachments");
  expect(documents).not.toContain("业务附件");
  expect(attachments).toContain("Business attachments");
  expect(attachments).toContain("业务附件");
  expect(attachments).toContain("onDrop");
  expect(attachments).toContain("onPaste");
});

test("Business Order attachments expose a standard camera and document-camera capture entry", () => {
  const attachments = component("orders/formal-business-order-attachments-workspace.tsx");
  expect(attachments).toContain("documentCameraConstraints");
  expect(attachments).toContain("captureVehicleDocumentFrame");
  expect(attachments).toContain("navigator.mediaDevices?.getUserMedia");
  expect(attachments).toContain('data-testid="business-order-camera-open"');
  expect(attachments).toContain('data-testid="business-order-camera-preview"');
  expect(attachments).toContain('data-testid="business-order-camera-capture"');
  expect(attachments).toContain('data-testid="business-order-camera-close"');
});
