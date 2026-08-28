import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BusinessOrderDocumentView } from "@/app/(protected)/business-orders/[businessOrderId]/documents/[documentId]/page";
import type { BusinessOrderDocumentRecord } from "@/modules/business-order/business-order-document-service";

const officeDocument: BusinessOrderDocumentRecord = {
  id: 81,
  documentNo: "OFF-20260824-0001",
  businessOrderId: 11,
  kind: "office_archive",
  chargeVersionId: 31,
  chargeVersionNo: 2,
  repairRoundId: null,
  repairRoundNo: null,
  generatedAt: new Date("2026-08-24T15:00:00Z"),
  generatedBy: 1,
  snapshot: {
    version: 1,
    kind: "office_archive",
    businessOrder: {
      id: 11,
      orderNo: "BO-20260824-0001",
      plate: "7012 AB",
      vehicleDescription: "Honda CR-V",
      vin: "1HGBH41JXMN109186",
      payerName: "张伟",
      payerPhone: "+18765550101",
      payerTrn: "123456789",
      payerContactName: null,
    },
    charges: {
      versionNo: 2,
      totals: {
        grossMinor: 2_500_000,
        lineDiscountMinor: 100_000,
        laborDiscountMinor: 50_000,
        partDiscountMinor: 25_000,
        otherDiscountMinor: 0,
        categoryDiscountMinor: 75_000,
        wholeOrderDiscountMinor: 25_000,
        totalDueMinor: 2_300_000,
        includedGctMinor: 300_000,
      },
      items: [{
        kind: "labor",
        nameZh: "发动机诊断",
        nameEn: "Engine diagnosis",
        descriptionZh: "诊断发动机异响",
        descriptionEn: "Diagnose engine noise",
        unitLabelZh: "工时",
        unitLabelEn: "hour",
        quantity: "2.000",
        unitPriceMinor: 1_000_000,
        itemDiscountMinor: 100_000,
        subtotalMinor: 1_900_000,
      }],
      notes: [{
        kind: "liability_notice",
        contentZh: "客户已知悉诊断范围。",
        contentEn: "Customer acknowledges the diagnostic scope.",
      }, {
        kind: "internal",
        contentZh: "办公室内部备注。",
        contentEn: "Office internal note.",
      }],
    },
    transactions: [{
      type: "payment",
      referenceNo: "PAY-20260824-0001",
      amountMinor: 300_000,
      methodCode: "cash",
      methodLabelZh: "现金",
      methodLabelEn: "Cash",
      occurredAt: "2026-08-24T14:00:00.000Z",
      note: "首次收款",
    }],
    totals: {
      currentDueMinor: 2_300_000,
      totalPaidMinor: 300_000,
      totalRefundedMinor: 0,
      balanceMinor: 2_000_000,
    },
    approval: {
      statementZh: "客户签字表示认可本联内容。",
      statementEn: "The customer's signature confirms acceptance.",
    },
  },
};

const mechanicDocument: BusinessOrderDocumentRecord = {
  id: 82,
  documentNo: "MEC-20260824-0001",
  businessOrderId: 11,
  kind: "mechanic_work",
  chargeVersionId: 31,
  chargeVersionNo: 2,
  repairRoundId: 71,
  repairRoundNo: 1,
  generatedAt: new Date("2026-08-24T15:05:00Z"),
  generatedBy: 1,
  snapshot: {
    version: 1,
    kind: "mechanic_work",
    businessOrder: { id: 11, orderNo: "BO-20260824-0001" },
    vehicle: {
      plate: "7012 AB",
      description: "Honda CR-V",
      vin: "1HGBH41JXMN109186",
    },
    repairRound: { id: 71, roundNo: 1, teamName: "维修一组" },
    workItems: [{
      kind: "labor",
      nameZh: "发动机诊断",
      descriptionZh: "诊断发动机异响",
      unitLabelZh: "工时",
      quantity: "2.000",
    }],
    notes: [{
      kind: "work_instruction",
      contentZh: "先诊断后施工。",
    }, {
      kind: "liability_notice",
      contentZh: "已提前告知诊断范围。",
    }],
  },
};

const officeSnapshot = officeDocument.snapshot as Extract<
  BusinessOrderDocumentRecord["snapshot"],
  { kind: "office_archive" }
>;

const customerDocument: BusinessOrderDocumentRecord = {
  ...officeDocument,
  id: 83,
  documentNo: "CUS-20260824-0001",
  kind: "customer_copy",
  snapshot: {
    ...officeSnapshot,
    kind: "customer_copy",
    charges: {
      ...officeSnapshot.charges,
      notes: officeSnapshot.charges.notes.filter((note) => note.kind !== "internal"),
    },
  },
};

describe("Business Order formal print documents", () => {
  it("renders a bilingual customer copy without office-only notes", () => {
    const { container } = render(<BusinessOrderDocumentView document={customerDocument} />);
    expect(screen.getByRole("heading", { name: "客户联 / Customer Copy" })).toBeInTheDocument();
    expect(screen.getByText("发动机诊断 / Engine diagnosis")).toBeInTheDocument();
    expect(screen.getByText("客户签字 / Customer signature")).toBeInTheDocument();
    expect(container.textContent).not.toContain("办公室内部备注");
  });

  it("renders the bilingual office archive with charges, finance, notes and signature", () => {
    render(<BusinessOrderDocumentView document={officeDocument} />);
    expect(screen.getByRole("heading", {
      name: "办公室留底联 / Office Archive Copy",
    })).toBeInTheDocument();
    expect(screen.getByText("张伟")).toBeInTheDocument();
    expect(screen.getByText("发动机诊断 / Engine diagnosis")).toBeInTheDocument();
    expect(screen.getByText("工时折扣 / Labor discount")).toBeInTheDocument();
    expect(screen.getByText("配件折扣 / Parts discount")).toBeInTheDocument();
    expect(screen.queryByText("整单折扣 / Whole-order discount")).not.toBeInTheDocument();
    expect(screen.getByText("其中含 15% GCT / Included 15% GCT")).toBeInTheDocument();
    expect(screen.getByText("PAY-20260824-0001")).toBeInTheDocument();
    expect(screen.getByText(/办公室内部备注。/)).toBeInTheDocument();
    expect(screen.getByText("客户签字 / Customer signature")).toBeInTheDocument();
  });

  it("renders a Chinese mechanic copy without customer, money, payment or performance", () => {
    const { container } = render(<BusinessOrderDocumentView document={mechanicDocument} />);
    expect(screen.getByRole("heading", { name: "维修工联" })).toBeInTheDocument();
    expect(screen.getByText("7012 AB · Honda CR-V")).toBeInTheDocument();
    expect(screen.getByText("第 1 轮维修 · 维修一组")).toBeInTheDocument();
    expect(screen.getByText("发动机诊断")).toBeInTheDocument();
    expect(screen.getByText("先诊断后施工。")).toBeInTheDocument();
    expect(screen.getByText("回单工作内容")).toBeInTheDocument();
    const renderedText = container.textContent ?? "";
    for (const forbidden of [
      "张伟", "+18765550101", "123456789", "JMD", "收付款", "绩效",
      "Print", "Labor", "Customer", "Whole Hearted Car Service Limited",
    ]) {
      expect(renderedText).not.toContain(forbidden);
    }
  });
});
