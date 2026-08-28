import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { BusinessOrderDocumentRenderSnapshot } from "@formal/db/schema/business-order-document";
import {
  BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION,
  englishBusinessDocumentName,
  renderBusinessOrderDocumentPdf,
} from "@formal/modules/business-order/business-order-document-pdf";

const snapshot: BusinessOrderDocumentRenderSnapshot = {
  version: 1,
  kind: "mechanic_work",
  businessOrder: { id: 1, orderNo: "KGN-WH-2026082500001" },
  vehicle: { plate: "4321 AB", description: "Nissan X-Trail", vin: "JN1BJ0RR9HM123456" },
  repairRound: { id: 1, roundNo: 1, teamName: "车间一组" },
  workItems: [{ kind: "labor", nameZh: "发动机诊断工时", descriptionZh: "读取故障码并检查发动机运行数据", unitLabelZh: "工时", quantity: "2.000" }],
  notes: [{ kind: "work_instruction", contentZh: "完成诊断后联系客户" }],
};

const customerSnapshot: BusinessOrderDocumentRenderSnapshot = {
  version: 1,
  kind: "customer_copy",
  businessOrder: {
    id: 1, orderNo: "KGN-WH-2026082500001", plate: "4321 AB",
    vehicleDescription: "Nissan X-Trail", vin: "JN1BJ0RR9HM123456",
    payerName: "David Blake", payerPhone: "+18765550102", payerTrn: null,
    payerContactName: null,
  },
  charges: {
    versionNo: 1,
    totals: {
      grossMinor: 10_000_00, lineDiscountMinor: 0, laborDiscountMinor: 0,
      partDiscountMinor: 0, otherDiscountMinor: 0, categoryDiscountMinor: 0,
      wholeOrderDiscountMinor: 0, totalDueMinor: 10_000_00, includedGctMinor: 130_435,
    },
    items: [{
      kind: "labor", nameZh: "发动机诊断", nameEn: "Engine diagnosis",
      descriptionZh: "读取故障码", descriptionEn: "Read fault codes",
      unitLabelZh: "工时", unitLabelEn: "Hour", quantity: "1.000",
      unitPriceMinor: 10_000_00, itemDiscountMinor: 0, subtotalMinor: 10_000_00,
    }],
    notes: [{ kind: "customer_concern", contentZh: "发动机灯亮", contentEn: "Engine warning light is on." }],
  },
  transactions: [],
  totals: { currentDueMinor: 10_000_00, totalPaidMinor: 0, totalRefundedMinor: 0, balanceMinor: 10_000_00 },
  approval: { statementZh: "客户确认。", statementEn: "The customer confirms this statement." },
};

describe("renderBusinessOrderDocumentPdf", () => {
  it("creates the formal v8 true-A4 document deterministically", async () => {
    expect(BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION).toBe("bo-a4-v8");
    const input = {
      documentNo: "MEC-20260828-0001",
      revisionNo: 2,
      snapshot,
      fieldOverrides: { "header.title": "维修施工确认单" },
    };
    const first = await renderBusinessOrderDocumentPdf(input);
    const second = await renderBusinessOrderDocumentPdf(input);
    expect(new TextDecoder().decode(first.slice(0, 5))).toBe("%PDF-");
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    const document = await PDFDocument.load(first);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
    const { width, height } = document.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
    expect(document.getTitle()).toContain("MEC-20260828-0001-R2");
    expect(document.getCreator()).toBe("bo-a4-v8");
  });

  it("renders a separate pure-English customer artifact", async () => {
    const bytes = await renderBusinessOrderDocumentPdf({
      documentNo: "CUS-20260828-0001",
      revisionNo: 1,
      snapshot: customerSnapshot,
      fieldOverrides: {},
      language: "en",
    });
    const pdf = await PDFDocument.load(bytes);
    const language = pdf.catalog.get(PDFName.of("Lang"));
    expect(language).toBeInstanceOf(PDFString);
    expect((language as PDFString).decodeText()).toBe("en-JM");
    expect(pdf.getCreator()).toBe("bo-a4-v8");
  });

  it("uses only the English segment of a bilingual payer name", () => {
    expect(englishBusinessDocumentName("戴维·布莱克 / David Blake")).toBe("David Blake");
    expect(englishBusinessDocumentName("David Blake")).toBe("David Blake");
    expect(englishBusinessDocumentName("戴维·布莱克")).toBeNull();
  });
});
