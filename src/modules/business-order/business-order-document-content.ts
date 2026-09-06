import type { BusinessOrderDocumentRenderSnapshot } from "@formal/db/schema/business-order-document";

export type BusinessOrderDocumentField = {
  key: string;
  editorLabel: string;
  value: string;
  section: "header" | "facts" | "problem" | "charges" | "transactions" | "notes" | "approval" | "footer";
  multiline?: boolean;
};

export type BusinessOrderDocumentContent = {
  kind: BusinessOrderDocumentRenderSnapshot["kind"];
  fields: BusinessOrderDocumentField[];
};

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function money(minor: number): string {
  return `JMD ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function field(
  key: string,
  editorLabel: string,
  value: unknown,
  section: BusinessOrderDocumentField["section"],
  multiline = false,
): BusinessOrderDocumentField {
  return { key, editorLabel, value: value == null ? "" : String(value), section, multiline };
}

function commonHeader(kind: BusinessOrderDocumentRenderSnapshot["kind"]): BusinessOrderDocumentField[] {
  const title = kind === "customer_copy" ? "客户联" : kind === "office_archive" ? "办公室签字留底联" : "维修工联";
  return [
    field("header.company", "公司名称", "Whole Hearted Car Service Limited", "header"),
    field("header.title", "单据标题", title, "header"),
    field("header.address", "公司地址", "Kingston, Jamaica", "header"),
  ];
}

export function buildBusinessOrderDocumentContent(
  snapshot: BusinessOrderDocumentRenderSnapshot,
): BusinessOrderDocumentContent {
  const fields = commonHeader(snapshot.kind);
  if (snapshot.kind === "mechanic_work") {
    fields.push(
      field("facts.orderNo", "Business Order", snapshot.businessOrder.orderNo, "facts"),
      field("facts.vehicle", "车辆", `${snapshot.vehicle.plate} · ${snapshot.vehicle.description}`, "facts"),
      field("facts.vin", "VIN", snapshot.vehicle.vin ?? "未记录", "facts"),
      field("facts.repairRound", "维修轮次", `第 ${snapshot.repairRound.roundNo} 轮维修`, "facts"),
      field("facts.team", "维修班组", snapshot.repairRound.teamName ?? "未派单", "facts"),
    );
    if (snapshot.version === 2) {
      fields.push(field(
        "problemDescription.primaryZh",
        "本轮问题描述",
        snapshot.problemDescription.primary.contentZh ?? "",
        "problem",
        true,
      ));
      if (snapshot.problemDescription.originalContext) {
        fields.push(field(
          "problemDescription.originalZh",
          "整单原始问题",
          snapshot.problemDescription.originalContext.contentZh ?? "",
          "problem",
          true,
        ));
      }
    }
    snapshot.workItems.forEach((item, index) => {
      fields.push(
        field(`workItems.${index}.nameZh`, `施工项目 ${index + 1}`, item.nameZh, "charges"),
        field(`workItems.${index}.descriptionZh`, `工作说明 ${index + 1}`, item.descriptionZh ?? "", "charges", true),
        field(`workItems.${index}.quantity`, `数量 ${index + 1}`, `${item.quantity} ${item.kind === "labor" ? "JOB" : item.unitLabelZh}`, "charges"),
      );
    });
    snapshot.notes.forEach((note, index) => fields.push(
      field(`notes.${index}.contentZh`, `施工备注 ${index + 1}`, note.contentZh, "notes", true),
    ));
    fields.push(field("footer.left", "页脚", "本单据仅用于本轮维修施工与回单。", "footer"));
    return { kind: snapshot.kind, fields };
  }

  const order = snapshot.businessOrder;
  fields.push(
    field("facts.orderNo", "Business Order", order.orderNo, "facts"),
    field("facts.payer.value", "费用承担方", order.payerName, "facts"),
    field("facts.contact.value", "联系电话", order.payerPhone ?? "未记录", "facts"),
    field("facts.trn.value", "TRN", order.payerTrn ?? "未记录", "facts"),
    field("facts.vehicle.value", "车辆", `${order.plate} · ${order.vehicleDescription}`, "facts"),
    field("facts.vin.value", "VIN", order.vin ?? "未记录", "facts"),
  );
  if (snapshot.version === 2) {
    fields.push(
      field("problemDescription.originalZh", "原始问题描述", snapshot.problemDescription.original.contentZh ?? "", "problem", true),
      field("problemDescription.originalEn", "Original problem description", snapshot.problemDescription.original.contentEn ?? "", "problem", true),
    );
    const round = snapshot.problemDescription.repairRound;
    const originalPair = `${snapshot.problemDescription.original.contentZh?.trim() ?? ""}\u0000${snapshot.problemDescription.original.contentEn?.trim() ?? ""}`;
    const roundPair = `${round?.contentZh?.trim() ?? ""}\u0000${round?.contentEn?.trim() ?? ""}`;
    if (round && roundPair !== originalPair) {
      fields.push(
        field("problemDescription.roundZh", "本轮问题描述", round.contentZh ?? "", "problem", true),
        field("problemDescription.roundEn", "Repair-round problem description", round.contentEn ?? "", "problem", true),
      );
    }
  }
  snapshot.charges.items.forEach((item, index) => {
    fields.push(
      field(`charges.items.${index}.nameZh`, `收费项目 ${index + 1}`, item.nameZh, "charges"),
      field(`charges.items.${index}.descriptionZh`, `项目说明 ${index + 1}`, item.descriptionZh ?? "", "charges", true),
      field(`charges.items.${index}.quantity`, `数量 ${index + 1}`, `${item.quantity} ${item.kind === "labor" ? "JOB" : item.unitLabelZh}`, "charges"),
      field(`charges.items.${index}.unitPrice`, `含税单价 ${index + 1}`, item.pendingQuote ? "待报价" : money(item.unitPriceMinor), "charges"),
      field(`charges.items.${index}.discount`, `本项折扣 ${index + 1}`, item.pendingQuote ? "—" : money(item.itemDiscountMinor), "charges"),
      field(`charges.items.${index}.subtotal`, `含税小计 ${index + 1}`, item.pendingQuote ? "—" : money(item.subtotalMinor), "charges"),
    );
  });
  snapshot.charges.notes.forEach((note, index) => {
    if (note.contentZh) fields.push(field(`notes.${index}.contentZh`, `备注 ${index + 1}`, note.contentZh, "notes", true));
    if (note.contentEn) fields.push(field(`notes.${index}.contentEn`, `Note ${index + 1}`, note.contentEn, "notes", true));
  });
  fields.push(
    field("totals.currentDue", snapshot.charges.items.some((item) => item.pendingQuote) ? "已报价金额" : "折后应收", money(snapshot.totals.currentDueMinor), "charges"),
    field("approval.statementZh", "客户确认", snapshot.approval.statementZh, "approval", true),
    field("approval.statementEn", "Customer acknowledgement", snapshot.approval.statementEn, "approval", true),
    field("footer.left", "页脚", "客户签字：____________________    日期：____________________", "footer"),
  );
  return { kind: snapshot.kind, fields };
}

export function validateDocumentOverrides(
  snapshot: BusinessOrderDocumentRenderSnapshot,
  input: unknown,
): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("打印修改必须是纯文本字段对象");
  const allowed = new Set(buildBusinessOrderDocumentContent(snapshot).fields.map((item) => item.key));
  const result: Record<string, string> = {};
  let total = 0;
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) throw new Error(`字段 ${key} 不允许编辑`);
    if (typeof value !== "string") throw new Error("打印修改只允许纯文本");
    if (CONTROL_CHARACTERS.test(value)) throw new Error("打印文字不能包含控制字符");
    if (value.length > 4_000) throw new Error("单个打印字段不能超过 4000 字");
    total += value.length;
    if (total > 100_000) throw new Error("单次打印修改总长度不能超过 100000 字");
    result[key] = value;
  }
  return result;
}

export function applyDocumentOverrides(
  content: BusinessOrderDocumentContent,
  overrides: Record<string, string>,
): BusinessOrderDocumentContent {
  return {
    kind: content.kind,
    fields: content.fields.map((item) => ({ ...item, value: overrides[item.key] ?? item.value })),
  };
}
