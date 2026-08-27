import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const forbiddenRuntime = /tesseract|CUSTOMER_OCR_ASSETS|\/ocr\/tesseract-v7|license-ocr/i;
const approvedSpecPath = "docs/superpowers/specs/2026-08-13-in-person-customer-onboarding-design.md";
const oldPlanPath = "docs/superpowers/plans/2026-08-13-in-person-customer-onboarding.md";
const replacementPlanPath = "docs/superpowers/plans/2026-08-14-external-ai-license-extraction-frontend.md";
const forbiddenProviderPackages = [
  "openai",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "@google/genai",
  "@google-cloud/vision",
  "@aws-sdk/client-bedrock-runtime",
  "@azure/openai",
  "mistralai",
  "cohere-ai",
];
const forbiddenProviderBoundary = /(?:OPENAI|ANTHROPIC|GEMINI|GOOGLE|AZURE|AWS|BEDROCK|MISTRAL|COHERE)[A-Z0-9_-]*(?:API[_-]?KEY|SECRET[_-]?ACCESS[_-]?KEY)|https:\/\/(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|bedrock-runtime\.[^/]+\.amazonaws\.com|api\.mistral\.ai|api\.cohere\.com)|(?:^|[^a-z0-9])(?:sk-(?:ant-)?[a-z0-9_-]{16,}|AIza[a-z0-9_-]{20,}|AKIA[a-z0-9]{16})(?:$|[^a-z0-9_-])/i;
const realExtractionRoute = /\/api\/customers\/onboarding\/[^\s"'`]+\/license-extraction/i;
const activeExtractionRoutePath = /^src\/(?:app\/api\/customers\/onboarding\/(?:[^/]+\/)*license-extraction(?:\/|$)|pages\/api\/customers\/onboarding\/(?:[^/]+\/)*license-extraction[^/]*(?:\/|$))/;

function forbiddenActiveExtractionRoutePaths(files) {
  return files.filter((file) => activeExtractionRoutePath.test(file));
}

function trackedFiles(...paths) {
  if (paths.every((path) => !existsSync(join(projectRoot, path)))) return [];
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...paths], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return output.split("\0").filter((file) => file && existsSync(join(projectRoot, file)));
}

test("customer extraction has no direct legacy engine dependency or asset sync script", async () => {
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(await readFile(join(projectRoot, "package-lock.json"), "utf8"));
  const forbiddenPackages = ["@tesseract.js-data/eng", "tesseract.js", "tesseract.js-core"];

  for (const name of forbiddenPackages) {
    assert.equal(packageJson.dependencies?.[name], undefined, `remove direct dependency ${name}`);
    assert.equal(packageJson.devDependencies?.[name], undefined, `remove direct dev dependency ${name}`);
    assert.equal(packageLock.packages?.[""]?.dependencies?.[name], undefined, `remove locked direct dependency ${name}`);
    assert.equal(packageLock.packages?.[`node_modules/${name}`], undefined, `remove locked runtime ${name}`);
  }
  assert.equal(packageJson.scripts?.["sync:customer-ocr-assets"], undefined);
});

test("the tracked 14.10 MiB local OCR runtime is removed", () => {
  assert.deepEqual(trackedFiles("public/ocr/tesseract-v7"), []);
});

test("active source and scripts contain no old OCR runtime boundary", async () => {
  const files = trackedFiles("src", "scripts");
  const matches = [];
  for (const file of files) {
    const source = await readFile(join(projectRoot, file), "utf8");
    if (forbiddenRuntime.test(source)) matches.push(file);
  }
  assert.deepEqual(matches, []);
});

test("approved design fixes a provider-neutral same-origin extraction boundary", async () => {
  const spec = await readFile(join(projectRoot, approvedSpecPath), "utf8");

  assert.match(spec, /interface LicenseExtractionClient/);
  assert.match(spec, /POST \/api\/customers\/onboarding\/:token\/license-extraction/);
  assert.match(spec, /不持有供应商 API key/);
  assert.match(spec, /不直接请求供应商域名/);
});

test("active route path guard rejects tracked or untracked extraction route trees without matching neutral client files", () => {
  const forbidden = [
    "src/app/api/customers/onboarding/[token]/license-extraction/route.ts",
    "src/app/api/customers/onboarding/mock/license-extraction/v1/route.ts",
    "src/pages/api/customers/onboarding/[token]/license-extraction.ts",
    "src/pages/api/customers/onboarding/mock/license-extraction-v2.ts",
  ];
  const safe = [
    "src/lib/customers/license-extraction/browser-client.ts",
    "src/app/api/customers/onboarding/[token]/kyc/route.ts",
    "src/pages/customers/onboarding/license-extraction.tsx",
  ];

  assert.deepEqual(forbiddenActiveExtractionRoutePaths([...safe, ...forbidden]), forbidden);
});

test("provider SDK denylist includes representative vision packages without matching adjacent Google packages", () => {
  assert.equal(forbiddenProviderPackages.includes("@google-cloud/vision"), true);
  assert.equal(forbiddenProviderPackages.includes("@google-cloud/storage"), false);
});

test("secret literal guard detects representative provider credentials without matching safe placeholders", () => {
  const secrets = [
    "sk-proj-1234567890abcdef",
    "sk-ant-api03-1234567890abcdef",
    "AIzaSyA1234567890abcdefghijklmnop",
    "AKIAIOSFODNN7EXAMPLE",
  ];
  const safe = ["sk-example", "sketch-pad", "AIza-placeholder", "AKIA-example", "process.env.INTERNAL_LICENSE_EXTRACTOR"];

  for (const secret of secrets) assert.match(secret, forbiddenProviderBoundary);
  for (const placeholder of safe) assert.doesNotMatch(placeholder, forbiddenProviderBoundary);
});

test("old local-OCR plan starts with an explicit do-not-execute superseded notice", async () => {
  const oldPlan = await readFile(join(projectRoot, oldPlanPath), "utf8");
  const header = oldPlan.slice(0, 2_500);

  assert.match(header, /2026-08-14/);
  assert.match(header, /(?:SUPERSEDED|已废止|已取代)/i);
  assert.match(header, /Tasks? 1[–-]3[、,\s]+7[、,\s]+8/i);
  assert.match(header, /(?:不得执行|must not be executed)/i);
  assert.match(header, new RegExp(replacementPlanPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(header, new RegExp(approvedSpecPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("active packages and runtime contain no provider SDK, secret literal, direct provider URL, or real extraction route", async () => {
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(await readFile(join(projectRoot, "package-lock.json"), "utf8"));
  for (const name of forbiddenProviderPackages) {
    assert.equal(packageJson.dependencies?.[name], undefined, `remove provider dependency ${name}`);
    assert.equal(packageJson.devDependencies?.[name], undefined, `remove provider dev dependency ${name}`);
    assert.equal(packageLock.packages?.[`node_modules/${name}`], undefined, `remove locked provider SDK ${name}`);
  }

  assert.deepEqual(
    forbiddenActiveExtractionRoutePaths(trackedFiles(
      "src/app/api/customers/onboarding",
      "src/pages/api/customers/onboarding",
    )),
    [],
  );

  // 2026-08-18 老板拍板：DeepSeek 是正式接入的 AI 服务（拆单/翻译），其密钥设置文件豁免通用密钥扫描；
  // 但仍不允许 forbiddenProviderPackages 里的供应商 SDK/URL，也不允许真实的证件识别提取路由。
  const sanctionedAiPaths = new Set(["src/lib/ai/settings.ts", "src/lib/ai/deepseek.ts", "src/lib/ai/auto-repair.ts", "src/app/api/ai/chat/route.ts"]);
  const matches = [];
  for (const file of trackedFiles("src", "scripts", "package.json", "package-lock.json")) {
    if (sanctionedAiPaths.has(file)) continue;
    const source = await readFile(join(projectRoot, file), "utf8");
    if (forbiddenProviderBoundary.test(source) || realExtractionRoute.test(source)) matches.push(file);
  }
  assert.deepEqual(matches, []);
});
