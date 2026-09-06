import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BusinessOrderDocumentRenderSnapshot } from "../../src/db/schema/business-order-document";
import { renderBusinessOrderDocumentPdf } from "../../src/modules/business-order/business-order-document-pdf";

// Isolated visual fixture: this script never reads or writes business records.
const output = "/Volumes/公司文件/Whole Hearted QA/2026-09-05-core-paths";
let fixture: BusinessOrderDocumentRenderSnapshot = {
  version: 1, kind: "customer_copy",
  businessOrder: { id: 0, orderNo: "QA-PENDING-0001", plate: "QA 0001", vehicleDescription: "Nissan X-Trail", vin: null, payerName: "测试客户 / QA Customer", payerPhone: null, payerTrn: null, payerContactName: null },
  charges: {
    versionNo: 1,
    totals: { grossMinor: 1000000, lineDiscountMinor: 0, laborDiscountMinor: 0, partDiscountMinor: 0, otherDiscountMinor: 0, categoryDiscountMinor: 0, wholeOrderDiscountMinor: 0, totalDueMinor: 1000000, includedGctMinor: 130435 },
    items: [
      { kind: "labor", nameZh: "节气门清洗", nameEn: "Throttle body cleaning", descriptionZh: "清洗后进一步检查怠速", descriptionEn: "Check idle operation after cleaning", quantity: "1", unitLabelZh: "JOB", unitLabelEn: "JOB", unitPriceMinor: 1000000, itemDiscountMinor: 0, subtotalMinor: 1000000 },
      { kind: "labor", nameZh: "复查", nameEn: "Follow-up check", descriptionZh: "本次免费", descriptionEn: "Complimentary", quantity: "1", unitLabelZh: "JOB", unitLabelEn: "JOB", unitPriceMinor: 0, itemDiscountMinor: 0, subtotalMinor: 0, pendingQuote: false },
      { kind: "part", nameZh: "清洗剂", nameEn: "Cleaning agent", descriptionZh: "规格及价格待确认", descriptionEn: "Specification and price to be confirmed", quantity: "1", unitLabelZh: "瓶", unitLabelEn: "Bottle", unitPriceMinor: 0, itemDiscountMinor: 0, subtotalMinor: 0, pendingQuote: true },
    ],
    notes: [{ kind: "liability_notice", contentZh: "追加维修项目及费用须与客户确认。", contentEn: "Additional repair work and charges require customer confirmation." }],
  },
  transactions: [],
  totals: { currentDueMinor: 1000000, totalPaidMinor: 0, totalRefundedMinor: 0, balanceMinor: 1000000 },
  approval: { statementZh: "已核对本单工作内容、已报价费用及责任说明。", statementEn: "The work, quoted charges and responsibility statements have been reviewed." },
};
const longContent = process.argv.includes("--long");
const identity = process.argv.includes("--identity");
if (identity) {
  const payerZh = longContent ? Array.from({ length: 90 }, (_, index) => `客户${String(index + 1).padStart(3, "0")}：测试公司`).join("\n") : "全心全意汽车维修与工程服务有限公司金斯敦综合车辆维护中心商业客户";
  const payerEn = longContent ? Array.from({ length: 90 }, (_, index) => `Customer ${String(index + 1).padStart(3, "0")} Company`).join("\n") : "Whole Hearted Vehicle Maintenance and Engineering Services Limited Kingston Commercial Fleet Operations Department";
  fixture.businessOrder.payerName = `${payerZh} / ${payerEn}`;
  fixture.businessOrder.vehicleDescription = "Nissan X-Trail 2.0L Petrol Automatic Transmission Four Wheel Drive Commercial Fleet Service Vehicle";
} else if (longContent) {
  fixture = { ...fixture, charges: { ...fixture.charges, items: fixture.charges.items.map((item, index) => index ? item : {
    ...item,
    descriptionZh: Array.from({ length: 90 }, (_, line) => `检查${String(line + 1).padStart(3, "0")}：核对发动机运行数据。`).join("\n"),
    descriptionEn: Array.from({ length: 90 }, (_, line) => `Check ${String(line + 1).padStart(3, "0")}: Verify engine data.`).join("\n"),
  }) } };
}
await mkdir(output, { recursive: true });
for (const language of ["zh", "en"] as const) {
  const bytes = await renderBusinessOrderDocumentPdf({ documentNo: "QA-PENDING-0001", revisionNo: 1, snapshot: fixture, language, fieldOverrides: {} });
  const filename = path.join(output, `${identity ? `identity-${longContent ? "long" : "wrapped"}` : longContent ? "long-content" : "pending-quote"}-${language}.pdf`);
  await writeFile(filename, bytes);
  console.log(filename);
}
