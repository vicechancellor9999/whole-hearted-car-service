import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const dialogSource = readFileSync(
  resolve(process.cwd(), "src/components/orders/formal-inspection-create-dialog.tsx"),
  "utf8",
);

test("inspection intake uses visible choice cards instead of team and mechanic dropdowns", () => {
  expect(dialogSource).not.toContain("<select");
  expect(dialogSource).toContain('ariaLabel="提交班组"');
  expect(dialogSource).toContain('ariaLabel="维修工姓名（可选）"');
  expect(dialogSource).toContain("InspectionChoiceCards");
  expect(dialogSource).toContain('role="radiogroup"');
  expect(dialogSource).toContain('role="radio"');
  expect(dialogSource).toContain("aria-checked={selected}");
});
