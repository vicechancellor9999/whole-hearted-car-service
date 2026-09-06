import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import type { FormalInspectionDocument } from "./formal-inspection-document";

const W = 595.28, H = 841.89, M = 36, BOTTOM = 52, WIDTH = W - M * 2;
const BLUE = rgb(0.08, 0.22, 0.42), INK = rgb(0.09, 0.13, 0.2), SOFT = rgb(0.38, 0.43, 0.5), LINE = rgb(0.82, 0.86, 0.9);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  const closingPunctuation = /^[。，；：！？、）】》」』”’…]/u;
  for (const paragraph of text.replaceAll("\r\n", "\n").split("\n")) {
    let line = "";
    for (const token of paragraph.match(/[^\s\u3400-\u9fff]+|[\u3400-\u9fff]|\s+/gu) ?? []) {
      if (line && !closingPunctuation.test(token) && font.widthOfTextAtSize(line + token, size) > width) { lines.push(line.trimEnd()); line = ""; }
      if (!line && !token.trim()) continue;
      for (const character of token) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) {
          const preceding = Array.from(line);
          let carry = "";
          if (closingPunctuation.test(character)) {
            // Move the preceding character together with any closing marks,
            // keeping the punctuation attached without exceeding the margin.
            do { carry = preceding.pop()! + carry; } while (preceding.length > 1 && closingPunctuation.test(carry));
          }
          if (preceding.length) { lines.push(preceding.join("").trimEnd()); line = carry; }
          else { lines.push(line.trimEnd()); line = ""; }
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Complete formal report rendering; text is fragmented, never truncated at page boundaries. */
export async function renderFormalInspectionPdf(model: FormalInspectionDocument, assets: { fontBytes: Uint8Array; logoBytes: Uint8Array }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(assets.fontBytes, { subset: false });
  const logo = await pdf.embedPng(assets.logoBytes);
  pdf.setTitle(`${model.reportNo} - ${model.title}`);
  pdf.setAuthor(model.company.legalName);
  pdf.setProducer("Whole Hearted formal-inspection-a4-v3");
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const draw = (value: string, x: number, baseline: number, size = 9, color = INK) => page.drawText(value, { x, y: baseline, size, font, color });
  const fitted = (value: string, size: number, width: number) => Math.min(size, width / Math.max(1, font.widthOfTextAtSize(value, 1)));
  const right = (value: string, edge: number, baseline: number, size: number, width: number) => {
    const actual = fitted(value, size, width);
    draw(value, edge - font.widthOfTextAtSize(value, actual), baseline, actual);
  };
  const nextPage = () => {
    page = pdf.addPage([W, H]); y = H - M;
    draw(model.reportNo, M, y, 8, SOFT);
    right(model.title, W - M, y, 8, WIDTH - 145);
    y -= 23;
  };
  const ensure = (height: number) => { if (y - height < BOTTOM) nextPage(); };
  const paragraph = (text: string, size = 9, color = INK) => {
    for (const line of wrap(text, font, size, WIDTH)) { ensure(size * 1.5); draw(line, M, y, size, color); y -= size * 1.5; }
    y -= 3;
  };
  const heading = (text: string) => {
    ensure(45); y -= 6;
    paragraph(text, 10.5, BLUE);
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, color: LINE, thickness: 0.7 });
    y -= 4;
  };
  const totalHeight = (label: string, prominent = false) => Math.max(prominent ? 28 : 20, wrap(label, font, prominent ? 11 : 9, WIDTH - 180).length * 12 + 8);
  const total = (label: string, amount: string, prominent = false) => {
    const size = prominent ? 11 : 9;
    const labels = wrap(label, font, size, WIDTH - 180);
    const height = totalHeight(label, prominent);
    ensure(height);
    page.drawRectangle({ x: M, y: y - height + 5, width: WIDTH, height, color: prominent ? rgb(0.9, 0.94, 0.99) : rgb(0.96, 0.97, 0.98) });
    labels.forEach((line, i) => draw(line, M + 7, y - 9 - i * 14, size, BLUE));
    right(amount, W - M - 7, y - 9, prominent ? 15 : 10, 165);
    y -= height + (prominent ? 5 : 2);
  };

  page.drawImage(logo, { x: M, y: y - 33, width: 40, height: 40 });
  draw(model.company.legalName, M + 52, y - 2, 14, BLUE);
  draw(model.company.address, M + 52, y - 17, 8, SOFT);
  draw(model.company.contactLine, M + 52, y - 30, 7.5, SOFT);
  y -= 51;
  paragraph(model.title, 13, BLUE);
  paragraph(model.reportNo, 9, SOFT);
  for (const [label, value] of model.identity) paragraph(`${label}: ${value}`, 9);
  heading(model.conclusionTitle); paragraph(model.conclusion);
  if (model.findings.length) { heading(model.findingsTitle); model.findings.forEach((finding) => paragraph(finding)); }
  heading(model.quotationTitle);
  if (model.note) paragraph(model.note, 9, SOFT);
  // Widths are fixed on A4; numeric cells are fitted, never wrapped across lines.
  const widths = [99, 126, 31, 25, 85, 76, WIDTH - 442];
  for (const group of model.groups) {
    const tableHeader = () => {
      const headerLines = model.columns.map((label, i) => wrap(label, font, 6.5, widths[i] - 8));
      const labelLines = wrap(group.label, font, 10, WIDTH - 14);
      const labelHeight = labelLines.length * 14 + 10;
      const headerHeight = Math.max(...headerLines.map((lines) => lines.length)) * 10 + 12;
      ensure(labelHeight + headerHeight + 30);
      page.drawRectangle({ x: M, y: y - labelHeight + 5, width: WIDTH, height: labelHeight, color: rgb(0.91, 0.95, 1) });
      labelLines.forEach((line, i) => draw(line, M + 6, y - 9 - i * 14, 10, BLUE)); y -= labelHeight;
      page.drawRectangle({ x: M, y: y - headerHeight + 5, width: WIDTH, height: headerHeight, color: BLUE });
      let x = M;
      headerLines.forEach((lines, i) => { lines.forEach((line, j) => draw(line, x + 4, y - 7 - j * 10, 6.5, rgb(1, 1, 1))); x += widths[i]; });
      y -= headerHeight;
    };
    tableHeader();
    for (const [rowIndex, row] of group.rows.entries()) {
      const cells = row.map((value, i) => i < 2 ? wrap(value, font, 8, widths[i] - 8) : [value]);
      const expandedDescription = cells[1].length > 6;
      if (expandedDescription) cells[1] = wrap(model.language === "en" ? "Details below" : model.language === "bilingual" ? "详见下方说明 / Details below" : "详见下方说明", font, 8, widths[1] - 8);
      let offset = 0;
      const count = Math.max(...cells.map((lines) => lines.length));
      while (offset < count) {
        if (y - 28 < BOTTOM) { nextPage(); tableHeader(); }
        const take = Math.min(count - offset, Math.max(1, Math.floor((y - BOTTOM - 12) / 12)));
        const height = take * 12 + 12;
        let x = M;
        cells.forEach((lines, i) => {
          if (i < 2) lines.slice(offset, offset + take).forEach((line, j) => draw(line, x + 4, y - 8 - j * 12, 8, i === 1 ? SOFT : INK));
          else if (offset === 0) right(row[i], x + widths[i] - 4, y - 8, 7.5, widths[i] - 8);
          x += widths[i];
        });
        y -= height;
        page.drawLine({ start: { x: M, y: y + 5 }, end: { x: W - M, y: y + 5 }, color: LINE, thickness: 0.5 });
        offset += take;
      }
      if (expandedDescription) {
        // Keep long prose readable across the paper width, independently of
        // the one-time priced row. Every continuation has an item reference.
        const description = wrap(row[1], font, 8.5, WIDTH - 16);
        const identity = wrap(`${rowIndex + 1}. ${row[0]}`, font, 9, WIDTH - 16);
        const continued = model.language === "en" ? "Continued" : model.language === "bilingual" ? "续 / Continued" : "续";
        let start = 0;
        while (start < description.length) {
          // The full item name is already preserved in the priced row; a
          // numbered compact reference keeps unusually long names bounded.
          const reference = identity.slice(0, 2);
          if (identity.length > 2) reference[1] += " ...";
          const headerHeight = reference.length * 13 + 20;
          ensure(headerHeight + 24);
          page.drawRectangle({ x: M, y: y - headerHeight + 5, width: WIDTH, height: headerHeight, color: rgb(0.96, 0.97, 0.98) });
          reference.forEach((line, index) => draw(line, M + 8, y - 8 - index * 13, 9, BLUE));
          draw(`${model.columns[1]}${start ? ` (${continued})` : ""}`, M + 8, y - headerHeight + 10, 7.5, SOFT);
          y -= headerHeight + 3;
          const take = Math.min(description.length - start, Math.max(1, Math.floor((y - BOTTOM - 8) / 12)));
          description.slice(start, start + take).forEach((line, index) => draw(line, M + 8, y - 8 - index * 12, 8.5, SOFT));
          y -= take * 12 + 10;
          start += take;
          if (start < description.length) nextPage();
        }
      }
    }
    total(`${group.label} - ${group.totalLabel}`, group.total);
    y -= 7;
  }
  const signatureWidth = (WIDTH - 30) / 2;
  const signatureLines = model.signatures.map((label) => wrap(label, font, 8, signatureWidth));
  const signatureDepth = 22 + 13 + (Math.max(...signatureLines.map((lines) => lines.length)) - 1) * 12;
  const totalsDepth = (model.groups.length ? model.totals.reduce((sum, [label]) => sum + totalHeight(label) + 2, 0) : 0) + totalHeight(model.totalLabel, true) + 5;
  const notesDepth = model.notes ? 6 + wrap(model.notesTitle, font, 10.5, WIDTH).length * 15.75 + 7 + wrap(model.notes, font, 9, WIDTH).length * 13.5 + 3 : 0;
  const closingDepth = totalsDepth + notesDepth + signatureDepth;
  // A signature belongs with the amount and responsibilities being confirmed.
  // Keep a normal closing block together; very long notes can still paginate.
  if (closingDepth <= H - M - 23 - BOTTOM) ensure(closingDepth);
  if (model.groups.length) for (const [label, amount] of model.totals) total(label, amount);
  total(model.totalLabel, model.total, true);
  if (model.notes) { heading(model.notesTitle); paragraph(model.notes); }
  // The final signature has no following body block; reserve its actual last
  // baseline above the footer instead of an additional paragraph's padding.
  if (y - signatureDepth < 42) nextPage();
  y -= 22;
  signatureLines.forEach((lines, index) => {
    const x = M + index * (signatureWidth + 30);
    page.drawLine({ start: { x, y }, end: { x: x + signatureWidth, y }, color: SOFT, thickness: 0.5 });
    lines.forEach((line, i) => draw(line, x, y - 13 - i * 12, 8, SOFT));
  });
  const pages = pdf.getPages();
  pages.forEach((sheet, i) => {
    sheet.drawText(`${model.reportNo}  |  ${i + 1} / ${pages.length}`, { x: M, y: 25, size: 7, font, color: SOFT });
  });
  return pdf.save();
}
