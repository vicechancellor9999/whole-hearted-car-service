import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/orders/quick-order-detail.tsx"),
  "utf8",
);

test("售后在原 Business Order 开始下一维修轮次", () => {
    expect(source).toContain("售后回厂：开始下一轮");
    expect(source).not.toContain("跨月处理：开售后单 / 对冲单");
    expect(source).not.toContain("开售后单");
    expect(source).not.toContain("开对冲单");
});

test("接车里程在详情上方直接输入，不再打开弹窗", () => {
    expect(source).toContain('data-testid="quick-mileage-inline-input"');
    expect(source).toContain('data-testid="quick-mileage-inline-save"');
    expect(source).not.toContain('data-testid="quick-action-mileage-open"');
});
