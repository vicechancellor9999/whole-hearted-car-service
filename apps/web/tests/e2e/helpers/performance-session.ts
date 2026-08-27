import { expect, type Page } from "@playwright/test";
import type { MockPerformanceE2EScenario } from "../../../src/lib/api/mock-performance";

export type PerformanceIdentity =
  | "superadmin"
  | "finance"
  | "frontdesk_admin"
  | "parts_no_performance";

type DetailPerformanceScenario =
  | "slow-team-read"
  | "team-read-failure-once"
  | "empty-history"
  | "missing-standard-salary"
  | "salary-save-failure-once";

export type PerformanceScenario = DetailPerformanceScenario | MockPerformanceE2EScenario;

const identities = {
  superadmin: {
    id: "emp-001",
    name: "超级管理员",
    nameEn: "Super Admin",
    role: "superadmin",
    roleLabel: "超级管理员",
    roleLabelEn: "Super Admin",
    scope: "all",
    avatarColor: "#465fff",
    initials: "SA",
  },
  finance: {
    id: "emp-002",
    name: "李美玲",
    nameEn: "Li Meiling",
    role: "finance",
    roleLabel: "财务",
    roleLabelEn: "Finance",
    scope: "all",
    avatarColor: "#7a5af8",
    initials: "LM",
  },
  frontdesk_admin: {
    id: "emp-003",
    name: "王建华",
    nameEn: "Wang Jianhua",
    role: "frontdesk_admin",
    roleLabel: "前台管理员",
    roleLabelEn: "Front Desk Admin",
    scope: "all",
    avatarColor: "#0ea5e9",
    initials: "WJ",
  },
  parts_no_performance: {
    id: "emp-004",
    name: "张伟",
    nameEn: "Zhang Wei",
    role: "parts",
    roleLabel: "配件专员",
    roleLabelEn: "Parts Specialist",
    scope: "assigned",
    avatarColor: "#f59e0b",
    initials: "ZW",
  },
} as const;

const scenarios = {
  "slow-team-read": { delayMs: { teamRead: 2_000 } },
  "team-read-failure-once": { failNext: { teamRead: "演示读取失败" } },
  "empty-history": "emptyHistory",
  "missing-standard-salary": "missingStandardSalary",
  "salary-save-failure-once": { failNext: { salarySave: "演示保存失败" } },
  "rule-save-failure-once": "rule-save-failure-once",
  "rule-activate-failure-once": "rule-activate-failure-once",
  "missing-rule-team": "missing-rule-team",
  "missing-rule-member-salary": "missing-rule-member-salary",
  "missing-rule-actual": "missing-rule-actual",
} as const satisfies Record<PerformanceScenario, unknown>;

const runtimeErrors = new WeakMap<Page, string[]>();
const e2eOrigin = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3002";

export function observePerformanceRuntimeErrors(page: Page): string[] {
  const existing = runtimeErrors.get(page);
  if (existing) return existing;

  const errors: string[] = [];
  page.on("pageerror", (error) => {
    // Chrome 内置 PDF 查看器在 blob iframe 里访问 localStorage 会抛这个无害错误（第三方查看器噪声）
    const pdfViewerNoise = error.message.includes("reading 'setItem'");
    if (!pdfViewerNoise) errors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    const text = message.text();
    const rechartsReactDeprecation = text.includes(
      "Support for defaultProps will be removed from function components",
    );
    if (message.type() === "error" && !rechartsReactDeprecation) errors.push(`console: ${text}`);
  });
  runtimeErrors.set(page, errors);
  return errors;
}

export async function assertNoPerformanceRuntimeErrors(page: Page): Promise<void> {
  expect(observePerformanceRuntimeErrors(page)).toEqual([]);
}

export async function usePerformanceIdentity(
  page: Page,
  identity: PerformanceIdentity,
  scenario?: PerformanceScenario,
): Promise<void> {
  observePerformanceRuntimeErrors(page);
  await page.context().addCookies([{
    name: "wh_session",
    value: `e2e-${identities[identity].id}`,
    url: e2eOrigin,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  const session = {
    identity: identities[identity],
    token: `offline-${identities[identity].id}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const installedScenario = scenario ? scenarios[scenario] : undefined;

  await page.addInitScript(
    ({ serializedSession, performanceScenario }) => {
      localStorage.setItem("wh_session", serializedSession);
      if (sessionStorage.getItem("wh_performance_e2e_seeded") !== "1") {
        localStorage.removeItem("wh_performance_mock_v1");
        if (performanceScenario !== undefined) {
          (window as typeof window & { __WH_PERFORMANCE_TEST_SCENARIO__?: unknown })
            .__WH_PERFORMANCE_TEST_SCENARIO__ = performanceScenario;
        }
        sessionStorage.setItem("wh_performance_e2e_seeded", "1");
      }
    },
    { serializedSession: JSON.stringify(session), performanceScenario: installedScenario },
  );
}

export async function usePerformanceScenario(
  page: Page,
  scenario: PerformanceScenario,
): Promise<void> {
  const installedScenario = scenarios[scenario];
  await page.addInitScript((value) => {
    (window as typeof window & { __WH_PERFORMANCE_TEST_SCENARIO__?: unknown })
      .__WH_PERFORMANCE_TEST_SCENARIO__ = value;
  }, installedScenario);
}
