import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { BusinessOrderDocumentRenderSnapshot } from "@formal/db/schema/business-order-document";
import {
  applyDocumentOverrides,
  buildBusinessOrderDocumentContent,
  validateDocumentOverrides,
  type BusinessOrderDocumentField,
} from "@formal/modules/business-order/business-order-document-content";

export const BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION = "bo-a4-v3";
export const A4_WIDTH_POINTS = 595.28;
export const A4_HEIGHT_POINTS = 841.89;
const MARGIN = 28.35;
const CONTENT_WIDTH = A4_WIDTH_POINTS - MARGIN * 2;
const BOTTOM = MARGIN + 22;
const SECTION_GAP = 11;

export type RenderBusinessOrderDocumentPdfInput = {
  documentNo: string;
  revisionNo: number;
  snapshot: BusinessOrderDocumentRenderSnapshot;
  fieldOverrides: Record<string, string>;
};

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replaceAll("\r\n", "\n").split("\n")) {
    if (!paragraph) { lines.push(""); continue; }
    let line = "";
    for (const character of paragraph) {
      const next = `${line}${character}`;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

function labelForSection(section: BusinessOrderDocumentField["section"]): string {
  return {
    header: "",
    facts: "业务资料",
    charges: "收费 / 施工项目",
    transactions: "收付款",
    notes: "备注与提前告知",
    approval: "签字确认",
    footer: "",
  }[section];
}

export async function renderBusinessOrderDocumentPdf(
  input: RenderBusinessOrderDocumentPdfInput,
): Promise<Uint8Array> {
  const overrides = validateDocumentOverrides(input.snapshot, input.fieldOverrides);
  const content = applyDocumentOverrides(buildBusinessOrderDocumentContent(input.snapshot), overrides);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const fixedDate = new Date("2000-01-01T00:00:00.000Z");
  document.setTitle(`${input.documentNo}-R${input.revisionNo}`);
  document.setAuthor("Whole Hearted Car Service Limited");
  document.setSubject("Business Order formal document");
  document.setCreator(BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION);
  document.setProducer(BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION);
  document.setCreationDate(fixedDate);
  document.setModificationDate(fixedDate);
  const fontBytes = await readFile(path.join(process.cwd(), "apps/web/public/fonts/NotoSansSC-Regular-wh.ttf"));
  const logoBytes = await readFile(path.join(process.cwd(), "apps/web/public/logo-icon.png"));
  // pdf-lib/fontkit subsetting corrupts glyph advances for this bilingual
  // NotoSansSC build. Full embedding keeps Chinese and Latin text printable.
  const font = await document.embedFont(Uint8Array.from(fontBytes), { subset: false });
  const logo = await document.embedPng(Uint8Array.from(logoBytes));
  const pages: PDFPage[] = [];
  let page = document.addPage([A4_WIDTH_POINTS, A4_HEIGHT_POINTS]);
  pages.push(page);
  let y = A4_HEIGHT_POINTS - MARGIN;
  let currentSection: BusinessOrderDocumentField["section"] | null = null;

  const addPage = () => {
    page = document.addPage([A4_WIDTH_POINTS, A4_HEIGHT_POINTS]);
    pages.push(page);
    y = A4_HEIGHT_POINTS - MARGIN;
  };
  const ensure = (height: number) => {
    if (y - height < BOTTOM) addPage();
  };
  const drawLine = (text: string, size: number, color = rgb(0.12, 0.15, 0.2), indent = 0) => {
    const lineHeight = size * 1.55;
    for (const line of wrapText(text, font, size, CONTENT_WIDTH - indent)) {
      ensure(lineHeight);
      page.drawText(line || " ", { x: MARGIN + indent, y, size, font, color });
      y -= lineHeight;
    }
  };

  for (const item of content.fields) {
    if (item.section === "header") {
      if (item.key === "header.company") {
        const scaled = logo.scaleToFit(38, 38);
        page.drawImage(logo, { x: MARGIN, y: y - 28, width: scaled.width, height: scaled.height });
        page.drawText(item.value, { x: MARGIN + 48, y: y - 2, size: 15, font, color: rgb(0.08, 0.18, 0.42) });
        y -= 48;
      } else if (item.key === "header.title") {
        drawLine(item.value, 17, rgb(0.08, 0.18, 0.42));
        page.drawText(`${input.documentNo} · R${input.revisionNo}`, { x: MARGIN, y, size: 8.5, font, color: rgb(0.38, 0.43, 0.5) });
        y -= 18;
      } else {
        drawLine(item.value, 8.5, rgb(0.38, 0.43, 0.5));
      }
      continue;
    }
    if (currentSection !== item.section) {
      currentSection = item.section;
      const sectionLabel = labelForSection(item.section);
      if (sectionLabel) {
        ensure(30);
        y -= SECTION_GAP;
        page.drawText(sectionLabel, { x: MARGIN, y, size: 11, font, color: rgb(0.12, 0.32, 0.68) });
        y -= 8;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH_POINTS - MARGIN, y }, thickness: 0.7, color: rgb(0.72, 0.78, 0.88) });
        y -= 13;
      }
    }
    if (!item.value.trim()) continue;
    if (item.multiline) {
      ensure(44);
      page.drawText(item.editorLabel, { x: MARGIN, y, size: 7.5, font, color: rgb(0.42, 0.46, 0.52) });
      y -= 12;
      drawLine(item.value, 9.5, rgb(0.12, 0.15, 0.2), 4);
      y -= 5;
    } else {
      const labelWidth = 112;
      const valueLines = wrapText(item.value, font, 9.5, CONTENT_WIDTH - labelWidth);
      const rowHeight = Math.max(18, valueLines.length * 14.5);
      ensure(rowHeight);
      page.drawText(item.editorLabel, { x: MARGIN, y, size: 7.5, font, color: rgb(0.42, 0.46, 0.52) });
      valueLines.forEach((line, index) => page.drawText(line || " ", {
        x: MARGIN + labelWidth,
        y: y - index * 14.5,
        size: 9.5,
        font,
        color: rgb(0.12, 0.15, 0.2),
      }));
      y -= rowHeight;
    }
  }

  pages.forEach((currentPage, index) => {
    const footer = `${input.documentNo} · R${input.revisionNo} · ${index + 1} / ${pages.length}`;
    currentPage.drawText(footer, { x: MARGIN, y: MARGIN - 2, size: 7.5, font, color: rgb(0.48, 0.52, 0.58) });
  });
  return document.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: 50 });
}
