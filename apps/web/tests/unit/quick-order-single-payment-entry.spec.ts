import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("Business Order 详情只在财务结算板块保留一个收款入口", () => {
  const source = readFileSync("src/components/orders/quick-order-detail.tsx", "utf8");
  expect(source).not.toContain('data-testid="quick-completion-pay"');
  expect(source.match(/data-testid="quick-action-pay-open"/g)).toHaveLength(1);
});
