import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { BusinessOrderDocumentRenderSnapshot } from "@formal/db/schema/business-order-document";
import {
  applyDocumentOverrides,
  buildBusinessOrderDocumentContent,
  validateDocumentOverrides,
} from "@formal/modules/business-order/business-order-document-content";

export const BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION = "bo-a4-v6";
export const A4_WIDTH_POINTS = 595.28;
export const A4_HEIGHT_POINTS = 841.89;

const MARGIN = 30;
const CONTENT_WIDTH = A4_WIDTH_POINTS - MARGIN * 2;
const PAGE_BOTTOM = 42;
const BLUE = rgb(0.11, 0.41, 0.83);
const BLUE_DARK = rgb(0.05, 0.19, 0.36);
const INK = rgb(0.15, 0.15, 0.15);
const MUTED = rgb(0.39, 0.42, 0.46);
const LINE = rgb(0.80, 0.82, 0.84);
const HAIRLINE = rgb(0.90, 0.90, 0.90);
const SOFT = rgb(0.965, 0.97, 0.975);
const WHITE = rgb(1, 1, 1);

export type RenderBusinessOrderDocumentPdfInput = {
  documentNo: string;
  revisionNo: number;
  snapshot: BusinessOrderDocumentRenderSnapshot;
  fieldOverrides: Record<string, string>;
};

type TableCell = { text: string; align?: "left" | "right" | "center"; color?: RGB };

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const result: string[] = [];
  for (const paragraph of String(text ?? "").replaceAll("\r\n", "\n").split("\n")) {
    if (!paragraph) { result.push(""); continue; }
    let line = "";
    for (const character of paragraph) {
      const next = `${line}${character}`;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
        result.push(line);
        line = character;
      } else {
        line = next;
      }
    }
    result.push(line);
  }
  return result.length ? result : [""];
}

function money(minor: number): string {
  return `JMD ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function documentDate(documentNo: string): string {
  const match = documentNo.match(/-(\d{4})(\d{2})(\d{2})-/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : "—";
}

function kindTitle(kind: BusinessOrderDocumentRenderSnapshot["kind"]): { primary: string; secondary: string } {
  if (kind === "mechanic_work") return { primary: "维修施工单", secondary: "WORK ORDER" };
  if (kind === "office_archive") return { primary: "OFFICE SIGNATURE COPY", secondary: "办公室签字留底联" };
  return { primary: "客户维修结算单", secondary: "CUSTOMER SERVICE STATEMENT" };
}

export async function renderBusinessOrderDocumentPdf(input: RenderBusinessOrderDocumentPdfInput): Promise<Uint8Array> {
  const overrides = validateDocumentOverrides(input.snapshot, input.fieldOverrides);
  const content = applyDocumentOverrides(buildBusinessOrderDocumentContent(input.snapshot), overrides);
  const values = new Map(content.fields.map((field) => [field.key, field.value]));
  const value = (key: string, fallback: string) => values.get(key) ?? fallback;

  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const fixedDate = new Date("2000-01-01T00:00:00.000Z");
  document.setTitle(`${input.documentNo}-R${input.revisionNo}`);
  document.setAuthor("Whole Hearted Car Service Limited");
  document.setSubject("Business Order formal A4 document");
  document.setCreator(BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION);
  document.setProducer(BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION);
  document.setCreationDate(fixedDate);
  document.setModificationDate(fixedDate);

  const fontBytes = await readFile(path.join(process.cwd(), "apps/web/public/fonts/NotoSansSC-Regular-wh.ttf"));
  const logoBytes = await readFile(path.join(process.cwd(), "apps/web/public/logo-icon.png"));
  const font = await document.embedFont(Uint8Array.from(fontBytes), { subset: false });
  const logo = await document.embedPng(Uint8Array.from(logoBytes));
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const drawText = (text: string, x: number, baseline: number, size = 8, color = INK, maxWidth?: number, align: "left" | "right" | "center" = "left") => {
    let tx = x;
    const width = font.widthOfTextAtSize(text, size);
    if (maxWidth && align === "right") tx = x + maxWidth - width;
    if (maxWidth && align === "center") tx = x + (maxWidth - width) / 2;
    page.drawText(text || " ", { x: tx, y: baseline, size, font, color });
  };

  const drawHeader = (continued: boolean) => {
    const title = kindTitle(input.snapshot.kind);
    const logoSize = continued ? 25 : 34;
    const headerTop = A4_HEIGHT_POINTS - MARGIN;
    page.drawImage(logo, { x: MARGIN, y: headerTop - logoSize, width: logoSize, height: logoSize });
    drawText("Whole Hearted Car Service Limited", MARGIN + logoSize + 9, headerTop - 9, continued ? 9.4 : 11.5, BLUE_DARK);
    drawText("16 Ferry Pen, Kingston, Jamaica", MARGIN + logoSize + 9, headerTop - 21, 6.7, MUTED);
    if (!continued) drawText("WhatsApp: 1 876-899-3924 / 1 876-333-3322  ·  TRN 003650332", MARGIN + logoSize + 9, headerTop - 31, 6.4, MUTED);
    drawText(title.primary, MARGIN, headerTop - 10, continued ? 10.5 : 13.5, BLUE_DARK, CONTENT_WIDTH, "right");
    drawText(title.secondary, MARGIN, headerTop - 23, 6.8, BLUE, CONTENT_WIDTH, "right");
    drawText(`${input.documentNo}  ·  R${input.revisionNo}${continued ? "  ·  CONTINUED" : ""}`, MARGIN, headerTop - 34, 6.7, MUTED, CONTENT_WIDTH, "right");
    const lineY = headerTop - (continued ? 39 : 45);
    page.drawLine({ start: { x: MARGIN, y: lineY }, end: { x: A4_WIDTH_POINTS - MARGIN, y: lineY }, thickness: 1.4, color: BLUE });
    y = lineY - 14;
  };

  const addPage = () => {
    page = document.addPage([A4_WIDTH_POINTS, A4_HEIGHT_POINTS]);
    pages.push(page);
    drawHeader(pages.length > 1);
  };

  const ensure = (height: number, onNewPage?: () => void) => {
    if (y - height >= PAGE_BOTTOM) return false;
    addPage();
    onNewPage?.();
    return true;
  };

  const sectionTitle = (primary: string, secondary?: string) => {
    ensure(24);
    y -= 3;
    drawText(primary, MARGIN, y, 9.2, BLUE_DARK);
    if (secondary) drawText(secondary, MARGIN + 90, y + 0.2, 6.5, MUTED);
    page.drawLine({ start: { x: MARGIN, y: y - 5 }, end: { x: A4_WIDTH_POINTS - MARGIN, y: y - 5 }, thickness: 0.8, color: BLUE });
    y -= 16;
  };

  const infoGrid = (cells: Array<{ label: string; value: string }>, columns = 3) => {
    const rows = Math.ceil(cells.length / columns);
    const cellWidth = CONTENT_WIDTH / columns;
    const rowHeight = 34;
    ensure(rows * rowHeight + 2);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const x = MARGIN + column * cellWidth;
        const top = y - row * rowHeight;
        page.drawRectangle({ x, y: top - rowHeight, width: cellWidth, height: rowHeight, borderColor: LINE, borderWidth: 0.55, color: row % 2 ? WHITE : SOFT });
        const cell = cells[index];
        if (!cell) continue;
        drawText(cell.label, x + 7, top - 11, 6.2, MUTED);
        const lines = wrapText(cell.value || "—", font, 8.1, cellWidth - 14).slice(0, 2);
        lines.forEach((line, lineIndex) => drawText(line, x + 7, top - 23 - lineIndex * 9, 8.1, INK));
      }
    }
    y -= rows * rowHeight + 12;
  };

  const table = (
    section: { primary: string; secondary?: string },
    headers: string[],
    widths: number[],
    rows: TableCell[][],
    options: { fontSize?: number; headerSize?: number; minimumRowHeight?: number } = {},
  ) => {
    const fontSize = options.fontSize ?? 7.2;
    const headerSize = options.headerSize ?? 6.4;
    const headerHeight = 21;
    const minimumRowHeight = options.minimumRowHeight ?? 24;
    const drawTableHeader = () => {
      ensure(headerHeight + 2);
      page.drawRectangle({ x: MARGIN, y: y - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: BLUE_DARK });
      let x = MARGIN;
      headers.forEach((header, index) => {
        drawText(header, x + 5, y - 14, headerSize, WHITE, widths[index] - 10, index >= headers.length - 3 ? "right" : "left");
        x += widths[index];
      });
      y -= headerHeight;
    };
    sectionTitle(section.primary, section.secondary);
    drawTableHeader();
    rows.forEach((row, rowIndex) => {
      const linesByCell = row.map((cell, index) => wrapText(cell.text, font, fontSize, widths[index] - 10));
      const rowHeight = Math.max(minimumRowHeight, Math.max(...linesByCell.map((lines) => lines.length)) * (fontSize + 3) + 10);
      ensure(rowHeight, () => { sectionTitle(`${section.primary}（续）`, section.secondary); drawTableHeader(); });
      page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: rowIndex % 2 ? SOFT : WHITE });
      let x = MARGIN;
      row.forEach((cell, index) => {
        linesByCell[index].forEach((line, lineIndex) => drawText(line, x + 5, y - 13 - lineIndex * (fontSize + 3), fontSize, cell.color ?? INK, widths[index] - 10, cell.align ?? "left"));
        if (index > 0) page.drawLine({ start: { x, y }, end: { x, y: y - rowHeight }, thickness: 0.35, color: HAIRLINE });
        x += widths[index];
      });
      page.drawLine({ start: { x: MARGIN, y: y - rowHeight }, end: { x: A4_WIDTH_POINTS - MARGIN, y: y - rowHeight }, thickness: 0.45, color: LINE });
      y -= rowHeight;
    });
    y -= 11;
  };

  const noteBlocks = (items: Array<{ label: string; text: string }>) => {
    const visible = items.filter((item) => item.text.trim());
    if (!visible.length) return;
    sectionTitle("备注与服务说明", "NOTES & SERVICE INFORMATION");
    for (const item of visible) {
      const lines = wrapText(item.text, font, 7.4, CONTENT_WIDTH - 112);
      const height = Math.max(28, lines.length * 10 + 10);
      ensure(height, () => sectionTitle("备注与服务说明（续）", "NOTES & SERVICE INFORMATION"));
      page.drawRectangle({ x: MARGIN, y: y - height, width: 104, height, color: SOFT, borderColor: LINE, borderWidth: 0.45 });
      page.drawRectangle({ x: MARGIN + 104, y: y - height, width: CONTENT_WIDTH - 104, height, borderColor: LINE, borderWidth: 0.45 });
      drawText(item.label, MARGIN + 7, y - 16, 6.8, BLUE_DARK);
      lines.forEach((line, index) => drawText(line, MARGIN + 111, y - 15 - index * 10, 7.4, INK));
      y -= height;
    }
    y -= 11;
  };

  const signatureBlock = (statementZh: string, statementEn: string) => {
    const zh = wrapText(statementZh, font, 6.5, CONTENT_WIDTH - 14);
    const en = wrapText(statementEn, font, 5.9, CONTENT_WIDTH - 14);
    const statementHeight = Math.max(30, zh.length * 8 + en.length * 7 + 8);
    ensure(statementHeight + 59);
    sectionTitle("确认与签字", "ACKNOWLEDGEMENT & SIGNATURE");
    page.drawRectangle({ x: MARGIN, y: y - statementHeight, width: CONTENT_WIDTH, height: statementHeight, color: SOFT, borderColor: LINE, borderWidth: 0.5 });
    zh.forEach((line, index) => drawText(line, MARGIN + 7, y - 10 - index * 8, 6.5, INK));
    const enStart = y - 10 - zh.length * 8 - 1;
    en.forEach((line, index) => drawText(line, MARGIN + 7, enStart - index * 7, 5.9, MUTED));
    y -= statementHeight + 4;
    const widths = [CONTENT_WIDTH * 0.45, CONTENT_WIDTH * 0.28, CONTENT_WIDTH * 0.27];
    const labels = ["客户签字 / CUSTOMER SIGNATURE", "日期 / DATE", "前台经办 / SERVICE ADVISOR"];
    let x = MARGIN;
    labels.forEach((label, index) => {
      page.drawRectangle({ x, y: y - 32, width: widths[index], height: 32, borderColor: LINE, borderWidth: 0.55 });
      drawText(label, x + 6, y - 27, 5.5, MUTED);
      page.drawLine({ start: { x: x + 6, y: y - 18 }, end: { x: x + widths[index] - 6, y: y - 18 }, thickness: 0.45, color: LINE });
      x += widths[index];
    });
    y -= 38;
  };

  addPage();

  if (input.snapshot.kind === "mechanic_work") {
    const snapshot = input.snapshot;
    infoGrid([
      { label: "BUSINESS ORDER", value: value("facts.orderNo", snapshot.businessOrder.orderNo) },
      { label: "车辆 / VEHICLE", value: value("facts.vehicle", `${snapshot.vehicle.plate} · ${snapshot.vehicle.description}`) },
      { label: "VIN", value: value("facts.vin", snapshot.vehicle.vin ?? "未记录") },
      { label: "维修轮次 / REPAIR ROUND", value: value("facts.repairRound", `第 ${snapshot.repairRound.roundNo} 轮维修`) },
      { label: "维修班组 / TEAM", value: value("facts.team", snapshot.repairRound.teamName ?? "未派单") },
      { label: "单据日期 / DATE", value: documentDate(input.documentNo) },
    ]);
    table(
      { primary: "施工项目", secondary: "WORK ITEMS" },
      ["完成", "类别", "项目名称", "工作说明", "数量"],
      [38, 48, 128, 251, 70],
      snapshot.workItems.map((item, index) => [
        { text: "□", align: "center", color: BLUE_DARK },
        { text: item.kind === "labor" ? "工时" : item.kind === "part" ? "配件" : "其他" },
        { text: value(`workItems.${index}.nameZh`, item.nameZh) },
        { text: value(`workItems.${index}.descriptionZh`, item.descriptionZh ?? "—") || "—" },
        { text: value(`workItems.${index}.quantity`, `${item.quantity} ${item.unitLabelZh}`), align: "right" },
      ]),
    );
    noteBlocks(snapshot.notes.map((note, index) => ({
      label: note.kind === "customer_concern" ? "客户诉求" : note.kind === "work_instruction" ? "施工说明" : "责任与提前告知",
      text: value(`notes.${index}.contentZh`, note.contentZh),
    })));
    sectionTitle("维修回单", "WORK COMPLETION");
    ensure(104);
    page.drawRectangle({ x: MARGIN, y: y - 54, width: CONTENT_WIDTH, height: 54, borderColor: LINE, borderWidth: 0.55 });
    drawText("实际完成内容 / WORK COMPLETED", MARGIN + 7, y - 14, 6.4, MUTED);
    [29, 43].forEach((offset) => page.drawLine({ start: { x: MARGIN + 7, y: y - offset }, end: { x: A4_WIDTH_POINTS - MARGIN - 7, y: y - offset }, thickness: 0.35, color: LINE }));
    y -= 63;
    infoGrid([
      { label: "维修人员签字 / TECHNICIAN", value: " " },
      { label: "完工日期 / DATE", value: " " },
      { label: "前台复核 / REVIEWED BY", value: " " },
    ]);
  } else {
    const snapshot = input.snapshot;
    const order = snapshot.businessOrder;
    infoGrid([
      { label: "BUSINESS ORDER", value: value("facts.orderNo", order.orderNo) },
      { label: "费用承担方 / PAYER", value: value("facts.payer.value", order.payerName) },
      { label: "联系电话 / CONTACT", value: value("facts.contact.value", order.payerPhone ?? "未记录") },
      { label: "车辆 / VEHICLE", value: value("facts.vehicle.value", `${order.plate} · ${order.vehicleDescription}`) },
      { label: "VIN", value: value("facts.vin.value", order.vin ?? "未记录") },
      { label: "TRN", value: value("facts.trn.value", order.payerTrn ?? "未记录") },
    ]);
    table(
      { primary: "收费项目", secondary: "SERVICE CHARGES" },
      ["类别", "项目 / ITEM", "说明 / DESCRIPTION", "数量", "含税单价", "折扣", "小计"],
      [42, 98, 143, 48, 72, 60, 72],
      snapshot.charges.items.map((item, index) => [
        { text: item.kind === "labor" ? "工时\nLABOR" : item.kind === "part" ? "配件\nPART" : "其他\nOTHER", color: MUTED },
        { text: `${value(`charges.items.${index}.nameZh`, item.nameZh)}${item.nameEn ? `\n${item.nameEn}` : ""}` },
        { text: `${value(`charges.items.${index}.descriptionZh`, item.descriptionZh ?? "")}${item.descriptionEn ? `\n${item.descriptionEn}` : ""}` || "—" },
        { text: value(`charges.items.${index}.quantity`, `${item.quantity} ${item.unitLabelZh}`), align: "right" },
        { text: value(`charges.items.${index}.unitPrice`, money(item.unitPriceMinor)), align: "right" },
        { text: value(`charges.items.${index}.discount`, money(item.itemDiscountMinor)), align: "right", color: item.itemDiscountMinor ? BLUE : MUTED },
        { text: value(`charges.items.${index}.subtotal`, money(item.subtotalMinor)), align: "right" },
      ]),
      { fontSize: 6.8, headerSize: 5.7, minimumRowHeight: 27 },
    );

    sectionTitle("结算汇总", "ACCOUNT SUMMARY");
    infoGrid([
      { label: "收费原价 / GROSS", value: money(snapshot.charges.totals.grossMinor) },
      { label: "项目折扣 / DISCOUNT", value: `−${money(snapshot.charges.totals.lineDiscountMinor)}` },
      { label: "折后应收 / AMOUNT DUE", value: value("totals.currentDue", money(snapshot.totals.currentDueMinor)) },
      { label: "累计收款 / PAID", value: value("totals.totalPaid", money(snapshot.totals.totalPaidMinor)) },
      { label: "累计退款 / REFUNDED", value: value("totals.totalRefunded", money(snapshot.totals.totalRefundedMinor)) },
      { label: "未结余额 / BALANCE", value: value("totals.balance", money(snapshot.totals.balanceMinor)) },
    ]);

    if (snapshot.transactions.length) {
      table(
        { primary: "收付款记录", secondary: "PAYMENT HISTORY" },
        ["类型", "编号", "方式", "日期", "备注", "金额"],
        [45, 105, 80, 84, 141, 80],
        snapshot.transactions.map((transaction) => [
          { text: transaction.type === "payment" ? "收款" : "退款", color: transaction.type === "payment" ? BLUE_DARK : MUTED },
          { text: transaction.referenceNo },
          { text: `${transaction.methodLabelZh}${transaction.methodLabelEn ? `\n${transaction.methodLabelEn}` : ""}` },
          { text: transaction.occurredAt.slice(0, 10) },
          { text: transaction.note ?? "—" },
          { text: money(transaction.amountMinor), align: "right" },
        ]),
        { fontSize: 6.8, headerSize: 5.9 },
      );
    }

    noteBlocks(snapshot.charges.notes.map((note, index) => {
      const label = note.kind === "customer_concern" ? "客户诉求" : note.kind === "work_instruction" ? "施工说明" : note.kind === "liability_notice" ? "责任与提前告知" : "内部备注";
      const zh = value(`notes.${index}.contentZh`, note.contentZh ?? "");
      const en = value(`notes.${index}.contentEn`, note.contentEn ?? "");
      return { label, text: [zh, en].filter(Boolean).join("\n") };
    }));
    signatureBlock(
      value("approval.statementZh", snapshot.approval.statementZh),
      value("approval.statementEn", snapshot.approval.statementEn),
    );
  }

  pages.forEach((currentPage, index) => {
    const footer = `Whole Hearted Car Service Limited  ·  ${input.documentNo}  ·  R${input.revisionNo}`;
    currentPage.drawLine({ start: { x: MARGIN, y: 31 }, end: { x: A4_WIDTH_POINTS - MARGIN, y: 31 }, thickness: 0.45, color: LINE });
    currentPage.drawText(footer, { x: MARGIN, y: 19, size: 6.2, font, color: MUTED });
    const pageNo = `${index + 1} / ${pages.length}`;
    currentPage.drawText(pageNo, { x: A4_WIDTH_POINTS - MARGIN - font.widthOfTextAtSize(pageNo, 6.2), y: 19, size: 6.2, font, color: MUTED });
  });
  return document.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: 50 });
}
