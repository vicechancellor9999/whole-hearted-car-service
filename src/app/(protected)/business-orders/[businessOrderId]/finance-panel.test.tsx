import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FinancePanel } from "@/app/(protected)/business-orders/[businessOrderId]/finance-panel";
import type { BusinessOrderLedger } from "@/modules/payment/payment-service";

const ledger: BusinessOrderLedger = {
  businessOrderId: 12,
  currentDueMinor: 2_000_000,
  totalPaidMinor: 800_000,
  totalRefundedMinor: 500_000,
  balanceMinor: 1_700_000,
  transactions: [
    {
      type: "payment",
      id: 1,
      referenceNo: "PAY-20260824-0001",
      amountMinor: 800_000,
      methodCode: "cash",
      methodLabelZh: "现金",
      methodLabelEn: "Cash",
      occurredAt: new Date("2026-08-24T14:00:00Z"),
      note: "第一次收款",
      receiptId: 31,
    },
    {
      type: "refund",
      id: 2,
      referenceNo: "RFD-20260824-0001",
      amountMinor: 500_000,
      methodCode: "bank_transfer",
      methodLabelZh: "银行转账",
      methodLabelEn: "Bank transfer",
      occurredAt: new Date("2026-08-24T15:00:00Z"),
      note: "客户退款",
      receiptId: null,
    },
  ],
};

const methods = [
  { id: 1, code: "cash", labelZh: "现金", labelEn: "Cash" },
  { id: 2, code: "bank_transfer", labelZh: "银行转账", labelEn: "Bank transfer" },
];

describe("Business Order finance panel", () => {
  it("keeps payment, refund, Receipt and balance controls inside the Business Order", () => {
    render(<FinancePanel action={vi.fn()} businessOrderId={12} canRecordPayment canRefund ledger={ledger} paymentMethods={methods} />);
    expect(screen.getByText("折后应收")).toBeInTheDocument();
    expect(screen.getByText("累计收款")).toBeInTheDocument();
    expect(screen.getByText("累计退款")).toBeInTheDocument();
    expect(screen.getByText("未结余额")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登记收款并生成 Receipt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登记退款并生成签收单" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开 Receipt" })).toHaveAttribute(
      "href",
      "/business-orders/12/receipts/31?copy=zh",
    );
    expect(screen.getByRole("link", { name: "打印退款签收单" })).toHaveAttribute(
      "href",
      "/business-orders/12/refunds/2",
    );
  });

  it("accepts a free refund amount without asking the user to choose charge items", () => {
    render(<FinancePanel action={vi.fn()} businessOrderId={12} canRecordPayment canRefund ledger={ledger} paymentMethods={methods} />);
    expect(screen.getByLabelText("退款金额（JMD）")).toBeInTheDocument();
    expect(screen.queryByLabelText(/退款项目/)).not.toBeInTheDocument();
    expect(screen.queryByText(/选择收费项目/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("退款凭证")).not.toBeInTheDocument();
    expect(screen.getByText(/先登记退款并生成可打印的退款签收单/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/客户签字/)).not.toBeInTheDocument();
  });

  it("keeps the owner view read-only", () => {
    render(<FinancePanel action={vi.fn()} businessOrderId={12} canRecordPayment={false} canRefund={false} ledger={ledger} paymentMethods={methods} />);
    expect(screen.queryByRole("button", { name: "登记收款并生成 Receipt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记退款并生成签收单" })).not.toBeInTheDocument();
    expect(screen.getByText("当前账号为只读，可查看每一笔收付款和单据。")).toBeInTheDocument();
  });
});
