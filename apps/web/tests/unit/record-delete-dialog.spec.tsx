import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const source = readFileSync(
  resolve(process.cwd(), "src/components/shared/record-delete-dialog.tsx"),
  "utf8",
);

test("record deletion dialog keeps the approved labels and two-step controls", () => {
  // The action label now distinguishes untouched, pending, and completed requests.
  // Its rendered states are exercised by record-delete-recovery.test.tsx.
  expect(source).toContain('deletionResult ? "查看删除结果" : submittedDelete ? "查看删除进度" : "删除"');
  expect(source).toContain("确认删除");
  expect(source).toContain("当前记录无法删除");
  expect(source).toContain("selectableLinkedRecords");
  expect(source).toContain('type="checkbox"');
  expect(source).toContain("重复创建");
  expect(source).toContain("录入错误");
  expect(source).toContain("测试数据");
  expect(source).toContain("其他");
  expect(source).toContain("confirmationRecordNo");
});

test("record deletion dialog retains stale-preview and navigation recovery wiring", () => {
  // Account verification moved to a shared hook; role/identity behavior is
  // covered through rendered components in record-delete-recovery.test.tsx.
  expect(source).toContain('error.code === "DELETION_PREVIEW_STALE"');
  expect(source).toContain("router.push(returnTo)");
  expect(source).toContain('role="alert"');
  expect(source).toContain("returnFocusElement");
});
