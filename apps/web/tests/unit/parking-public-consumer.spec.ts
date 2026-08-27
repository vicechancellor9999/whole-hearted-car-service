import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("public parking consumers cannot reach the retired quick-parking or canonical-alias surfaces", () => {
  const workspace = source("src/components/parking/parking-workspace.tsx");
  const legacyInvoicePage = source("src/app/parking/[caseId]/invoice/page.tsx");
  const retiredMockImport = /lib\/api\/mock-/;

  for (const equivalentBypass of [
    'from "@/lib/api/mock-parking"',
    'from "../../lib/api/mock-billing"',
  ]) {
    expect(equivalentBypass).toMatch(retiredMockImport);
  }
  expect(workspace).not.toMatch(retiredMockImport);
  expect(workspace).not.toMatch(/getMockLinkedOperationsStore|collectMockCanonicalParkingPayment|getMockCanonicalParkingList/);
  expect(workspace).not.toMatch(/canonicalList|recordCanonicalPayment|\/api\/parking\/canonical/);
  expect(workspace).toMatch(/api\.parking\.list\s*\(/);
  expect(workspace).toMatch(/api\.parking\.recordPayment\s*\(/);
  expect(workspace).toMatch(/api\.parking\.previewWaiver\s*\(/);
  expect(workspace).toMatch(/api\.parking\.applyWaiver\s*\(/);
  expect(legacyInvoicePage).not.toMatch(retiredMockImport);
  expect(legacyInvoicePage).not.toMatch(/api\.parking\.invoice|\/api\/parking\/canonical/);
});

test("Quick detail cannot emit retired physical-pickup actions", () => {
  const detail = source("src/components/orders/quick-order-detail.tsx");

  expect(detail).not.toMatch(/kind:\s*["']record_pickup["']/);
  expect(detail).not.toMatch(/kind:\s*["']cancel_pickup["']/);
});
