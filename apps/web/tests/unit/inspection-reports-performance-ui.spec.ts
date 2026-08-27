import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("检查结果列表由后端分页筛选，不再在浏览器串行拉取全部分页", () => {
  const workspace = source("src/components/orders/inspection-reports-workspace.tsx");

  expect(workspace).not.toMatch(/for \(let page = 2; page <= firstPage\.totalPages/);
  expect(workspace).toMatch(/pageSize:\s*25/);
  expect(workspace).toMatch(/communication:\s*bucket/);
  expect(workspace).toMatch(/setSearchDraft/);
  expect(workspace).toMatch(/inspection-reports-pagination/);
});

test("经营概览直接读取后端跟进汇总，不再逐页拉取全部检查结果", () => {
  const reminders = source("src/components/orders/ir-followup-reminders.tsx");

  expect(reminders).not.toMatch(/for \(let page = 2; page <= firstPage\.totalPages/);
  expect(reminders).toMatch(/pageSize:\s*1/);
  expect(reminders).toMatch(/result\.followUpCounts/);
});

test("检查结果 PDF 生成器只在实际生成文件时加载，不进入全站公共首屏", () => {
  const api = source("src/lib/api/mock-inspection-reports.ts");

  expect(api).not.toMatch(/import\s*\{[^}]*buildInspectionReportPdf[^}]*\}\s*from\s*["']\.\.\/orders\/ir-pdf["']/s);
  expect(api).toMatch(/import\(["']\.\.\/orders\/ir-pdf["']\)/);
  expect(api).toMatch(/from\s+["']\.\.\/orders\/ir-pdf-contract["']/);
});
