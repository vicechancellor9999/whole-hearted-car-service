import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createMockLinkedOperationsStore,
  validateLinkedOperationsState,
} from "../../src/lib/api/mock-orders";
import {
  attachMockQuickRefundEvidence,
  recordMockQuickPayment,
  recordMockQuickRefund,
  recordMockQuickRefundSignature,
} from "../../src/lib/api/mock-quick-orders";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

const refundProof = {
  fileName: "bank-refund.png",
  mimeType: "image/png" as const,
  dataUrl: "data:image/png;base64,UkVGVU5E",
};

test("refund is recorded before proof and an unavailable original document requires a note", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  await recordMockQuickPayment("demo-v2-provisional", {
    amountJmd: 3_000,
    method: "cash",
  }, "超级管理员", store);

  const created = await recordMockQuickRefund("demo-v2-provisional", {
    amountJmd: 2_000,
    method: "cash",
    reason: "客户退款",
    originalDocumentStatus: "returned",
  } as never, "超级管理员", store);
  expect(created.refunds.at(-1)?.proof).toBeNull();

  await expect(recordMockQuickRefund("demo-v2-provisional", {
    amountJmd: 2_000,
    method: "bank_transfer",
    reason: "银行退款",
    originalDocumentStatus: "unavailable",
    originalDocumentNote: "",
  } as never, "超级管理员", store)).rejects.toThrow(/原.*无法交回.*说明/);
});

test("refund is recorded first, then transfer proof and signed paper can be appended independently", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();

  const nonCash = await recordMockQuickRefund("demo-v2-provisional", {
    amountJmd: 5_000,
    method: "bank_transfer",
    reason: "银行转账退款",
    originalDocumentStatus: "not_issued",
    originalDocumentNote: null,
    signerName: "",
    signatureDataUrl: "",
  } as never, "超级管理员", store);
  expect(nonCash.refunds.at(-1)).toMatchObject({
    contract: "quick_refund_v2",
    amountJmd: 5_000,
    category: null,
    reason: "银行转账退款",
    originalDocumentStatus: "not_issued",
    proof: null,
    signature: null,
    document: {
      contract: "quick_refund_document_v1",
      amountJmd: 5_000,
      balanceAfterJmd: expect.any(Number),
    },
  });

  const refundId = nonCash.refunds.at(-1)!.id;
  const withProof = await attachMockQuickRefundEvidence("demo-v2-provisional", {
    refundId,
    proof: refundProof,
  }, "超级管理员", store);
  expect(withProof.refunds.at(-1)).toMatchObject({
    proof: refundProof,
    proofAttachedBy: "超级管理员",
    proofAttachedAt: expect.any(String),
  });
  await expect(attachMockQuickRefundEvidence("demo-v2-provisional", {
    refundId,
    proof: { ...refundProof, fileName: "replacement.png" },
  }, "超级管理员", store)).rejects.toThrow(/不能覆盖/);

  const cash = await recordMockQuickRefund("demo-v2-provisional", {
    amountJmd: 1_000,
    method: "cash",
    reason: "现金退款",
    originalDocumentStatus: "returned",
    originalDocumentNote: null,
  } as never, "超级管理员", store);
  expect(cash.refunds.at(-1)?.signature).toBeNull();
  const signed = await recordMockQuickRefundSignature("demo-v2-provisional", {
    refundId: cash.refunds.at(-1)!.id,
    signerName: "客户本人",
    photoDataUrl: "data:image/png;base64,U0lHTg==",
    photoFileName: "signed-refund.png",
  }, "超级管理员", store);
  expect(signed.refunds.at(-1)?.signature).toMatchObject({
    signerName: "客户本人",
    photoFileName: "signed-refund.png",
    signedBy: "超级管理员",
  });
});

test("refund document facts are validated and tampering is rejected", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  await recordMockQuickRefund("demo-v2-provisional", {
    amountJmd: 1_500,
    method: "cash",
    reason: "现金退款",
    originalDocumentStatus: "returned",
    originalDocumentNote: null,
  } as never, "超级管理员", store);

  const tampered = store.read((state) => structuredClone(state));
  const refund = tampered.quickOrders
    .find((order) => order.id === "demo-v2-provisional")
    ?.refunds.at(-1) as unknown as { document: { amountJmd: number } };
  refund.document.amountJmd += 1;
  expect(() => validateLinkedOperationsState(tampered)).toThrow(/退款说明|REFUND_DOCUMENT/);
});

test("refund UI is one evidence workflow without charge-item selection and today view exposes sensitive details", () => {
  const detailSource = readFileSync("src/components/orders/quick-order-detail.tsx", "utf8");
  const printSource = readFileSync("src/components/orders/refund-receipt-print.tsx", "utf8");
  const paymentsSource = readFileSync("src/components/payments/payments-workspace.tsx", "utf8");

  const cashDialog = detailSource.slice(
    detailSource.indexOf("function CashRefundDialog"),
    detailSource.indexOf("function CanonicalRefundDialog"),
  );
  expect(cashDialog).toContain("退款凭证");
  expect(cashDialog).not.toContain("quick-refund-proof");
  expect(cashDialog).toContain("原发票处理");
  expect(cashDialog).toContain("原单无法交回");
  expect(cashDialog).not.toContain("quick-refund-item");
  expect(cashDialog).not.toContain("quick-refund-category");
  expect(cashDialog).not.toContain("quick-cash-refund-signature");
  expect(cashDialog).toContain("客户在纸上签字后");
  expect(printSource).toContain("退款说明与签收单");
  expect(printSource).toContain("原发票处理");
  expect(paymentsSource).toContain("今日敏感操作");
  expect(paymentsSource).toContain("打开退款说明与签收单");
  expect(detailSource).toContain("quick-refund-proof-upload");
});
