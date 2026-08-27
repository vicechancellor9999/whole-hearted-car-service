import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const WORKSPACE_PATH = "src/components/orders/business-orders-workspace.tsx";
const DETAIL_PATH = "src/components/orders/quick-order-detail.tsx";

test("QuickOrder list and detail consume only the public authoritative financial read models", () => {
  const workspace = source(WORKSPACE_PATH);
  const detail = source(DETAIL_PATH);

  for (const consumer of [workspace, detail]) {
    expect(consumer).not.toMatch(/lib\/api\/mock-/);
    expect(consumer).not.toMatch(/\bquickOrderFinance\b/);
  }
  expect(detail).not.toMatch(/\bisQuickOrderCompleted\b/);

  expect(workspace).toMatch(/api\.quickOrders\.list\s*\(/);
  expect(workspace).toMatch(/api\.quickOrderFinancials\.list\s*\(/);
  expect(detail).toMatch(/api\.quickOrders\.detail\s*\(/);
  expect(detail).toMatch(/api\.quickOrders\.list\s*\(/);
  expect(detail).toMatch(/api\.quickOrderFinancials\.detail\s*\(/);
  expect(detail).toMatch(/api\.quickOrderFinancials\.preflight\s*\(/);
});

test("four lifecycle controls use the finance-free lifecycle surface while other Quick actions remain operational", () => {
  const detail = source(DETAIL_PATH);

  for (const retiredKind of ["void", "restore", "record_paid_full", "cancel_paid_full"]) {
    const broadLifecycle = new RegExp(
      `api\\.quickOrders\\.action\\s*\\([\\s\\S]{0,220}kind:\\s*["']${retiredKind}["']`,
    );
    expect(detail, `${retiredKind} must not use the broad Quick action route`).not.toMatch(broadLifecycle);
  }
  expect(detail).toMatch(/api\.quickOrderFinancials\.lifecycle\s*\(/);
  expect(detail, "one helper must derive lifecycle availability only from preflight").toMatch(
    /(?:function\s+lifecycleAllowed|const\s+lifecycleAllowed)[\s\S]{0,300}preflight\?\.allowedKinds\.includes\(\s*kind\s*\)/,
  );
  for (const [lifecycleKind, testId] of [
    ["void", "quick-action-void-open"],
    ["restore", "quick-action-restore"],
    ["record_paid_full", "quick-action-record-paid-full"],
    ["cancel_paid_full", "quick-action-cancel-paid-full"],
  ] as const) {
    expect(detail, `${lifecycleKind} button must be directly gated by lifecycleAllowed`).toMatch(
      new RegExp(
        `lifecycleAllowed\\s*\\(\\s*["']${lifecycleKind}["']\\s*\\)[\\s\\S]{0,500}data-testid=["']${testId}["']`,
      ),
    );
  }

  // The cutover is deliberately narrow: status, assignment, mileage, and
  // other operational actions continue through the existing broad surface.
  for (const retainedKind of [
    "assign", "accept", "return", "stall", "submit", "record_mileage",
  ]) {
    expect(detail).toMatch(new RegExp(
      `api\\.quickOrders\\.action\\s*\\([\\s\\S]{0,220}kind:\\s*["']${retainedKind}["']`,
    ));
  }
});

test("both consumers clear and generation-fence composed reads on storage and popstate session signals", () => {
  for (const path of [WORKSPACE_PATH, DETAIL_PATH]) {
    const consumer = source(path);
    expect(consumer, path).toMatch(/currentSessionKey\s*\(/);
    expect(consumer, path).toMatch(/addEventListener\(\s*["']storage["']/);
    expect(consumer, path).toMatch(/\.key\s*(?:===|!==)\s*["']wh_session["']/);
    expect(consumer, path).toMatch(/addEventListener\(\s*["']popstate["']/);
    expect(consumer, path).toMatch(/(?:generation|requestEpoch|requestGeneration|requestId)/i);
  }
});
