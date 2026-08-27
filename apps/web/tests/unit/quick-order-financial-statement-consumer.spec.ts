import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DETAIL_PATH = "src/components/orders/quick-order-detail.tsx";
const PRINT_PATH = "src/components/orders/quick-order-print.tsx";
const PDF_SECTION_PATH = "src/components/orders/quick-invoice-pdf-section.tsx";
const PDF_DOMAIN_PATH = "src/lib/orders/quick-invoice-pdf.ts";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const CURRENT_RESPONSE_GUARD = /if\s*\(\s*!responseIsCurrent\s*\(\s*capturedSessionKey\s*,\s*generation\s*\)\s*\)\s*return\s*;/;

function loaderFinallyBlock(consumer: string, loaderCall: string): Readonly<{
  body: string;
  bodyStart: number;
  bodyEnd: number;
}> {
  const loaderIndex = consumer.indexOf(loaderCall);
  if (loaderIndex < 0) throw new Error(`${loaderCall} loader is missing`);
  const effectCleanupIndex = consumer.indexOf("return () =>", loaderIndex);
  const finallyIndex = consumer.indexOf(".finally(() =>", loaderIndex);
  if (finallyIndex < 0 || (effectCleanupIndex >= 0 && finallyIndex > effectCleanupIndex)) {
    throw new Error(`${loaderCall} finally is missing from its load effect`);
  }
  const bodyStart = consumer.indexOf("{", finallyIndex);
  if (bodyStart < 0) throw new Error(`${loaderCall} finally body is missing`);
  let depth = 0;
  for (let index = bodyStart; index < consumer.length; index += 1) {
    if (consumer[index] === "{") depth += 1;
    if (consumer[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) {
      return {
        body: consumer.slice(bodyStart + 1, index),
        bodyStart: bodyStart + 1,
        bodyEnd: index,
      };
    }
  }
  throw new Error(`${loaderCall} finally body is unterminated`);
}

function assertLoaderFinallyFence(consumer: string, loaderCall: string): void {
  const { body } = loaderFinallyBlock(consumer, loaderCall);
  const loadingIndex = body.indexOf("setLoading(false)");
  if (loadingIndex < 0) throw new Error(`${loaderCall} finally does not clear loading`);
  const guardMatch = CURRENT_RESPONSE_GUARD.exec(body);
  if (!guardMatch || guardMatch.index >= loadingIndex) {
    throw new Error(`${loaderCall} finally clears loading before its current response guard`);
  }
}

function replaceLoaderFinallyGuard(
  consumer: string,
  loaderCall: string,
  replacement: string,
): string {
  const block = loaderFinallyBlock(consumer, loaderCall);
  const guardMatch = CURRENT_RESPONSE_GUARD.exec(block.body);
  if (!guardMatch) throw new Error(`${loaderCall} guard is missing before mutation`);
  const guardStart = block.bodyStart + guardMatch.index;
  const guardEnd = guardStart + guardMatch[0].length;
  return consumer.slice(0, guardStart) + replacement + consumer.slice(guardEnd);
}

test("Quick Detail joins statement into the authoritative composite and renders no raw embedded finance history", () => {
  const detail = source(DETAIL_PATH);

  expect(detail).toMatch(/api\.quickOrderFinancials\.statement\s*\(\s*orderId\s*\)/);
  expect(detail).toMatch(/statement\s*:\s*QuickOrderFinancialStatement/);
  expect(detail).toMatch(/statement\.order\.id\s*!==\s*orderId|statement\.order\.id\s*===\s*orderId/);
  expect(detail).toMatch(/statement\.revision\s*!==\s*financial\.revision|statement\.revision\s*===\s*financial\.revision/);
  expect(detail).toMatch(/setStatement\s*\(\s*(?:snapshot\.)?statement\s*\)/);
  expect(detail).toMatch(/setStatement\s*\(\s*null\s*\)/);

  expect(detail).not.toMatch(/order\.payments\.map\s*\(/);
  expect(detail).not.toMatch(/order\.refunds\.map\s*\(/);
  expect(detail).not.toMatch(/\(order\.payments\.length\s*>\s*0\s*\|\|\s*order\.refunds\.length\s*>\s*0\)/);
  expect(detail).toMatch(/statement\.entries\.map\s*\(/);
  expect(detail).toMatch(/应收冲减/);
  expect(detail).toMatch(/实际退还现金/);
  expect(detail).toMatch(/cashRefundJmd\s*>\s*0/);

  // 6C has not added a durable canonical receipt. Only compatibility entries
  // may expose the historical refund receipt/signature affordances.
  expect(detail).toMatch(
    /(?:function|const)\s+\w*[Ll]egacy\w*[Rr]eceipt\w*[\s\S]{0,320}accounting\s*===\s*["']legacy_cash_only["']/,
  );
  expect(detail).not.toMatch(
    /accounting\s*===\s*["']canonical_line_v1["'][\s\S]{0,500}quick-refund-print/,
  );
  expect(detail).not.toMatch(
    /accounting\s*===\s*["']canonical_line_v1["'][\s\S]{0,500}quick-refund-sign/,
  );
});

test("Quick Print uses statement for customer and office copies while technician remains finance-free", () => {
  const print = source(PRINT_PATH);

  expect(print).toMatch(/api\.quickOrderFinancials\.statement\s*\(\s*orderId\s*\)/);
  expect(print).toMatch(/(?:needsStatement|requiresStatement|customerFinancialCopy)\s*=\s*copy\s*!==\s*["']technician["']/);
  expect(print).toMatch(
    /(?:needsStatement|requiresStatement|customerFinancialCopy)[\s\S]{0,500}api\.quickOrderFinancials\.statement/,
  );
  expect(print).not.toMatch(/\bquickOrderFinance\b/);
  expect(print).not.toMatch(/order\.payments\.map\s*\(/);
  expect(print).not.toMatch(/order\.refunds\.map\s*\(/);
  expect(print).toMatch(/statement\.charges/);
  expect(print).toMatch(/statement\.ledger/);
  expect(print).toMatch(/statement\.entries/);

  expect(print).toMatch(/canonical_invoice[\s\S]{0,500}(?:invoiceNo|Invoice)/);
  expect(print).toMatch(/shared_uninvoiced[\s\S]{0,500}(?:暂记|临时|Provisional Business Order)/i);
  expect(print).toMatch(/legacy_quick[\s\S]{0,500}(?:旧版|Legacy)/i);
  expect(print).toMatch(/cashRefundJmd\s*>\s*0/);
  expect(print).toMatch(/应收冲减|Receivable reduction/);
  expect(print).toMatch(/实际退还现金|Cash returned/);
});

test("Quick Detail and Quick Print clear and generation-fence statement/customer composites on both session signals", () => {
  for (const path of [DETAIL_PATH, PRINT_PATH]) {
    const consumer = source(path);
    expect(consumer, path).toMatch(/currentSessionKey\s*\(/);
    expect(consumer, path).toMatch(/addEventListener\(\s*["']storage["']/);
    expect(consumer, path).toMatch(/\.key\s*(?:===|!==)\s*["']wh_session["']/);
    expect(consumer, path).toMatch(/addEventListener\(\s*["']popstate["']/);
    expect(consumer, path).toMatch(/(?:generation|requestEpoch|requestGeneration|requestId)/i);
    expect(consumer, path).toMatch(/setStatement\s*\(\s*null\s*\)/);
  }
});

test("Quick Detail and Quick Print finally blocks guard loading state by current session and generation", () => {
  for (const { path, loaderCall } of [
    { path: DETAIL_PATH, loaderCall: "void readAuthoritativeSnapshot()" },
    { path: PRINT_PATH, loaderCall: "void readSnapshot()" },
  ] as const) {
    const consumer = source(path);
    expect(() => assertLoaderFinallyFence(consumer, loaderCall), `${path} current finally`).not.toThrow();

    const missingGuard = replaceLoaderFinallyGuard(consumer, loaderCall, "");
    expect(
      () => assertLoaderFinallyFence(missingGuard, loaderCall),
      `${path} deleted finally guard mutant`,
    ).toThrow();

    const wrongGeneration = replaceLoaderFinallyGuard(
      consumer,
      loaderCall,
      "if (!responseIsCurrent(capturedSessionKey, generation + 1)) return;",
    );
    expect(
      () => assertLoaderFinallyFence(wrongGeneration, loaderCall),
      `${path} wrong-generation finally guard mutant`,
    ).toThrow();
  }
});

test("Invoice PDF runtime is browser-local and accepts only a validated statement plus session-bound identity projection", () => {
  const detail = source(DETAIL_PATH);
  const section = source(PDF_SECTION_PATH);
  const domain = source(PDF_DOMAIN_PATH);

  expect(domain).toMatch(/from\s+["']pdf-lib["']/);
  expect(domain).toMatch(/export\s+interface\s+QuickInvoicePdfSource/);
  expect(domain).toMatch(/export\s+async\s+function\s+buildQuickInvoicePdf/);
  expect(domain).toMatch(/statement\s*:\s*QuickOrderFinancialStatement/);
  expect(domain).not.toMatch(/storageSnapshot|localStorage|sessionStorage|mutationReceipts|rawStrokes/);

  expect(section).toMatch(/createQuickInvoicePdfGenerationCache\s*\(\s*buildQuickInvoicePdf\s*\)/);
  expect(section).toMatch(/\.load\s*\(\s*source/);
  expect(section).toMatch(/statement\s*[:=]/);
  expect(section).toMatch(/customer\s*[:=]/);
  expect(section).toMatch(/vehicle\s*[:=]/);
  expect(section).not.toMatch(/storageSnapshot/);
  expect(section).not.toMatch(/window\.localStorage|window\.sessionStorage/);
  expect(section).not.toMatch(/["']\/api\/pdf\/invoice["']/);
  expect(section).not.toMatch(/startsWith\(\s*["']wh_/);

  expect(detail).toMatch(/<QuickInvoicePdfSection[\s\S]{0,500}statement=/);
  expect(detail).toMatch(/<QuickInvoicePdfSection[\s\S]{0,500}customer=/);
  expect(detail).toMatch(/<QuickInvoicePdfSection[\s\S]{0,500}vehicle=/);
});
