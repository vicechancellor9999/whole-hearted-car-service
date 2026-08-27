import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("formal customer license section keeps scan, manual, cancellation, and cleanup controls", () => {
  const section = source("src/components/customers/formal-customer-license-section.tsx");
  expect(section).toContain("扫描{subjectLabel}驾驶证");
  expect(section).toContain("AI 辅助识别");
  expect(section).toContain("对照原件手动填写");
  expect(section).toContain("AbortController");
  expect(section).toContain("revisionRef.current");
  expect(section).toContain("URL.revokeObjectURL");
  expect(section).toContain('capture="environment"');
  expect(section).toContain('placeholder="YYYY-MM-DD"');
  expect(section).toContain("validIsoBirthDate");
});

test("formal customer dialog allows missing identities and separates company contact address", () => {
  const dialog = source("src/components/customers/formal-customer-create-dialog.tsx");
  expect(dialog).toContain("手机号、TRN 或驾驶证暂缺时仍可建档");
  expect(dialog).not.toContain("个人客户至少填写手机号或 TRN");
  expect(dialog).toContain("联系人证件地址不会覆盖公司通讯地址");
  expect(dialog).toContain("当前缺项摘要");
});
