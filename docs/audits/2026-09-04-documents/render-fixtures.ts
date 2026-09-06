import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderBusinessOrderDocumentPdf } from "../../../src/modules/business-order/business-order-document-pdf";
import type { BusinessOrderDocumentRenderSnapshot } from "../../../src/db/schema/business-order-document";

// Synthetic visual fixtures only. No application records are created.
const customer: BusinessOrderDocumentRenderSnapshot = {
  version: 1, kind: "customer_copy",
  businessOrder: { id: 0, orderNo: "PREVIEW-ONLY", plate: "4321 AB", vehicleDescription: "Nissan X-Trail", vin: "JN1BJ0RR9HM123456", payerName: "David Blake", payerPhone: "+18765550102", payerTrn: null, payerContactName: null },
  charges: {
    versionNo: 1,
    items: [
      { kind: "labor", nameZh: "节气门清洗", nameEn: "Throttle body cleaning", descriptionZh: "清洗后检查发动机怠速，继续诊断故障原因。", descriptionEn: "Clean the throttle body, check idle speed and continue diagnosis.", unitLabelZh: "次", unitLabelEn: "Job", quantity: "1.000", unitPriceMinor: 1500000, itemDiscountMinor: 0, subtotalMinor: 1500000 },
      { kind: "part", nameZh: "清洗剂", nameEn: "Cleaning agent", descriptionZh: "用于本次清洗", descriptionEn: "For this cleaning service", unitLabelZh: "瓶", unitLabelEn: "Bottle", quantity: "1.000", unitPriceMinor: 80000, itemDiscountMinor: 0, subtotalMinor: 80000 },
    ],
    totals: { grossMinor: 1580000, lineDiscountMinor: 0, laborDiscountMinor: 0, partDiscountMinor: 0, otherDiscountMinor: 0, categoryDiscountMinor: 0, wholeOrderDiscountMinor: 0, totalDueMinor: 1580000, includedGctMinor: 206087 },
    notes: [{ kind: "liability_notice", contentZh: "本次先完成诊断；如需追加维修项目，须再次与客户确认范围和费用。", contentEn: "Complete diagnosis first. Any additional repair work and charges require customer confirmation." }],
  },
  transactions: [], totals: { currentDueMinor: 1580000, totalPaidMinor: 0, totalRefundedMinor: 0, balanceMinor: 1580000 },
  approval: { statementZh: "客户签字表示已阅读并认可本联所列施工、收费、金额、备注及提前告知内容。", statementEn: "The customer's signature confirms acceptance of the work, charges, notes and advance notices shown on this copy." },
};
const mechanic: BusinessOrderDocumentRenderSnapshot = {
  version: 1, kind: "mechanic_work", businessOrder: { id: 0, orderNo: "PREVIEW-ONLY" },
  vehicle: { plate: "4321 AB", description: "Nissan X-Trail", vin: "JN1BJ0RR9HM123456" },
  repairRound: { id: 0, roundNo: 2, teamName: "车间一组", performanceMinor: -50000, performanceSource: "draft" },
  workItems: customer.charges.items.map((item) => ({ kind: item.kind, nameZh: item.nameZh, descriptionZh: item.descriptionZh, unitLabelZh: item.unitLabelZh, quantity: item.quantity })),
  notes: [{ kind: "work_instruction", contentZh: "复查清洗效果，记录试车结果。" }],
};
for (const [name, snapshot] of [["customer", customer], ["office", { ...customer, kind: "office_archive" }], ["mechanic", mechanic]] as const) {
  const bytes = await renderBusinessOrderDocumentPdf({ documentNo: "QA-20260905-0001", revisionNo: 1, snapshot, fieldOverrides: {} });
  await writeFile(fileURLToPath(new URL(`./${name}-v10.pdf`, import.meta.url)), bytes);
}
