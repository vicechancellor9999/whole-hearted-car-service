import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentHistory } from "@/app/(protected)/business-orders/[businessOrderId]/document-history";
import type { BusinessOrderDocumentRecord } from "@/modules/business-order/business-order-document-service";

const action = vi.fn(async () => undefined);

const documents: BusinessOrderDocumentRecord[] = [{
  id: 81,
  documentNo: "OFF-20260824-0001",
  businessOrderId: 11,
  kind: "office_archive",
  chargeVersionId: 31,
  chargeVersionNo: 2,
  repairRoundId: null,
  repairRoundNo: null,
  snapshot: {
    version: 1,
    kind: "office_archive",
    businessOrder: {
      id: 11,
      orderNo: "BO-20260824-0001",
      plate: "7012 AB",
      vehicleDescription: "Honda CR-V",
      vin: null,
      payerName: "张伟",
      payerPhone: null,
      payerTrn: null,
      payerContactName: null,
    },
    charges: {
      versionNo: 2,
      totals: {
        grossMinor: 0,
        lineDiscountMinor: 0,
        laborDiscountMinor: 0,
        partDiscountMinor: 0,
        otherDiscountMinor: 0,
        categoryDiscountMinor: 0,
        wholeOrderDiscountMinor: 0,
        totalDueMinor: 0,
        includedGctMinor: 0,
      },
      items: [],
      notes: [],
    },
    transactions: [],
    totals: {
      currentDueMinor: 0,
      totalPaidMinor: 0,
      totalRefundedMinor: 0,
      balanceMinor: 0,
    },
    approval: { statementZh: "认可", statementEn: "Approved" },
  },
  generatedAt: new Date("2026-08-24T15:00:00Z"),
  generatedBy: 1,
}];

describe("DocumentHistory", () => {
  it("generates all three formal copies and opens existing snapshots for reprint", () => {
    render(
      <DocumentHistory
        action={action}
        businessOrderId={11}
        canGenerate
        documents={documents}
      />,
    );

    expect(screen.getByRole("button", { name: "生成客户联" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成办公室留底联" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成维修工联" })).toBeInTheDocument();
    expect(screen.getByText("OFF-20260824-0001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开 / 补打" })).toHaveAttribute(
      "href",
      "/business-orders/11/documents/81",
    );
  });

  it("keeps owner mode read-only", () => {
    render(
      <DocumentHistory
        action={action}
        businessOrderId={11}
        canGenerate={false}
        documents={documents}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开 / 补打" })).toBeInTheDocument();
  });
});
