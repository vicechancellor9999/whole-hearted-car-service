import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DETAIL = "src/components/orders/formal-business-order-detail.tsx";
const DOCUMENTS_WORKSPACE = "src/components/orders/formal-business-order-documents-workspace.tsx";
const PRINT = "src/components/orders/formal-business-order-print.tsx";
const RECEIPT_ROUTE = "src/app/orders/business/[id]/receipt/[paymentId]/print/page.tsx";
const DOCUMENT_ROUTE = "src/app/orders/business/[id]/documents/[documentId]/print/page.tsx";
const REFUND_PRINT = "src/components/orders/formal-refund-acknowledgement-print.tsx";
const REFUND_ROUTE = "src/app/orders/business/[id]/refund/[refundId]/print/page.tsx";
const PDF_CANVAS_PREVIEW = "src/components/orders/pdf-canvas-preview.tsx";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("formal Business Order exposes each Receipt and immutable print document", () => {
  expect(existsSync(resolve(process.cwd(), PRINT))).toBe(true);
  expect(existsSync(resolve(process.cwd(), DOCUMENT_ROUTE))).toBe(true);
  expect(source(RECEIPT_ROUTE)).toMatch(/FormalReceiptPrintSheet/);
  expect(source(DOCUMENT_ROUTE)).toMatch(/FormalBusinessOrderDocumentPrintSheet/);
  // Generation grouping and language selection are exercised through the real
  // workspace in tests/components/document-selection.test.tsx.
  expect(source(DETAIL)).toMatch(/english \? "Receipt: " : "Receipt："/);
  expect(source(DETAIL)).toMatch(/\{transaction\.referenceNo\}/);
  expect(source(DOCUMENTS_WORKSPACE)).toMatch(/系统打印/);
  expect(source(DOCUMENTS_WORKSPACE)).toMatch(/下载 PDF/);
  expect(source(DOCUMENTS_WORKSPACE)).toMatch(/PdfCanvasPreview/);
  expect(source(DOCUMENTS_WORKSPACE)).toMatch(/printPdfBytes/);
});

test("PDF canvas preview keeps zoom controls without enlarging its CSS size", () => {
  const preview = source(PDF_CANVAS_PREVIEW);
  expect(preview).toMatch(/canvas\.width = Math\.floor\(viewport\.width \* outputScale\)/);
  expect(preview).toMatch(/canvas\.style\.width = `\$\{viewport\.width\}px`/);
  expect(preview).toMatch(/transform: \[outputScale, 0, 0, outputScale, 0, 0\]/);
  expect(preview).toMatch(/适合宽度/);
  expect(preview).toMatch(/aria-label="缩小 PDF"/);
  expect(preview).toMatch(/aria-label="放大 PDF"/);
});

test("formal document file URL carries the selected persisted language", () => {
  const api = source("src/lib/api/formal-business-orders.ts");
  expect(api).toMatch(/language: "zh" \| "en"/);
  expect(api).toMatch(/searchParams\.set\("language", options\.language\)/);
});

// Copy-content boundaries are exercised by document-print-boundaries.test.tsx
// and business-order-document-pdf.test.ts, including round performance.

test("Receipt route and renderer support separate Chinese and English copies", () => {
  const route = source(RECEIPT_ROUTE);
  const print = source(PRINT);
  expect(route).toMatch(/searchParams/);
  expect(route).toMatch(/copy === "en"/);
  expect(print).toMatch(/EnglishReceiptView/);
  expect(print).toMatch(/copy === "en"/);
  expect(print).toMatch(/title="收款收据"/);
  expect(print).toMatch(/backLabel="← 返回业务单"/);
  expect(print).toMatch(/orderLabel="业务单"/);
  expect(print).toMatch(/printLabel="打印 \/ 保存 PDF"/);
  expect(print).toMatch(/title="Receipt"/);
  expect(print).toMatch(/backLabel="← Back to Business Order"/);
  expect(print).toMatch(/printLabel="Print \/ Save PDF"/);
  expect(print).toMatch(/<ChargesTable charges=\{snapshot\.charges\} bilingual=\{false\}/);
  expect(print).toMatch(/<EnglishPrimaryChargesTable charges=\{snapshot\.charges\} showChinese=\{false\}/);
  expect(print).toMatch(/<EnglishPrimaryLedger transactions=\{snapshot\.transactions\} showChinese=\{false\}/);
  expect(print).not.toMatch(/titleAnnotation="英文客户收款收据"/);
});

test("refund acknowledgement is generated after refund for offline handwritten signing", () => {
  const route = source(REFUND_ROUTE);
  const print = source(REFUND_PRINT);
  expect(route).toMatch(/FormalRefundAcknowledgementPrintSheet/);
  expect(print).toMatch(/退款签收单/);
  expect(print).toMatch(/客户签字 \/ Customer signature/);
  expect(print).toMatch(/工作人员登记退款后打印本单，由客户手写签字/);
  expect(print).toMatch(/纸质原件由工作人员保存，也可将签字件上传系统归档/);
  expect(print).not.toMatch(/SignaturePad|customerSignature/);
});
