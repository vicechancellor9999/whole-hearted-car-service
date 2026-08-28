import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DETAIL = "src/components/orders/formal-business-order-detail.tsx";
const PRINT = "src/components/orders/formal-business-order-print.tsx";
const RECEIPT_ROUTE = "src/app/orders/business/[id]/receipt/[paymentId]/print/page.tsx";
const DOCUMENT_ROUTE = "src/app/orders/business/[id]/documents/[documentId]/print/page.tsx";
const REFUND_PRINT = "src/components/orders/formal-refund-acknowledgement-print.tsx";
const REFUND_ROUTE = "src/app/orders/business/[id]/refund/[refundId]/print/page.tsx";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("formal Business Order exposes each Receipt and immutable print document", () => {
  expect(existsSync(resolve(process.cwd(), PRINT))).toBe(true);
  expect(existsSync(resolve(process.cwd(), DOCUMENT_ROUTE))).toBe(true);
  expect(source(RECEIPT_ROUTE)).toMatch(/FormalReceiptPrintSheet/);
  expect(source(DOCUMENT_ROUTE)).toMatch(/FormalBusinessOrderDocumentPrintSheet/);
  expect(source(DETAIL)).toMatch(/生成客户联/);
  expect(source(DETAIL)).toMatch(/生成办公室签字留底联/);
  expect(source(DETAIL)).toMatch(/生成维修工联/);
  expect(source(DETAIL)).toMatch(/Receipt：\{transaction\.referenceNo\}/);
  expect(source(DETAIL)).toMatch(/打开 \/ 补打/);
});

test("print renderer preserves the three-copy business boundaries", () => {
  const print = source(PRINT);
  expect(print).toMatch(/客户联 \/ Customer Copy/);
  expect(print).toMatch(/本次收款/);
  expect(print).toMatch(/收费项目/);
  expect(print).toMatch(/收付款历史/);
  expect(print).toMatch(/未结余额/);
  expect(print).toMatch(/客户签字/);
  expect(print).toMatch(/责任义务与提前告知/);
  expect(print).toMatch(/施工项目/);
  expect(print).toMatch(/完成情况/);
  expect(print).toMatch(/维修工联不得显示客户与金额/);
});

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
