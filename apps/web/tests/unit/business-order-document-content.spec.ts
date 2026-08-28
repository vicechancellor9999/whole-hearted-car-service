import { expect, test } from "@playwright/test";
import {
  applyDocumentOverrides,
  buildBusinessOrderDocumentContent,
  validateDocumentOverrides,
} from "@formal/modules/business-order/business-order-document-content";
import type { BusinessOrderDocumentRenderSnapshot } from "@formal/db/schema/business-order-document";

const mechanicSnapshot: BusinessOrderDocumentRenderSnapshot = {
  version: 1,
  kind: "mechanic_work",
  businessOrder: { id: 1, orderNo: "KGN-WH-2026082500001" },
  vehicle: { plate: "4321 AB", description: "Nissan X-Trail", vin: "JN1" },
  repairRound: { id: 1, roundNo: 1, teamName: "车间一组" },
  workItems: [{ kind: "labor", nameZh: "发动机诊断工时", descriptionZh: "读取故障码", unitLabelZh: "工时", quantity: "2.000" }],
  notes: [{ kind: "work_instruction", contentZh: "完成诊断后联系客户" }],
};

test("builds stable editable fields from a mechanic document without financial facts", () => {
  const content = buildBusinessOrderDocumentContent(mechanicSnapshot);
  expect(content.kind).toBe("mechanic_work");
  expect(content.fields.map((field) => field.key)).toContain("header.title");
  expect(content.fields.map((field) => field.key)).toContain("workItems.0.nameZh");
  expect(content.fields.map((field) => field.key)).toContain("notes.0.contentZh");
  expect(JSON.stringify(content)).not.toContain("payerPhone");
  expect(JSON.stringify(content)).not.toContain("totalDueMinor");
});

test("applies only closed, plain-text overrides without mutating base content", () => {
  const content = buildBusinessOrderDocumentContent(mechanicSnapshot);
  const overrides = validateDocumentOverrides(mechanicSnapshot, {
    "header.title": "维修施工单",
    "notes.0.contentZh": "先试车，再联系客户",
  });
  const changed = applyDocumentOverrides(content, overrides);
  expect(changed.fields.find((field) => field.key === "header.title")?.value).toBe("维修施工单");
  expect(content.fields.find((field) => field.key === "header.title")?.value).toBe("维修工联");
});

test("rejects unknown keys, non-text values, controls and oversized text", () => {
  expect(() => validateDocumentOverrides(mechanicSnapshot, { "invented.key": "x" })).toThrow(/不允许编辑/);
  expect(() => validateDocumentOverrides(mechanicSnapshot, { "header.title": 12 })).toThrow(/纯文本/);
  expect(() => validateDocumentOverrides(mechanicSnapshot, { "header.title": "x\u0000y" })).toThrow(/控制字符/);
  expect(() => validateDocumentOverrides(mechanicSnapshot, { "header.title": "x".repeat(4001) })).toThrow(/4000/);
});
