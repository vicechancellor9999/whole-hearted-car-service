import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/components/shared/choice-cards.tsx"),
  "utf8",
);

test("choice cards use an accessible fieldset and native radio values", () => {
  expect(source).toContain("<fieldset");
  expect(source).toContain("<legend");
  expect(source).toContain('type="radio"');
  expect(source).toContain("name={name}");
  expect(source).toContain("value={choice.value}");
  expect(source).toContain("required={required}");
  expect(source).not.toContain("<select");
});

test("choice cards support an explicit default and keyboard focus styling", () => {
  expect(source).toContain("defaultChecked={checked}");
  expect(source).toContain("choice.value === defaultValue");
  expect(source).toContain("peer-focus-visible:ring-2");
});
