import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";

const sourceRoot = join(process.cwd(), "src");
const forbiddenVisibleAbbreviation = /(^|[^A-Za-z0-9_])BO(?![-A-Za-z0-9_])/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

test("所有运行时可见文案都使用 Business Order 全称", () => {
  const violations: string[] = [];

  for (const file of sourceFiles(sourceRoot)) {
    const sourceText = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const inspect = (node: ts.Node) => {
      const isVisibleTextNode =
        ts.isStringLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node)
        || ts.isTemplateTail(node)
        || ts.isJsxText(node);

      if (isVisibleTextNode && forbiddenVisibleAbbreviation.test(node.getText(sourceFile))) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push(`${relative(sourceRoot, file)}:${position.line + 1}`);
      }
      ts.forEachChild(node, inspect);
    };

    inspect(sourceFile);
  }

  expect(violations, `发现缩写文案：\n${violations.join("\n")}`).toEqual([]);
});
