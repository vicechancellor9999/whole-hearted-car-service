import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { FormalBusinessOrderDocumentPrintSheet, FormalReceiptPrintSheet } from "../../src/components/orders/formal-business-order-print";
import { fetchFormalDocument, fetchFormalReceipt, type FormalBusinessOrderDocument, type FormalCustomerCopySnapshot } from "../../src/lib/api/formal-business-orders";

vi.mock("../../src/lib/api/formal-business-orders", async (original) => ({ ...await original<object>(), fetchFormalDocument: vi.fn(), fetchFormalReceipt: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const customer: FormalCustomerCopySnapshot = {
  version: 1, kind: "customer_copy",
  businessOrder: { id: 1, orderNo: "BO-ONE", plate: "4321 AB", vehicleDescription: "Nissan", vin: null, payerName: "David Blake", payerPhone: null, payerTrn: null, payerContactName: null },
  charges: { versionNo: 1, totals: { grossMinor: 100000, lineDiscountMinor: 0, laborDiscountMinor: 0, partDiscountMinor: 0, otherDiscountMinor: 0, categoryDiscountMinor: 0, wholeOrderDiscountMinor: 0, totalDueMinor: 100000, includedGctMinor: 13043 }, items: [], notes: [{ kind: "liability_notice", contentZh: "追加维修需确认", contentEn: "Confirm additional repairs" }, { kind: "internal", contentZh: "INTERNAL-ONLY", contentEn: null }] },
  transactions: [{ type: "payment", referenceNo: "RCT-PRIVATE", amountMinor: 12345, methodCode: "cash", methodLabelZh: "现金", methodLabelEn: "Cash", occurredAt: "2026-09-05T12:00:00Z", note: null }],
  totals: { currentDueMinor: 100000, totalPaidMinor: 12345, totalRefundedMinor: 0, balanceMinor: 87655 },
  approval: { statementZh: "认可费用及责任", statementEn: "Accept charges and responsibilities" },
};
function record(snapshot: FormalBusinessOrderDocument["snapshot"]): FormalBusinessOrderDocument {
  return { id: 1, documentNo: "DOC-ONE", businessOrderId: 1, kind: snapshot.kind, chargeVersionId: 1, chargeVersionNo: 1, repairRoundId: null, repairRoundNo: null, generatedAt: "2026-09-05T12:00:00Z", generatedBy: 1, snapshot };
}

it.each(["zh", "en"] as const)("keeps pending quote and free prices distinct in the %s receipt", async (copy) => {
  const base = { kind: "part" as const, nameZh: "清洗剂", nameEn: "Cleaning agent", descriptionZh: null, descriptionEn: null, unitLabelZh: "瓶", unitLabelEn: "Bottle", quantity: "1", unitPriceMinor: 0, itemDiscountMinor: 0, subtotalMinor: 0 };
  vi.mocked(fetchFormalReceipt).mockResolvedValue({
    id: 1, receiptNo: "RCT-ONE", businessOrderId: 1, paymentId: 1, issuedBy: 1, issuedAt: "2026-09-05T12:00:00Z",
    snapshot: { ...customer, version: 1, charges: { ...customer.charges, items: [{ ...base, pendingQuote: true }, { ...base, nameZh: "赠品", nameEn: "Gift", pendingQuote: false }] }, currentPayment: { paymentNo: "PAY-ONE", paidAt: "2026-09-05T12:00:00Z", methodCode: "cash", methodLabelZh: "现金", methodLabelEn: "Cash", amountMinor: 10000, note: null }, totals: { ...customer.totals, balanceAfterMinor: 90000 } },
  });
  render(<FormalReceiptPrintSheet orderId={1} receiptId={1} copy={copy} />);
  const pendingRow = (await screen.findByText(copy === "zh" ? "清洗剂" : "Cleaning agent")).closest(".formal-print-row") as HTMLElement;
  expect(pendingRow.textContent).toContain(copy === "zh" ? "待报价" : "Pending quote");
  expect(pendingRow.textContent).not.toContain("JMD 0.00");
  const freeRow = screen.getByText(copy === "zh" ? "赠品" : "Gift").closest(".formal-print-row") as HTMLElement;
  expect(within(freeRow).getAllByText("JMD 0.00")).toHaveLength(2);
  expect(screen.getByText(copy === "zh" ? "已报价金额（含税）" : "Quoted charges (tax included)")).toBeTruthy();
  expect(screen.getByText(copy === "zh" ? /1 项待报价/ : /1 item\(s\) pending quote/)).toBeTruthy();
});

it.each(["customer_copy", "office_archive"] as const)("keeps the legacy %s print URL on fee/responsibility content", async (kind) => {
  vi.mocked(fetchFormalDocument).mockResolvedValue(record({ ...customer, kind }));
  const { container } = render(<FormalBusinessOrderDocumentPrintSheet orderId={1} documentId={1} />);
  await screen.findByText(/非税务发票/);
  expect(container.textContent).toContain("追加维修需确认");
  expect(container.textContent).toContain("认可费用及责任");
  expect(container.textContent).not.toMatch(/RCT-PRIVATE|INTERNAL-ONLY|累计收款|累计退款|未结余额|收付款历史/);
});

it("shows this order and round's signed performance on the mechanic print URL", async () => {
  vi.mocked(fetchFormalDocument).mockResolvedValue(record({ version: 1, kind: "mechanic_work", businessOrder: { id: 1, orderNo: "BO-ONE" }, vehicle: { plate: "4321 AB", description: "Nissan", vin: null }, repairRound: { id: 3, roundNo: 3, teamName: "车间一组", performanceMinor: -50000, performanceSource: "handoff" }, workItems: [], notes: [] }));
  const { container } = render(<FormalBusinessOrderDocumentPrintSheet orderId={1} documentId={1} />);
  await screen.findByText(/本单本轮绩效/);
  expect(container.textContent).toContain("BO-ONE");
  expect(container.textContent).toContain("第 3 轮维修");
  expect(container.textContent).toContain("−JMD 500.00");
});
