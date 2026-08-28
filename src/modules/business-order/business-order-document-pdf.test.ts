import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { BusinessOrderDocumentRenderSnapshot } from "@formal/db/schema/business-order-document";
import { renderBusinessOrderDocumentPdf } from "@formal/modules/business-order/business-order-document-pdf";

const snapshot: BusinessOrderDocumentRenderSnapshot = {
  version: 1,
  kind: "mechanic_work",
  businessOrder: { id: 1, orderNo: "KGN-WH-2026082500001" },
  vehicle: { plate: "4321 AB", description: "Nissan X-Trail", vin: "JN1BJ0RR9HM123456" },
  repairRound: { id: 1, roundNo: 1, teamName: "车间一组" },
  workItems: [{ kind: "labor", nameZh: "发动机诊断工时", descriptionZh: "读取故障码并检查发动机运行数据", unitLabelZh: "工时", quantity: "2.000" }],
  notes: [{ kind: "work_instruction", contentZh: "完成诊断后联系客户" }],
};

describe("renderBusinessOrderDocumentPdf", () => {
  it("creates deterministic true-A4 PDF bytes with the saved text overrides", async () => {
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
  });
});
