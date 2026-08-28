import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const source = readFileSync(
  resolve(process.cwd(), "src/components/shared/record-delete-dialog.tsx"),
  "utf8",
);

test("record deletion dialog keeps the approved labels and two-step controls", () => {
  expect(source).toContain('>删除<');
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

test("record deletion button waits for formal role and handles stale previews", () => {
  expect(source).toContain('/api/formal/auth/session');
  expect(source).toContain('role === "super_admin" || role === "front_desk"');
  expect(source).toContain('error.code === "DELETION_PREVIEW_STALE"');
  expect(source).toContain("router.push(returnTo)");
  expect(source).toContain('role="alert"');
  expect(source).toContain("returnFocusElement");
});
