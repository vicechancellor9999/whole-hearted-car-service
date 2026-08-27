import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DETAIL_PATH = "src/components/orders/quick-order-detail.tsx";
const RECEIPT_COMPONENT_PATH = "src/components/orders/payment-receipt-print.tsx";
const RECEIPT_ROUTE_PATH = "src/app/orders/business/[id]/receipt/[paymentId]/print/page.tsx";
const PAYMENTS_WORKSPACE_PATH = "src/components/payments/payments-workspace.tsx";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("every visible Business Order payment exposes its own printable Receipt", () => {
  expect(existsSync(resolve(process.cwd(), RECEIPT_COMPONENT_PATH))).toBe(true);
  expect(existsSync(resolve(process.cwd(), RECEIPT_ROUTE_PATH))).toBe(true);

  const detail = source(DETAIL_PATH);
  expect(detail).toMatch(/quick-payment-receipt-/);
  expect(detail).toMatch(/\/receipt\/\$\{entry\.paymentId\}\/print/);

  const receipt = source(RECEIPT_COMPONENT_PATH);
  expect(receipt).toMatch(/payment\.receipt/);
  expect(receipt).toMatch(/window\.print\(\)/);
  expect(receipt).toMatch(/paymentHistory\.map/);
  expect(receipt).toMatch(/chargeLines\.map/);
  expect(receipt).toMatch(/balanceAfterJmd/);
  expect(receipt).toMatch(/gctIncludedJmd/);

  const paymentsWorkspace = source(PAYMENTS_WORKSPACE_PATH);
  expect(paymentsWorkspace).toMatch(/payments-ledger-receipt-/);
  expect(paymentsWorkspace).toMatch(/\/receipt\/\$\{item\.receiptId\}\/print/);
});
