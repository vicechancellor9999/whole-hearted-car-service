# 绩效规则版本管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在真实绩效模块中提供四组共用的版本化规则管理，让授权人员安全调整工时费提成比例和人民币汇率，并保证已锁定历史月份永不重算。

**Architecture:** 复用班组绩效详情计划建立的领域类型、纯计算函数和 Mock 仓库；规则版本通过草稿、影响预览、启用三个阶段写入。UI 只编辑两个业务参数、生效月份和原因，完整公式只读展示；规则解析按月份选择当时有效版本，历史快照继续持有自己的 `AppliedRuleSnapshot`。

**Tech Stack:** Next.js 14.2.5、React 18.3.1、TypeScript 5.5.4、Tailwind CSS 3.4.7、Playwright 1.54.2。

## Global Constraints

- 本计划在 `docs/superpowers/plans/2026-08-08-team-performance-detail.md` 全部通过后执行。
- 四个维修班组共用同一套规则版本，不提供班组级覆盖。
- `25%` 的业务名称固定为“工时费提成比例”；`23` 的业务名称固定为“人民币汇率”，显示为 `1 CNY = 23 JMD`。
- 管理员只可编辑工时费提成比例、人民币汇率、生效月份和变更原因。
- 不提供任意代码、自由表达式或公式结构编辑器。
- 工时费提成比例合法范围为 `(0%, 100%]`；人民币汇率必须大于 `0`。
- 修改规则必须新建版本，不得覆盖当前或历史版本。
- 已锁定月份不能作为生效月份；历史快照不得引用活规则重新计算。
- 启用前必须预览四个班组及所有成员的指标、完成率和工资测算差异。
- 规则状态仅使用 `draft`、`scheduled`、`active`、`historical`。
- 所有具备查看权限的身份都能查看当前和历史版本；只有 `canManageRules` 可新建、预览和启用。
- 自动化测试使用独立端口 `3005`，不得复用用户正在查看的 `3002`。

## File Map

- Modify `src/lib/performance/types.ts`: 规则版本、草稿、影响预览和规则工作台 DTO。
- Modify `src/lib/performance/calculations.ts`: 参数校验、按月解析版本和四组影响预览。
- Create `src/lib/performance/migrations.ts`: 持久化 schema v1 到 v2 的无损迁移。
- Modify `src/lib/api/mock-performance.ts`: 草稿保存、状态转换、启用和历史版本读取。
- Modify `src/lib/api/client.ts`: 规则读取、预览、保存草稿和启用 API。
- Create `src/components/performance/performance-rules-panel.tsx`: 当前规则、只读公式、历史版本和入口。
- Create `src/components/performance/rule-version-form.tsx`: 两参数、生效月份和原因表单。
- Create `src/components/performance/rule-impact-preview.tsx`: 四组和成员的新旧差异。
- Modify `src/components/performance/performance-workspace.tsx`: “班组绩效 / 绩效规则”切换与规则 mutation。
- Modify `src/components/performance/team-performance-detail.tsx`: 所选月份显示当月锁定的规则版本与参数。
- Modify `tests/unit/performance-calculations.spec.ts`: 规则解析和影响预览。
- Create `tests/unit/performance-rules-store.spec.ts`: 权限、预览凭证、状态转换和锁定历史保护。
- Create `tests/e2e/performance-rules.spec.ts`: 权限、表单、预览、启用和历史不变。
- Modify `design-qa.md`: 规则页面视觉与交互证据。

---

### Task 1: 规则领域、版本解析与 Mock API

**Files:**
- Modify: `src/lib/performance/types.ts`
- Modify: `src/lib/performance/calculations.ts`
- Create: `src/lib/performance/migrations.ts`
- Modify: `src/lib/api/mock-performance.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `tests/unit/performance-calculations.spec.ts`
- Test: `tests/unit/performance-rules-store.spec.ts`

**Interfaces:**
- Consumes: 前置计划的 `PerformanceRuleParameters`、`AppliedRuleSnapshot`、`TeamMonthSnapshot`、`calculateTeamMonth()` 和 Mock 仓库。
- Produces: `PerformanceRuleVersion`、`RuleDraftInput`、`RuleImpactPreview`、`RuleWorkspaceResponse`；以及 `validateRuleDraftSyntax()`、`validateRuleEffectiveMonth()`、`resolveRuleForMonth()`、`normalizeRuleStatuses()`、`previewRuleImpact()`、`migratePerformanceEnvelope()`、`loadAndMigratePerformanceEnvelope()`、规则 API。

- [ ] **Step 1: 写规则校验、月份解析和历史不变红测**

在 `tests/unit/performance-calculations.spec.ts` 增加：

```ts
import {
  normalizeRuleStatuses,
  previewRuleImpact,
  resolveRuleForMonth,
  validateRuleDraftSyntax,
  validateRuleEffectiveMonth,
} from "../../src/lib/performance/calculations";
import type {
  CalculateTeamMonthInput,
  PerformanceRuleParameters,
  PerformanceRuleVersion,
  YearMonth,
} from "../../src/lib/performance/types";

const makeRuleVersion = (
  input: Pick<PerformanceRuleVersion, "id" | "effectiveMonth" | "status"> &
    PerformanceRuleParameters,
): PerformanceRuleVersion => ({
  id: input.id,
  version: input.id === "v1" ? "V1" : "V2",
  effectiveMonth: input.effectiveMonth,
  status: input.status,
  parameters: {
    commissionRate: input.commissionRate,
    cnyToJmdRate: input.cnyToJmdRate,
    minimumPayableCny: input.minimumPayableCny,
  },
  createdBy: "LiJian",
  createdAt: "2026-08-08T12:00:00-05:00",
  reason: input.id === "v1" ? "初始规则" : "调整提成与汇率",
  previewInputHash: input.id === "v1" ? null : "seeded-preview-hash",
  previewSourceRevision: input.id === "v1" ? null : 1,
});

const makeMembers = (teamId: string, salaries: number[]) =>
  salaries.map((standardSalaryCny, index) => ({
    memberId: `${teamId}-m${index + 1}`,
    employeeNo: `${teamId.toUpperCase()}-${String(index + 1).padStart(4, "0")}`,
    name: `${teamId}成员${index + 1}`,
    role: index === 0 ? "组长" : "组员",
    standardSalaryCny,
    calculationKind: "full_month" as const,
  }));

const teamInputs: CalculateTeamMonthInput[] = [
  ["t1", "车间一组", [12_000, 14_000, 16_000, 14_000], 58_000],
  ["t2", "车间二组", [18_000, 20_000, 16_000], 64_500],
  ["t3", "工程机械组", [14_000, 16_000, 20_000], 0],
  ["t4", "钣金喷漆组", [12_000, 18_000], 0],
].map(([teamId, teamName, salaries, actualPerformanceJmd]) => ({
  teamId: teamId as string,
  teamName: teamName as string,
  month: "2026-08" as const,
  status: "collecting" as const,
  actualPerformanceJmd: actualPerformanceJmd as number,
  members: makeMembers(teamId as string, salaries as number[]),
  rule,
}));

test("规则按生效月份解析且锁定快照保留旧参数", () => {
  const versions = [
    makeRuleVersion({ id: "v1", effectiveMonth: "2025-08", status: "active", commissionRate: 0.25, cnyToJmdRate: 23, minimumPayableCny: 0 }),
    makeRuleVersion({ id: "v2", effectiveMonth: "2026-09", status: "scheduled", commissionRate: 0.30, cnyToJmdRate: 24, minimumPayableCny: 0 }),
    { ...makeRuleVersion({ id: "v2", effectiveMonth: "2026-10", status: "scheduled", commissionRate: 0.23, cnyToJmdRate: 24, minimumPayableCny: 0 }), id: "v3", version: "V3" },
  ];
  expect(resolveRuleForMonth(versions, "2026-07")?.id).toBe("v1");
  expect(resolveRuleForMonth(versions, "2026-09")?.id).toBe("v2");
  expect(normalizeRuleStatuses(versions, "2026-09").map(({ id, status }) => ({ id, status })))
    .toEqual([
      { id: "v1", status: "historical" },
      { id: "v2", status: "active" },
      { id: "v3", status: "scheduled" },
    ]);
  expect(normalizeRuleStatuses(versions, "2026-10").map(({ id, status }) => ({ id, status })))
    .toEqual([
      { id: "v1", status: "historical" },
      { id: "v2", status: "historical" },
      { id: "v3", status: "active" },
    ]);

  const before = structuredClone(teamInputs);
  previewRuleImpact(teamInputs, {
    commissionRatePercent: 30,
    cnyToJmdRate: 24,
    effectiveMonth: "2026-09",
    reason: "工时费提成调整并更新汇率",
  });
  expect(teamInputs).toEqual(before);
});

test("规则预览覆盖四组并使用新提成与汇率", () => {
  const preview = previewRuleImpact(teamInputs, {
    commissionRatePercent: 30,
    cnyToJmdRate: 24,
    effectiveMonth: "2026-09",
    reason: "工时费提成调整并更新汇率",
  });
  expect(preview.teams.map((team) => team.teamId)).toEqual(["t1", "t2", "t3", "t4"]);
  expect(preview.teams[0].after.teamTargetJmd).toBe(56_000 / 0.30 * 24);
});

test("提成、汇率、生效月份和原因必须通过校验", () => {
  for (const commissionRatePercent of [0, -1, 100.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(validateRuleDraftSyntax({ commissionRatePercent, cnyToJmdRate: 23, effectiveMonth: "2026-09", reason: "调整" }))
      .toMatchObject({ commissionRatePercent: expect.any(String) });
  }
  for (const cnyToJmdRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(validateRuleDraftSyntax({ commissionRatePercent: 25, cnyToJmdRate, effectiveMonth: "2026-09", reason: "调整" }))
      .toMatchObject({ cnyToJmdRate: expect.any(String) });
  }
  expect(validateRuleDraftSyntax({ commissionRatePercent: 25, cnyToJmdRate: 23, effectiveMonth: "2026-09", reason: "   " }))
    .toMatchObject({ reason: expect.any(String) });
  for (const effectiveMonth of ["2026-1", "2026-00", "2026-13", "not-a-month"]) {
    expect(validateRuleDraftSyntax({ commissionRatePercent: 25, cnyToJmdRate: 23, effectiveMonth: effectiveMonth as YearMonth, reason: "调整" }))
      .toMatchObject({ effectiveMonth: expect.any(String) });
  }
  expect(validateRuleEffectiveMonth(
    { commissionRatePercent: 25, cnyToJmdRate: 23, effectiveMonth: "2026-07", reason: "调整" },
    { currentMonth: "2026-08", lockedMonths: ["2026-07"] },
  )).toMatchObject({ effectiveMonth: expect.stringContaining("已锁定") });
});
```

- [ ] **Step 2: 运行红测确认规则接口尚不存在**

Run: `npm run test:unit -- tests/unit/performance-calculations.spec.ts`
Expected: FAIL，缺少 `resolveRuleForMonth`、`previewRuleImpact` 或规则类型。

- [ ] **Step 3: 定义规则 DTO 并实现纯函数**

在 `src/lib/performance/types.ts` 增加：

```ts
export type RuleStatus = "draft" | "scheduled" | "active" | "historical";

export interface PerformanceRuleVersion {
  id: string;
  version: string;
  effectiveMonth: YearMonth;
  status: RuleStatus;
  parameters: PerformanceRuleParameters;
  createdBy: string;
  createdAt: string;
  reason: string;
  previewInputHash: string | null;
  previewSourceRevision: number | null;
}

export interface RuleDraftInput {
  commissionRatePercent: number;
  cnyToJmdRate: number;
  effectiveMonth: YearMonth;
  reason: string;
}

export interface RuleImpactCalculation {
  draft: RuleDraftInput;
  parameters: PerformanceRuleParameters;
  teams: Array<{
    teamId: string;
    teamName: string;
    before: TeamMonthSnapshot;
    after: TeamMonthSnapshot;
  }>;
}

export interface RuleImpactPreview extends RuleImpactCalculation {
  previewToken: string;
  inputHash: string;
  sourceRevision: number;
}

export interface SaveRuleDraftInput {
  draft: RuleDraftInput;
  previewToken: string;
}

export interface RuleWorkspaceResponse {
  currentMonth: YearMonth;
  currentRule: PerformanceRuleVersion;
  scheduledRules: PerformanceRuleVersion[];
  historicalRules: PerformanceRuleVersion[];
  draftRules: PerformanceRuleVersion[];
  lockedMonths: YearMonth[];
  permissions: PerformancePermissions;
}

export interface MockPerformanceStateV2 extends MockPerformanceState {
  ruleVersions: PerformanceRuleVersion[];
}

export interface PersistedPerformanceEnvelopeV2 {
  schemaVersion: 2;
  state: MockPerformanceStateV2;
}
```

`validateRuleDraftSyntax()` 使用 `Number.isFinite()` 校验数值：工时费提成比例必须为有限数且在 `(0, 100]`，人民币汇率必须为有限数且大于 `0`；`reason.trim()` 不得为空；生效月必须匹配 `^\d{4}-(0[1-9]|1[0-2])$`。`validateRuleEffectiveMonth(input, { lockedMonths, currentMonth })` 在仓库/API 边界校验月份。`commissionRatePercent: 30` 只在该边界转换一次为 `commissionRate: 0.30`。`resolveRuleForMonth()` 只考虑 `active`、`scheduled` 和 `historical`，选择 `effectiveMonth <= month` 的最新版本；不得修改输入数组。`normalizeRuleStatuses(versions, currentMonth)` 把相对当前月真正生效的版本派生为 `active`、此前版本派生为 `historical`、未来版本派生为 `scheduled`。纯函数 `previewRuleImpact(teamInputs, draft)` 只返回 `RuleImpactCalculation`，对四组分别调用 `calculateTeamMonth()`，保持实际绩效和成员工资输入不变，只替换规范化后的规则参数；token/hash 不属于纯函数。

- [ ] **Step 4: 先写并运行 Mock 规则仓库与迁移红测**

在实现 Mock store、迁移或 API 路由前，先创建 `tests/unit/performance-rules-store.spec.ts`。最小红测必须包括：无 `canManageRules` 的三条写入口拒绝、合法未来规则预览、**绕过 UI 直接传入 `effectiveMonth: "2026-07"` 时 `previewRule()` 在 store 层明确拒绝“已锁定月份不能生效”**、预览 token 与 `sourceRevision` 绑定、同月冲突、已锁定快照不变，以及 v1→v2 迁移保留工资修改。下方完整测试代码是本步骤的验收内容；此时只能新增测试，不得先实现 Mock store、迁移或 API。

Run: `npm run test:unit -- tests/unit/performance-rules-store.spec.ts`
Expected: FAIL，缺少 `createMockPerformanceStore`、规则 store 接口或迁移实现。

- [ ] **Step 5: 实现 Mock 规则仓库、迁移和 API 路由，再运行绿测**

在 `mock-performance.ts` 增加：

```ts
getRuleWorkspace(access: PerformanceAccessContext): RuleWorkspaceResponse;
previewRule(access: PerformanceAccessContext, input: RuleDraftInput): Promise<RuleImpactPreview>;
saveRuleDraft(access: PerformanceAccessContext, input: SaveRuleDraftInput): PerformanceRuleVersion;
activateRule(access: PerformanceAccessContext, ruleId: string): RuleWorkspaceResponse;
```

Mock 仓库必须执行以下写保护：

- `canManageRules === false` 返回权限错误；
- `previewRule()`、`saveRuleDraft()` 均先执行 `validateRuleDraftSyntax()` 和 `validateRuleEffectiveMonth()`；已保存但在启用前变为锁定月的草稿，`activateRule()` 也必须再次校验并明确拒绝。也就是说，绕过 UI 直接调用 store/API 仍不能以已锁定月份作为 `effectiveMonth`；
- 未生成四组影响预览的草稿不能启用；
- 同一生效月份已存在非草稿版本时拒绝冲突；
- 未来月份启用后为 `scheduled`，当前 active 与当前月/dashboard 完全不变；当前未锁定月份启用后为 `active`，此前 active 转为 `historical`，并立即重算当前月四组及 dashboard；
- 当前月份推进到某个 scheduled 版本的生效月时，用 `normalizeRuleStatuses()` 将它变为 active、前一 active 变为 historical；多个未来 scheduled 版本可按不同生效月份共存；
- 每个已锁定 `TeamMonthSnapshot.appliedRule` 保持深度相等。

草稿保存时记录标准化后的输入；异步 `previewRule()` 调用纯计算后，用 `crypto.subtle.digest("SHA-256", ...)` 对规范化输入和 `MockPerformanceState.sourceRevision` 生成审计用 `inputHash`，再返回一次性 `previewToken`。token 内部记录 `{ normalizedDraft, inputHash, sourceRevision }`。同步 `saveRuleDraft()` 比较当前 draft 与 sourceRevision，写入 `previewInputHash/previewSourceRevision`；错误输入不得消费有效 token，成功保存后才消费。同步 `activateRule()` 再比较当前 sourceRevision，校验通过后才改变规则状态和递增 sourceRevision。这样只有 preview 使用异步 SHA，save/activate 不需要重新执行异步 digest，同时仍能阻止预览后工资、成员、实际绩效或规则源变化。单元测试必须在 `previewRule()`、`saveRuleDraft()` 和 `activateRule()` 前后深拷贝并深等整个四组 `lockedSnapshots`，不能只抽查 2026-07 或单一班组。

在 `api.performance` 增加：

```ts
rules: () => request<RuleWorkspaceResponse>("/api/performance/rules"),
previewRule: (input: RuleDraftInput) =>
  request<RuleImpactPreview>("/api/performance/rules/preview", {
    method: "POST", body: JSON.stringify(input),
  }),
saveRuleDraft: (input: SaveRuleDraftInput) =>
  request<PerformanceRuleVersion>("/api/performance/rules", {
    method: "POST", body: JSON.stringify(input),
  }),
activateRule: (ruleId: string) =>
  request<RuleWorkspaceResponse>(`/api/performance/rules/${ruleId}/activate`, {
    method: "POST",
  }),
```

与工资写操作相同，Mock API 必须从 session 解析 `PerformanceAccessContext` 后传给 store；客户端传来的角色或 capability 字段一律忽略。`RuleWorkspaceResponse.currentRule` 必须由 `resolveRuleForMonth(versions, currentMonth)` 得出，不能简单查找持久化的 `status === "active"`。

同步/异步边界固定为：store 的 `team()`、`dashboardPerformance()`、`previewSalary()`、`updateSalary()`、`saveRuleDraft()`、`activateRule()` 均同步；只有需要 WebCrypto 的 `previewRule()` 异步。`delayMs` 由异步 Mock transport 包裹处理，不把同步 store 方法临时改成 Promise。

本任务把持久化 envelope 从 `schemaVersion: 1` 升至 `schemaVersion: 2`。`src/lib/performance/migrations.ts` 只从中立的 `types.ts` 导入 `PersistedPerformanceEnvelopeV1/V2`，不得从 `api/mock-performance.ts` 反向导入。`migratePerformanceEnvelope(v1)` 必须原样保留当前工资、工资调整记录、四组当前状态和所有锁定快照，并根据 v1 每月的 `appliedRule` 建立初始 V1 规则记录；迁移出的演示 V1 元数据固定为创建人 `LiJian`、生效月 `2025-08`（覆盖首个锁定快照）、原因“初始规则”和确定性创建时间，不用当前时钟生成不稳定值。不能通过“重置演示数据”丢掉前置计划已保存的工资修改。浏览器只在迁移成功后覆盖存储；失败则显示明确迁移错误并保持原 v1 值可恢复。

在 Step 4 已先创建的 `tests/unit/performance-rules-store.spec.ts` 中写入以下完整红测；实施本步骤后重新运行它直到通过：

```ts
import { expect, test } from "@playwright/test";
import {
  buildMockPerformanceStateV1,
  createMockPerformanceStore,
} from "../../src/lib/api/mock-performance";
import {
  loadAndMigratePerformanceEnvelope,
  migratePerformanceEnvelope,
} from "../../src/lib/performance/migrations";
import type {
  PersistedPerformanceEnvelopeV1,
  RuleDraftInput,
} from "../../src/lib/performance/types";

const editor = {
  actorId: "emp-001",
  permissions: { canViewPerformance: true, canEditSalary: true, canManageRules: true },
};
const readOnly = {
  actorId: "emp-003",
  permissions: { canViewPerformance: true, canEditSalary: false, canManageRules: false },
};
const draft: RuleDraftInput = {
  commissionRatePercent: 30,
  cnyToJmdRate: 24,
  effectiveMonth: "2026-09",
  reason: "工时费提成调整并更新汇率",
};

test("规则 store 拒绝无管理 capability 的全部写入口", async () => {
  const store = createMockPerformanceStore();
  await expect(store.previewRule(readOnly, draft)).rejects.toThrow(/无权/);
  expect(() => store.saveRuleDraft(readOnly, { draft, previewToken: "bypass" })).toThrow(/无权/);
  expect(() => store.activateRule(readOnly, "rule-v2")).toThrow(/无权/);
});

test("store 层拒绝绕过 UI 提交已锁定月份", async () => {
  const store = createMockPerformanceStore();
  const lockedDraft = { ...draft, effectiveMonth: "2026-07" as const, reason: "尝试改写锁定历史" };
  await expect(store.previewRule(editor, lockedDraft)).rejects.toThrow(/已锁定月份不能生效/);
});

test("预览凭证绑定输入，未来版本不改当前 dashboard 和锁定快照", async () => {
  const store = createMockPerformanceStore();
  const lockedBefore = structuredClone(store.exportEnvelope().state.lockedSnapshots);
  const dashboardBefore = structuredClone(store.dashboardPerformance());
  const sourceRevisionBefore = store.exportEnvelope().state.sourceRevision;
  const preview = await store.previewRule(editor, draft);
  expect(preview.inputHash).toMatch(/^[a-f0-9]{64}$/);
  expect(preview.previewToken).toBeTruthy();
  expect(preview.sourceRevision).toBe(sourceRevisionBefore);
  expect(() => store.saveRuleDraft(editor, { draft: { ...draft, cnyToJmdRate: 25 }, previewToken: preview.previewToken }))
    .toThrow(/预览已失效/);
  const saved = store.saveRuleDraft(editor, { draft, previewToken: preview.previewToken });
  expect(saved.previewInputHash).toBe(preview.inputHash);
  expect(saved.previewSourceRevision).toBe(sourceRevisionBefore);
  const workspace = store.activateRule(editor, saved.id);
  expect(workspace.scheduledRules.map((rule) => rule.id)).toContain(saved.id);
  expect(workspace.currentRule.version).toBe("V1");
  expect(store.exportEnvelope().state.sourceRevision).toBe(sourceRevisionBefore + 1);
  expect(store.dashboardPerformance()).toEqual(dashboardBefore);
  expect(store.exportEnvelope().state.lockedSnapshots).toEqual(lockedBefore);
});

test("缺少任一班组预览数据时不能保存或启用", async () => {
  const store = createMockPerformanceStore({ faults: { dataScenario: "missingRuleTeam" } });
  await expect(store.previewRule(editor, draft)).rejects.toThrow(/四个班组数据不完整/);
  expect(() => store.saveRuleDraft(editor, { draft, previewToken: "missing" })).toThrow(/有效预览/);
});

test("成员工资或实际绩效源缺失时不能生成规则预览凭证", async () => {
  for (const [dataScenario, message] of [
    ["missingRuleMemberSalary", /成员工资数据不完整/],
    ["missingRuleActual", /实际绩效数据不完整/],
  ] as const) {
    const store = createMockPerformanceStore({ faults: { dataScenario } });
    await expect(store.previewRule(editor, draft)).rejects.toThrow(message);
    expect(() => store.saveRuleDraft(editor, { draft, previewToken: "missing" }))
      .toThrow(/有效预览/);
  }
});

test("预览后源工资变化会令旧凭证失效", async () => {
  const store = createMockPerformanceStore();
  const preview = await store.previewRule(editor, draft);
  const salaryInput = {
    teamId: "t1", memberId: "EMP-UAT-040", month: "2026-08", newSalaryCny: 13_000,
  } as const;
  const salaryPreview = store.previewSalary(editor, salaryInput);
  store.updateSalary(editor, { ...salaryInput, previewToken: salaryPreview.previewToken });
  expect(() => store.saveRuleDraft(editor, { draft, previewToken: preview.previewToken }))
    .toThrow(/源数据已变化|重新预览/);
});

test("保存草稿后源工资变化会阻止启用", async () => {
  const store = createMockPerformanceStore();
  const currentBefore = structuredClone(store.dashboardPerformance());
  const lockedBefore = structuredClone(store.exportEnvelope().state.lockedSnapshots);
  const preview = await store.previewRule(editor, draft);
  const saved = store.saveRuleDraft(editor, { draft, previewToken: preview.previewToken });
  const salaryInput = {
    teamId: "t1", memberId: "EMP-UAT-040", month: "2026-08", newSalaryCny: 13_000,
  } as const;
  const salaryPreview = store.previewSalary(editor, salaryInput);
  store.updateSalary(editor, { ...salaryInput, previewToken: salaryPreview.previewToken });
  const revisionAfterSalary = store.exportEnvelope().state.sourceRevision;
  expect(() => store.activateRule(editor, saved.id)).toThrow(/源数据已变化|重新预览/);
  expect(store.exportEnvelope().state.sourceRevision).toBe(revisionAfterSalary);
  const workspace = store.getRuleWorkspace(editor);
  expect(workspace.currentRule.version).toBe("V1");
  expect(workspace.draftRules.map((rule) => rule.id)).toContain(saved.id);
  expect(store.dashboardPerformance()).not.toEqual(currentBefore); // 只包含已授权的工资修改，不包含 V2 规则结果
  expect(store.dashboardPerformance().teams.find((team) => team.id === "t1")?.targetAmount).toBe(5_244_000);
  expect(store.exportEnvelope().state.lockedSnapshots).toEqual(lockedBefore);
});

test("当前未锁定月份启用后立即重算当前四组但不改历史", async () => {
  const store = createMockPerformanceStore();
  const currentDraft = { ...draft, effectiveMonth: "2026-08" as const, reason: "本月起调整" };
  const lockedBefore = structuredClone(store.exportEnvelope().state.lockedSnapshots);
  const preview = await store.previewRule(editor, currentDraft);
  const saved = store.saveRuleDraft(editor, { draft: currentDraft, previewToken: preview.previewToken });
  const workspace = store.activateRule(editor, saved.id);
  expect(workspace.currentRule.id).toBe(saved.id);
  expect(workspace.historicalRules.map((rule) => rule.version)).toContain("V1");
  expect(store.dashboardPerformance().teams.map((team) => team.targetAmount))
    .toEqual([4_480_000, 4_320_000, 4_000_000, 2_400_000]);
  expect(store.exportEnvelope().state.lockedSnapshots).toEqual(lockedBefore);
});

test("不同未来月份可共存但同一生效月拒绝冲突", async () => {
  const store = createMockPerformanceStore();
  const schedule = async (input: RuleDraftInput) => {
    const preview = await store.previewRule(editor, input);
    const saved = store.saveRuleDraft(editor, { draft: input, previewToken: preview.previewToken });
    store.activateRule(editor, saved.id);
    return saved;
  };
  const september = await schedule(draft);
  const octoberDraft = { ...draft, effectiveMonth: "2026-10" as const, reason: "十月起回调" };
  const october = await schedule(octoberDraft);
  expect(store.getRuleWorkspace(editor).scheduledRules.map((rule) => rule.id))
    .toEqual([september.id, october.id]);

  const duplicate = { ...draft, commissionRatePercent: 23, reason: "重复九月版本" };
  const duplicatePreview = await store.previewRule(editor, duplicate);
  expect(() => store.saveRuleDraft(editor, {
    draft: duplicate,
    previewToken: duplicatePreview.previewToken,
  })).toThrow(/生效月份已存在规则/);
  expect(store.getRuleWorkspace(editor).scheduledRules.map((rule) => rule.id))
    .toEqual([september.id, october.id]);
});

test("v1 到 v2 迁移保留工资修改和锁定历史", () => {
  const state = buildMockPerformanceStateV1();
  const member = state.currentTeams.t1.members.find((item) => item.memberId === "EMP-UAT-040")!;
  member.standardSalaryCny = 13_000;
  state.sourceRevision += 1;
  state.salaryAdjustments.push({
    id: "adjust-migration-fixture",
    teamId: "t1",
    memberId: "EMP-UAT-040",
    month: "2026-08",
    fromCny: 12_000,
    toCny: 13_000,
    changedBy: "emp-001",
    changedAt: "2026-08-08T12:30:00.000Z",
  });
  const v1: PersistedPerformanceEnvelopeV1 = { schemaVersion: 1, state };
  const v1Before = structuredClone(v1);
  const lockedBefore = structuredClone(v1.state.lockedSnapshots);
  const julyBefore = lockedBefore.t1["2026-07"]!;
  const migrated = migratePerformanceEnvelope(v1);
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.state.ruleVersions[0]?.effectiveMonth).toBe("2025-08");
  expect(migrated.state.currentTeams.t1.members.find((member) => member.memberId === "EMP-UAT-040")?.standardSalaryCny)
    .toBe(13_000);
  expect(migrated.state.lockedSnapshots).toEqual(lockedBefore);
  expect(migrated.state.salaryAdjustments).toEqual(v1.state.salaryAdjustments);
  expect(v1).toEqual(v1Before);
  expect(migrated.state.ruleVersions[0]).toMatchObject({
    version: "V1",
    parameters: {
      commissionRate: julyBefore.appliedRule.commissionRate,
      cnyToJmdRate: julyBefore.appliedRule.cnyToJmdRate,
      minimumPayableCny: julyBefore.appliedRule.minimumPayableCny,
    },
  });
});

test("迁移失败不覆盖原存储", () => {
  const original = JSON.stringify({ schemaVersion: 1, state: { currentMonth: "broken" } });
  const writes: string[] = [];
  const storage = {
    getItem: () => original,
    setItem: (_key: string, value: string) => writes.push(value),
  };
  expect(() => loadAndMigratePerformanceEnvelope(storage, "wh_performance_mock_v1"))
    .toThrow(/绩效数据迁移失败/);
  expect(writes).toEqual([]);
  expect(storage.getItem()).toBe(original);
});
```

本计划把 `MockPerformanceFaults.dataScenario` 扩展为 `"missingRuleTeam" | "missingRuleMemberSalary" | "missingRuleActual"`，把 `failNext` 操作扩展为 `"rulePreview" | "ruleSave" | "ruleActivate"`，并把 E2E helper 的场景联合扩展为 `"rule-save-failure-once" | "rule-activate-failure-once" | "missing-rule-team" | "missing-rule-member-salary" | "missing-rule-actual"`，供规则 E2E 稳定复现错误。

- [ ] **Step 6: 运行单元测试、类型检查并提交**

Run: `npm run test:unit && npm run typecheck`
Expected: PASS；规则预览不修改任何锁定快照。

```bash
git add src/lib/performance/types.ts src/lib/performance/calculations.ts src/lib/performance/migrations.ts src/lib/api/mock-performance.ts src/lib/api/client.ts tests/unit/performance-calculations.spec.ts tests/unit/performance-rules-store.spec.ts
git commit -m "feat: add versioned performance rule domain"
```

---

### Task 2: 绩效规则页面、影响预览与启用流程

**Files:**
- Create: `src/components/performance/performance-rules-panel.tsx`
- Create: `src/components/performance/rule-version-form.tsx`
- Create: `src/components/performance/rule-impact-preview.tsx`
- Modify: `src/components/performance/performance-workspace.tsx`
- Modify: `src/components/performance/team-performance-detail.tsx`
- Test: `tests/e2e/performance-rules.spec.ts`

**Interfaces:**
- Consumes: Task 1 的规则 API 与前置计划的通用 `Dialog`。
- Produces: `/performance?view=rules`、当前规则、历史版本、新建草稿、四组预览和启用交互。

- [ ] **Step 1: 写当前规则、只读公式和写权限红测**

创建 `tests/e2e/performance-rules.spec.ts`：

```ts
import { expect, test } from "@playwright/test";
import {
  observePerformanceRuntimeErrors,
  usePerformanceIdentity,
} from "./helpers/performance-session";

let defaultPageRuntimeErrors: string[];

test.beforeEach(async ({ page }) => {
  defaultPageRuntimeErrors = observePerformanceRuntimeErrors(page);
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(() => {
  expect(defaultPageRuntimeErrors).toEqual([]);
});

test("规则页用业务名称显示当前参数且公式不可自由编辑", async ({ page }) => {
  await page.goto("/performance?view=rules");
  await expect(page.getByTestId("current-rule-version")).toContainText("V1");
  await expect(page.getByTestId("current-commission-rate")).toContainText("25%");
  await expect(page.getByTestId("current-exchange-rate")).toContainText("1 CNY = 23 JMD");
  await expect(page.getByTestId("current-rule-metadata")).toContainText("LiJian");
  await expect(page.getByTestId("current-rule-metadata")).toContainText("初始规则");
  await expect(page.getByTestId("current-rule-metadata")).toContainText("2025年8月");
  await expect(page.getByTestId("current-rule-metadata")).toContainText("当前生效");
  await expect(page.getByTestId("current-rule-created-at")).toHaveText("2026-08-08 12:00");
  const formulas = page.getByTestId("readonly-rule-formulas");
  await expect(page.getByTestId("current-commission-rate")).toContainText("工时费提成比例");
  await expect(formulas).toContainText("个人携带班组指标 = 月标准工资 ÷ 工时费提成比例 × 人民币汇率");
  await expect(formulas).toContainText("班组指标 = 全体成员携带班组指标合计");
  await expect(formulas).toContainText("班组完成率 = 班组实际绩效 ÷ 班组指标");
  await expect(formulas).toContainText("个人工资测算 = 个人月标准工资 × 班组统一完成率，最低按 0");
  await expect(page.getByRole("textbox", { name: /自由公式|代码公式/ })).toHaveCount(0);
  await expect(page.getByText(/车间一组规则|车间二组规则|工程机械组规则|钣金喷漆组规则/)).toHaveCount(0);
});

test("只读能力看到同一规则数据但没有新建与启用按钮", async ({ browser }) => {
  const context = await browser.newContext();
  const readOnlyPage = await context.newPage();
  const runtimeErrors = observePerformanceRuntimeErrors(readOnlyPage);
  await usePerformanceIdentity(readOnlyPage, "frontdesk_admin");
  await readOnlyPage.goto("/performance?view=rules");
  await expect(readOnlyPage.getByTestId("current-commission-rate")).toContainText("25%");
  await expect(readOnlyPage.getByTestId("current-exchange-rate")).toContainText("1 CNY = 23 JMD");
  await expect(readOnlyPage.getByTestId("rule-version-history")).toContainText("V1");
  await expect(readOnlyPage.getByTestId("new-rule-version")).toHaveCount(0);
  await expect(readOnlyPage.getByTestId("activate-rule-version")).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
  await context.close();
});
```

`tests/e2e/helpers/performance-session.ts` 必须导出 `observePerformanceRuntimeErrors(page): string[]`。它在导航前同时监听 `pageerror` 与 `console` 的 `error` 级别消息，并把可读错误文本写入返回数组；不忽略错误。默认 fixture 的 `beforeEach/afterEach` 负责断言默认 page，任何 `browser.newContext().newPage()` 都必须在 `goto()` 前调用该 helper，并在关闭 context 前断言返回数组为空。

- [ ] **Step 2: 写新版本四组预览与历史不变红测并运行**

```ts
test("30% 和汇率24必须预览四组后才能启用", async ({ page }) => {
  await page.goto("/performance?view=rules");
  await page.getByTestId("new-rule-version").click();
  await page.getByTestId("rule-commission-input").fill("30");
  await page.getByTestId("rule-exchange-rate-input").fill("24");
  await page.getByTestId("rule-effective-month").selectOption("2026-09");
  await page.getByTestId("rule-change-reason").fill("工时费提成调整并更新汇率");
  await expect(page.getByTestId("activate-rule-version")).toBeDisabled();
  await page.getByTestId("preview-rule-impact").click();
  await expect(page.getByTestId("rule-impact-team")).toHaveCount(4);
  const impactCases = [
    { name: "车间一组", count: 4, targets: ["5,152,000", "4,480,000"], rates: ["1.1258%", "1.2946%"], totals: ["¥630.43", "¥725.00"], memberTargets: ["1,104,000", "960,000"], memberPay: ["¥135.09", "¥155.36"] },
    { name: "车间二组", count: 3, targets: ["4,968,000", "4,320,000"], rates: ["1.2983%", "1.4931%"], totals: ["¥701.09", "¥806.25"], memberTargets: ["1,656,000", "1,440,000"], memberPay: ["¥233.70", "¥268.75"] },
    { name: "工程机械组", count: 3, targets: ["4,600,000", "4,000,000"], rates: ["0.0000%", "0.0000%"], totals: ["¥0.00", "¥0.00"], memberTargets: ["1,288,000", "1,120,000"], memberPay: ["¥0.00", "¥0.00"] },
    { name: "钣金喷漆组", count: 2, targets: ["2,760,000", "2,400,000"], rates: ["0.0000%", "0.0000%"], totals: ["¥0.00", "¥0.00"], memberTargets: ["1,104,000", "960,000"], memberPay: ["¥0.00", "¥0.00"] },
  ] as const;
  for (const item of impactCases) {
    const team = page.getByTestId("rule-impact-team").filter({ hasText: item.name });
    await expect(team.getByTestId("rule-team-target-before")).toContainText(item.targets[0]);
    await expect(team.getByTestId("rule-team-target-after")).toContainText(item.targets[1]);
    await expect(team.getByTestId("rule-team-completion-before")).toContainText(item.rates[0]);
    await expect(team.getByTestId("rule-team-completion-after")).toContainText(item.rates[1]);
    await expect(team.getByTestId("rule-team-payroll-before")).toContainText(item.totals[0]);
    await expect(team.getByTestId("rule-team-payroll-after")).toContainText(item.totals[1]);
    await team.getByTestId("rule-impact-expand").click();
    await expect(team.getByTestId("rule-impact-member")).toHaveCount(item.count);
    for (const field of [
      "rule-member-target-before", "rule-member-target-after",
      "rule-member-pay-before", "rule-member-pay-after",
    ] as const) {
      await expect(team.getByTestId(field)).toHaveCount(item.count);
      for (const value of await team.getByTestId(field).all()) {
        await expect(value).not.toHaveText(/^\s*$/);
      }
    }
    const firstMember = team.getByTestId("rule-impact-member").first();
    await expect(firstMember.getByTestId("rule-member-target-before")).toContainText(item.memberTargets[0]);
    await expect(firstMember.getByTestId("rule-member-target-after")).toContainText(item.memberTargets[1]);
    await expect(firstMember.getByTestId("rule-member-pay-before")).toContainText(item.memberPay[0]);
    await expect(firstMember.getByTestId("rule-member-pay-after")).toContainText(item.memberPay[1]);
  }
  const teamImpact = page.getByTestId("rule-impact-team").filter({ hasText: "车间一组" });
  const memberImpact = teamImpact.getByTestId("rule-impact-member").filter({ hasText: "余咸生" });
  await expect(memberImpact).toContainText("1,104,000");
  await expect(memberImpact).toContainText("960,000");
  await expect(memberImpact).toContainText("¥135.09");
  await expect(memberImpact).toContainText("¥155.36");
  await page.getByTestId("save-rule-draft").click();
  await page.getByTestId("activate-rule-version").click();
  await expect(page.getByTestId("rule-version-history")).toContainText("待生效");
  await page.goto("/performance?team=t1&month=2026-08");
  await expect(page.getByTestId("applied-rule-summary")).toContainText("V1");
  await expect(page.getByTestId("overview-team-target")).toContainText("5,152,000");
  await page.goto("/performance?team=t1&month=2026-07");
  await expect(page.getByTestId("applied-rule-summary")).toContainText("V1");
  await expect(page.getByTestId("applied-rule-summary")).toContainText("25%");
  await expect(page.getByTestId("applied-rule-summary")).toContainText("1 CNY = 23 JMD");
  await page.goto("/performance?view=rules");
  await expect(page.getByTestId("rule-version-history")).toContainText("V2");
  await expect(page.getByTestId("rule-version-history")).toContainText("待生效");
  await page.reload();
  await expect(page.getByTestId("rule-version-history")).toContainText("V2");
  await expect(page.getByTestId("rule-version-history")).toContainText("待生效");
});
```

Run: `E2E_BASE_URL=http://127.0.0.1:3005 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/performance-rules.spec.ts`
Expected: FAIL，规则页面和控件尚不存在。

- [ ] **Step 3: 实现规则页和固定公式展示**

`performance-workspace.tsx` 增加顶层切换：

```tsx
<div role="tablist" aria-label="绩效模块">
  <button role="tab" aria-selected={view === "team"} data-testid="performance-section-tab" data-section="team">班组绩效</button>
  <button role="tab" aria-selected={view === "rules"} data-testid="performance-section-tab" data-section="rules">绩效规则</button>
</div>
```

`performance-rules-panel.tsx` 显示当前版本、四条只读公式、版本状态和历史版本；当前版本元数据必须包含生效月份、创建人、创建时间和变更原因，创建时间的独立元素必须为 `data-testid="current-rule-created-at"`。演示 V1 固定存储 `2026-08-08T12:00:00-05:00`，并明确按 `America/Jamaica` 格式化为 `2026-08-08 12:00`，不得按 UTC 误显示为 17:00。`team-performance-detail.tsx` 从所选 `TeamMonthSnapshot.appliedRule` 显示 `data-testid="applied-rule-summary"`，历史月份必须显示当时锁定的版本、提成比例和汇率。页面不得包含用于输入运算符、变量名、JavaScript 或自由表达式的文本框。

只有 `permissions.canManageRules` 时显示 `data-testid="new-rule-version"`。无管理 capability 的身份读取完全相同的当前和历史规则数据。

- [ ] **Step 4: 实现草稿、预览、保存和启用状态机**

`rule-version-form.tsx` 只包含：

```ts
type RuleFormValues = {
  commissionRatePercent: string;
  cnyToJmdRate: string;
  effectiveMonth: string;
  reason: string;
};
```

状态机：

```ts
type RuleEditorState =
  | { status: "editing" }
  | { status: "previewing" }
  | { status: "previewed"; preview: RuleImpactPreview }
  | { status: "saving"; preview: RuleImpactPreview }
  | { status: "saved"; rule: PerformanceRuleVersion }
  | { status: "activating"; rule: PerformanceRuleVersion }
  | { status: "error"; message: string; preview?: RuleImpactPreview; rule?: PerformanceRuleVersion };
```

任何参数变更都使旧预览失效；没有有效预览时禁用保存和启用。`ruleSave/ruleActivate` fault 必须在对应 mutation 之前触发：保存失败不新增版本且不消费有效 preview token；启用失败保留已保存 draft、状态/revision/dashboard/锁定快照均不变。保存失败保留表单与 preview，启用失败保留已保存 draft rule，不得显示待生效/当前生效成功状态。影响表必须逐组显示旧/新班组指标、完成率、工资测算合计，并允许展开四组全部成员差异；对应字段固定使用 `rule-team-target-before/after`、`rule-team-completion-before/after`、`rule-team-payroll-before/after`，成员行固定使用 `rule-member-target-before/after` 和 `rule-member-pay-before/after` 测试节点。若全组工资合计数学上没有变化，显示“无变化”，不得伪造涨跌。

- [ ] **Step 5: 运行规则 E2E 并提交**

Run: `npm run test:unit && E2E_BASE_URL=http://127.0.0.1:3005 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/performance-rules.spec.ts`
Expected: PASS，30% / 24 的预览包含四组，2026-07 仍显示 V1、25% 和汇率 23。

```bash
git add src/components/performance/performance-rules-panel.tsx src/components/performance/rule-version-form.tsx src/components/performance/rule-impact-preview.tsx src/components/performance/performance-workspace.tsx src/components/performance/team-performance-detail.tsx tests/e2e/performance-rules.spec.ts
git commit -m "feat: add performance rule version manager"
```

---

### Task 3: 规则管理响应式、错误态与全量回归

**Files:**
- Modify: `tests/e2e/performance-rules.spec.ts`
- Modify: `design-qa.md`
- Create: `../qa/performance-rules-pass1-1920x841.png`
- Create: `../qa/performance-rules-pass1-dark-1920x841.png`
- Create: `../qa/performance-rules-pass1-430x932.png`
- Create: `../qa/performance-rules-pass1-dark-430x932.png`

**Interfaces:**
- Consumes: Tasks 1–2 的完整规则管理体验。
- Produces: 明暗主题、移动端、错误恢复、权限和历史不可变的最终证据。

- [ ] **Step 1: 写校验、失败恢复和 430px 红测**

在 `performance-rules.spec.ts` 增加：

```ts
test("非法参数和锁定月份不会产生虚假版本", async ({ page }) => {
  await page.goto("/performance?view=rules");
  await page.getByTestId("new-rule-version").click();
  const lockedMonth = page.getByTestId("rule-effective-month").locator('option[value="2026-07"]');
  await expect(lockedMonth).toHaveCount(1);
  await expect(lockedMonth).toBeDisabled();
  await page.getByTestId("rule-commission-input").fill("101");
  await page.getByTestId("rule-exchange-rate-input").fill("-1");
  await page.getByTestId("rule-change-reason").fill("   ");
  await expect(page.getByTestId("rule-form")).toContainText("不能超过 100%");
  await expect(page.getByTestId("rule-form")).toContainText("必须大于 0");
  await expect(page.getByTestId("rule-form")).toContainText("变更原因");
  await expect(page.getByTestId("preview-rule-impact")).toBeDisabled();
  await expect(page.getByTestId("rule-version-history")).not.toContainText("V2");
});

test("规则保存失败保留草稿和预览且不新增版本", async ({ browser }) => {
  const context = await browser.newContext();
  const failurePage = await context.newPage();
  const runtimeErrors = observePerformanceRuntimeErrors(failurePage);
  await usePerformanceIdentity(failurePage, "superadmin", "rule-save-failure-once");
  await failurePage.goto("/performance?view=rules");
  await failurePage.getByTestId("new-rule-version").click();
  await failurePage.getByTestId("rule-commission-input").fill("30");
  await failurePage.getByTestId("rule-exchange-rate-input").fill("24");
  await failurePage.getByTestId("rule-effective-month").selectOption("2026-09");
  await failurePage.getByTestId("rule-change-reason").fill("工时费提成调整并更新汇率");
  await failurePage.getByTestId("preview-rule-impact").click();
  await failurePage.getByTestId("save-rule-draft").click();
  await expect(failurePage.getByTestId("rule-save-error")).toContainText("演示规则保存失败");
  await expect(failurePage.getByTestId("rule-commission-input")).toHaveValue("30");
  await expect(failurePage.getByTestId("rule-impact-team")).toHaveCount(4);
  await expect(failurePage.getByTestId("rule-version-history")).not.toContainText("V2");
  await failurePage.reload();
  await expect(failurePage.getByTestId("rule-version-history")).not.toContainText("V2");
  await expect(failurePage.getByTestId("current-rule-version")).toContainText("V1");
  expect(runtimeErrors).toEqual([]);
  await context.close();
});

test("规则启用失败保留已保存草稿且不伪装为生效", async ({ browser }) => {
  const context = await browser.newContext();
  const failurePage = await context.newPage();
  const runtimeErrors = observePerformanceRuntimeErrors(failurePage);
  await usePerformanceIdentity(failurePage, "superadmin", "rule-activate-failure-once");
  await failurePage.goto("/performance?view=rules");
  await failurePage.getByTestId("new-rule-version").click();
  await failurePage.getByTestId("rule-commission-input").fill("30");
  await failurePage.getByTestId("rule-exchange-rate-input").fill("24");
  await failurePage.getByTestId("rule-effective-month").selectOption("2026-09");
  await failurePage.getByTestId("rule-change-reason").fill("工时费提成调整并更新汇率");
  await failurePage.getByTestId("preview-rule-impact").click();
  await failurePage.getByTestId("save-rule-draft").click();
  await failurePage.getByTestId("activate-rule-version").click();
  await expect(failurePage.getByTestId("rule-activate-error")).toContainText("演示规则启用失败");
  await expect(failurePage.getByTestId("rule-version-history")).toContainText("草稿");
  await expect(failurePage.getByTestId("rule-version-history")).not.toContainText("待生效");
  await expect(failurePage.getByTestId("current-rule-version")).toContainText("V1");
  await failurePage.reload();
  await expect(failurePage.getByTestId("rule-version-history")).toContainText("V2");
  await expect(failurePage.getByTestId("rule-version-history")).toContainText("草稿");
  await expect(failurePage.getByTestId("rule-version-history")).not.toContainText("待生效");
  expect(runtimeErrors).toEqual([]);
  await context.close();
});

test("四组预览数据不完整时保存和启用都被禁止", async ({ browser }) => {
  for (const [scenario, error] of [
    ["missing-rule-team", "四个班组数据不完整"],
    ["missing-rule-member-salary", "成员工资数据不完整"],
    ["missing-rule-actual", "实际绩效数据不完整"],
  ] as const) {
    const context = await browser.newContext();
    const incompletePage = await context.newPage();
    const runtimeErrors = observePerformanceRuntimeErrors(incompletePage);
    await usePerformanceIdentity(incompletePage, "superadmin", scenario);
    await incompletePage.goto("/performance?view=rules");
    await incompletePage.getByTestId("new-rule-version").click();
    await incompletePage.getByTestId("rule-commission-input").fill("30");
    await incompletePage.getByTestId("rule-exchange-rate-input").fill("24");
    await incompletePage.getByTestId("rule-effective-month").selectOption("2026-09");
    await incompletePage.getByTestId("rule-change-reason").fill("工时费提成调整并更新汇率");
    await incompletePage.getByTestId("preview-rule-impact").click();
    await expect(incompletePage.getByTestId("rule-preview-error")).toContainText(error);
    await expect(incompletePage.getByTestId("save-rule-draft")).toBeDisabled();
    await expect(incompletePage.getByTestId("activate-rule-version")).toBeDisabled();
    expect(runtimeErrors).toEqual([]);
    await context.close();
  }
});

test("430px 规则页无文档横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/performance?view=rules");
  await page.getByTestId("new-rule-version").click();
  await page.getByTestId("rule-commission-input").fill("30");
  await page.getByTestId("rule-exchange-rate-input").fill("24");
  await page.getByTestId("rule-effective-month").selectOption("2026-09");
  await page.getByTestId("rule-change-reason").fill("工时费提成调整并更新汇率");
  await page.getByTestId("preview-rule-impact").click();
  const width = await page.evaluate(() => [
    document.documentElement.clientWidth,
    document.documentElement.scrollWidth,
  ]);
  expect(width[1]).toBe(width[0]);
  await expect(page.getByTestId("rule-impact-scroll")).toHaveCSS("overflow-x", "auto");
  expect(await page.getByTestId("rule-impact-scroll").evaluate((element) =>
    element.scrollWidth > element.clientWidth,
  )).toBe(true);
  const dialogBox = await page.getByTestId("rule-editor-dialog").boundingBox();
  expect(dialogBox?.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox?.y).toBeGreaterThanOrEqual(0);
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(430);
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(932);
  await expect(page.getByTestId("rule-editor-dialog")).toHaveCSS("overflow-y", "auto");
});
```

- [ ] **Step 2: 运行红测并完成错误态和移动端修复**

Run: `E2E_BASE_URL=http://127.0.0.1:3005 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/performance-rules.spec.ts --grep "非法参数|规则保存失败|规则启用失败|数据不完整|430px"`
Expected: 初次缺失校验文案、影响表自身滚动或移动 Dialog 约束时 FAIL；只修复这些失败。

- [ ] **Step 3: 生成规则页视觉证据并更新 QA 结论**

在 1920×841 和 430×932 下生成明暗四张截图到外置卷 `../qa`。检查当前版本、只读公式、表单、四组影响表、版本历史、错误文案和移动端滚动。完成 P0/P1/P2 修复后，把证据加入 `design-qa.md`，并保持文件最后一行：

```text
final result: passed
```

- [ ] **Step 4: 运行两份计划的全量验证**

Run:

```bash
npm run test:unit
npm run test:collaboration
E2E_BASE_URL=http://127.0.0.1:3005 E2E_REUSE_SERVER=0 npm run test:e2e
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: 全部 exit 0；无新增 warning、console error 或 page error，既有 dashboard 和班组绩效详情测试全部继续通过。

- [ ] **Step 5: 提交最终规则 QA**

```bash
git add tests/e2e/performance-rules.spec.ts design-qa.md
git commit -m "test: verify performance rule versioning"
```
