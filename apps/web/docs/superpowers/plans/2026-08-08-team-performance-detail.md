# 班组绩效详情与工资测算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将四张班组卡连接到真实绩效详情，提供当月、上月、历史趋势、成员工资测算及当前未锁定月份的标准工资编辑。

**Architecture:** 新增独立绩效领域层，以纯函数计算个人携带班组指标、班组统一完成率、工资测算和历史比较；Mock 仓库保存当前活数据及不可变历史快照，并通过现有 `api` 客户端暴露统一合同。`/performance` 只负责组合班组、月份、趋势、历史和成员详情组件，工资修改必须先预览，再由领域层重算整组。

**Tech Stack:** Next.js 14.2.5、React 18.3.1、TypeScript 5.5.4、Tailwind CSS 3.4.7、Recharts 2.12.7、Playwright 1.54.2。

## Global Constraints

- 所有生成文件、依赖缓存、截图和 QA 输出必须位于外置卷 `/Volumes/公司文件`。
- 四张班组卡共用同一详情结构；路由使用 `/performance?team=t1` 至 `/performance?team=t4`。
- 所有具备查看权限的身份看到相同默认月份、字段、历史入口和数据布局；仅写操作由 capability 控制。
- 管理系统绩效详情不设置签名；维修端签名不在本计划范围。
- 页面默认当前月份，并提供上月整月数据和全部历史锁定月份。
- 个人携带班组指标为 `月标准工资 ÷ 工时费提成比例 × 人民币汇率`。
- 班组指标为当月所有成员携带班组指标之和；实际绩效不分配到个人。
- 所有成员统一使用班组完成率；成员列表不得出现个人完成率列。
- 修改月标准工资只影响指定未锁定月份；历史锁定快照不可变。
- 当前 Mock 规则参数固定为工时费提成比例 `0.25`、人民币汇率 `23`、最低应发工资 `0`。
- 经营概览使用 2026 年 8 月当前归集数据；2026 年 7 月作为上月完整锁定数据。
- 趋势图默认最近 12 个完整月份并可附带当前归集月份；历史平均排除当前月和被比较月份本身。
- 使用已安装的 Recharts，不引入第二套图表或 UI 组件库。
- 自动化测试使用独立端口 `3005`，不得复用用户正在查看的 `3002`。
- 视觉目标为已确认并固化在外置卷的布局截图：`/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/team-performance-approved-layout-1920.png`。原可交互示意只作为同一工作树内补充，不作为唯一证据。

## File Map

- Create `playwright.unit.config.ts`: 无浏览器、无开发服务器的 TypeScript 纯逻辑测试配置。
- Create `tests/unit/performance-calculations.spec.ts`: 公式、特殊月份、历史平均和工资重算测试。
- Create `src/lib/performance/types.ts`: 绩效领域类型和 API DTO。
- Create `src/lib/performance/calculations.ts`: 无副作用绩效计算函数。
- Create `src/lib/api/mock-performance.ts`: 四组当前数据、12 个月历史快照、工资修改记录与 dashboard 摘要。
- Modify `src/lib/api/client.ts`: 绩效读取、成员详情、工资预览和保存 API。
- Modify `src/lib/api/mock-data.ts`: dashboard 班组摘要改为读取绩效 Mock 仓库。
- Modify `src/lib/utils.ts`: CNY、百分比和年月格式化。
- Create `src/components/ui/dialog.tsx`: 可访问、可滚动的通用浮窗。
- Create `src/components/performance/performance-workspace.tsx`: 页面加载、URL 状态和 mutation 协调。
- Create `src/components/performance/team-performance-detail.tsx`: 班组详情组合层。
- Create `src/components/performance/performance-trend-chart.tsx`: 三指标趋势与历史平均线。
- Create `src/components/performance/performance-history-table.tsx`: 历月锁定结果。
- Create `src/components/performance/member-payroll-table.tsx`: 成员工资测算表。
- Create `src/components/performance/member-salary-dialog.tsx`: 成员历月工资、调整预览和保存。
- Modify `src/app/performance/page.tsx`: 用真实绩效工作台替换占位页。
- Modify `src/components/dashboard/team-performance.tsx`: 四组链接携带 `team` 查询参数并修正文案。
- Modify `src/components/layout/sidebar.tsx`: 增加稳定的“绩效管理”入口。
- Create `tests/e2e/helpers/performance-session.ts`: 身份、Mock 状态重置和可重复错误场景注入。
- Modify `tests/e2e/dashboard.spec.ts`: 更新四组目的地断言并保留原视觉回归。
- Create `tests/e2e/performance-detail.spec.ts`: 月份、趋势、工资编辑、权限一致和响应式流程。

---

### Task 1: 绩效领域类型与纯计算

**Files:**
- Create: `playwright.unit.config.ts`
- Modify: `package.json`
- Create: `src/lib/performance/types.ts`
- Create: `src/lib/performance/calculations.ts`
- Test: `tests/unit/performance-calculations.spec.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `PerformanceRuleParameters`、`AppliedRuleSnapshot`、`TeamMemberMonthInput`、`TeamMonthSnapshot`、`SalaryChangeCalculation`、`PerformanceHistoryRow`；以及 `calculateCarriedTargetJmd()`、`calculateTeamMonth()`、`previewSalaryChange()`、`buildHistoryComparisons()`。

- [ ] **Step 1: 建立无服务器单元测试入口并写公式红测**

在 `package.json` 增加：

```json
"test:unit": "playwright test --config=playwright.unit.config.ts"
```

创建 `playwright.unit.config.ts`：

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/unit",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 5_000,
  reporter: [["line"]],
});
```

创建 `tests/unit/performance-calculations.spec.ts`，先覆盖完整月基线：

```ts
import { expect, test } from "@playwright/test";
import {
  buildHistoryComparisons,
  calculateCarriedTargetJmd,
  calculateTeamMonth,
  previewSalaryChange,
} from "../../src/lib/performance/calculations";

const rule = {
  ruleId: "rule-2025-08",
  version: "V1",
  commissionRate: 0.25,
  cnyToJmdRate: 23,
  minimumPayableCny: 0,
};

const members = [
  { memberId: "EMP-UAT-040", employeeNo: "WH-0040", name: "余咸生", role: "组长", standardSalaryCny: 12_000 },
  { memberId: "EMP-UAT-041", employeeNo: "WH-0041", name: "余一鹤", role: "组员", standardSalaryCny: 14_000 },
  { memberId: "EMP-UAT-042", employeeNo: "WH-0042", name: "翁雄", role: "组员", standardSalaryCny: 16_000 },
  { memberId: "EMP-UAT-056", employeeNo: "WH-0056", name: "王林", role: "组员", standardSalaryCny: 14_000 },
].map((member) => ({ ...member, calculationKind: "full_month" as const }));

test("个人工资换算为携带班组指标", () => {
  expect(calculateCarriedTargetJmd(members[0], rule)).toBe(1_104_000);
});

test("四人指标形成班组指标并统一计算工资", () => {
  const result = calculateTeamMonth({
    teamId: "t1",
    teamName: "车间一组",
    month: "2026-07",
    status: "locked",
    actualPerformanceJmd: 163_000,
    members,
    rule,
  });
  expect(result.teamTargetJmd).toBe(5_152_000);
  expect(result.completionRate).toBeCloseTo(163_000 / 5_152_000, 10);
  expect(result.members.map((member) => Number(member.estimatedPayableCny?.toFixed(2))))
    .toEqual([379.66, 442.93, 506.21, 442.93]);
  expect(result.members.map((member) => member.wageBudgetCny))
    .toEqual(result.members.map((member) => member.estimatedPayableCny));
});
```

- [ ] **Step 2: 运行红测确认领域层尚不存在**

Run: `npm run test:unit -- tests/unit/performance-calculations.spec.ts`
Expected: FAIL，错误明确指向 `../../src/lib/performance/calculations` 不存在或导出缺失。

- [ ] **Step 3: 定义精确领域类型并实现完整月公式**

在 `src/lib/performance/types.ts` 定义：

```ts
export type YearMonth = `${number}-${string}`;
export type PerformanceTeamId = "t1" | "t2" | "t3" | "t4";
export type MonthStatus = "collecting" | "locked";
export type EmploymentCalculationKind =
  | "full_month"
  | "joined_first_month"
  | "left_mid_month";

export interface PerformanceRuleParameters {
  commissionRate: number;
  cnyToJmdRate: number;
  minimumPayableCny: number;
}

export interface AppliedRuleSnapshot extends PerformanceRuleParameters {
  ruleId: string;
  version: string;
}

export interface TeamMemberMonthInput {
  memberId: string;
  employeeNo: string;
  name: string;
  role: string;
  standardSalaryCny: number | null;
  calculationKind: EmploymentCalculationKind;
  prorationRatio?: number;
  prorationBasis?: string;
}

export interface TeamMemberMonthResult extends TeamMemberMonthInput {
  carriedTargetJmd: number | null;
  wageBaseCny: number | null;
  wageBudgetCny: number | null;
  estimatedPayableCny: number | null;
  calculationError?: string;
}

export interface CalculateTeamMonthInput {
  teamId: string;
  teamName: string;
  month: YearMonth;
  status: MonthStatus;
  actualPerformanceJmd: number | null;
  members: TeamMemberMonthInput[];
  rule: AppliedRuleSnapshot;
}

export interface TeamMonthSnapshot {
  teamId: string;
  teamName: string;
  month: YearMonth;
  status: MonthStatus;
  actualPerformanceJmd: number | null;
  teamTargetJmd: number | null;
  completionRate: number | null;
  payrollTotalCny: number | null;
  calculationErrors: string[];
  appliedRule: AppliedRuleSnapshot;
  members: TeamMemberMonthResult[];
}

export interface PerformancePermissions {
  canViewPerformance: boolean;
  canEditSalary: boolean;
  canManageRules: boolean;
}

export interface PerformanceAccessContext {
  actorId: string;
  permissions: PerformancePermissions;
}

export type HistoryComparisonStatus =
  | "up"
  | "down"
  | "unchanged"
  | "insufficient_history";

export interface PerformanceMetricValues {
  completionRate: number | null;
  actualPerformanceJmd: number | null;
  payrollTotalCny: number | null;
}

export interface PerformanceHistoryRow {
  snapshot: TeamMonthSnapshot;
  previousMonthDelta: PerformanceMetricValues;
  historicalAverage: PerformanceMetricValues;
  comparisonStatus: Record<"completion" | "actual" | "payroll", HistoryComparisonStatus>;
}

export interface TeamPerformanceDetailResponse {
  selected: TeamMonthSnapshot;
  currentMonth: YearMonth;
  previousCompleteMonth: YearMonth | null;
  lockedMonths: YearMonth[];
  history: PerformanceHistoryRow[];
  permissions: PerformancePermissions;
}

export interface PerformanceMemberDetail {
  teamId: string;
  selectedMonth: YearMonth;
  member: TeamMemberMonthResult;
  teamCompletionRate: number | null;
  history: Array<{ month: YearMonth; result: TeamMemberMonthResult }>;
  salaryAdjustments: SalaryAdjustmentRecord[];
  permissions: PerformancePermissions;
}

export interface SalaryAdjustmentRecord {
  id: string;
  teamId: PerformanceTeamId;
  memberId: string;
  month: YearMonth;
  fromCny: number;
  toCny: number;
  changedBy: string;
  changedAt: string;
}

export interface UpdateStandardSalaryInput {
  teamId: string;
  memberId: string;
  month: YearMonth;
  newSalaryCny: number;
}

export interface SalaryChangeCalculation {
  input: UpdateStandardSalaryInput;
  changedMemberId: string;
  before: TeamMonthSnapshot;
  after: TeamMonthSnapshot;
}

export interface SalaryChangePreview extends SalaryChangeCalculation {
  previewToken: string;
  sourceRevision: number;
}

export interface SaveStandardSalaryInput extends UpdateStandardSalaryInput {
  previewToken: string;
}

export interface UpdateStandardSalaryResult {
  detail: TeamPerformanceDetailResponse;
  member: PerformanceMemberDetail;
}

export interface MockPerformanceState {
  sourceRevision: number;
  currentMonth: YearMonth;
  previousCompleteMonth: YearMonth;
  currentTeams: Record<PerformanceTeamId, CalculateTeamMonthInput>;
  lockedSnapshots: Record<PerformanceTeamId, Partial<Record<YearMonth, TeamMonthSnapshot>>>;
  salaryAdjustments: SalaryAdjustmentRecord[];
}

export interface PersistedPerformanceEnvelopeV1 {
  schemaVersion: 1;
  state: MockPerformanceState;
}
```

在 `src/lib/performance/calculations.ts` 实现不读取身份、存储、React 或当前时间的纯函数：

```ts
function requiredProrationRatio(member: TeamMemberMonthInput): number {
  if (
    member.prorationRatio === undefined ||
    !Number.isFinite(member.prorationRatio) ||
    member.prorationRatio < 0 ||
    member.prorationRatio > 1
  ) {
    throw new Error(`成员 ${member.memberId} 的工资折算比例无效`);
  }
  return member.prorationRatio;
}

export function calculateCarriedTargetJmd(
  member: TeamMemberMonthInput,
  rule: PerformanceRuleParameters,
): number | null {
  if (member.standardSalaryCny === null) return null;
  if (member.calculationKind === "joined_first_month") return 0;
  const fullTarget = member.standardSalaryCny / rule.commissionRate * rule.cnyToJmdRate;
  if (member.calculationKind === "left_mid_month") {
    return fullTarget * requiredProrationRatio(member);
  }
  return fullTarget;
}
```

`calculateTeamMonth()` 必须严格按以下顺序实现：先算每人指标、再合计班组指标、再以未改变的实际绩效算统一完成率、最后以该统一完成率重算所有成员工资并合计。完整月 `wageBaseCny = standardSalaryCny`，`wageBudgetCny = wageBaseCny × completionRate`，`estimatedPayableCny = max(minimumPayableCny, wageBudgetCny)`；月中离职先折算 wage base，入职首月按已确认折算比例直接形成 wage budget、不乘完成率。工资保留内部精度，显示层再四舍五入。

计算前先校验 `commissionRate > 0`、`cnyToJmdRate > 0`、成员和实际绩效字段完整。任何应参与计算的成员缺工资时，班组指标、完成率和工资合计返回 `null` 并带明确错误，不得跳过该成员。`teamTargetJmd === 0` 时完成率为 `null` 并显示“班组指标为 0，无法计算完成率”，不得产生 `Infinity` 或把 `0 / 0` 当作 `0%`；入职首月按天数折算的工资仍可独立显示。

本页面不自行决定“实际工作天数”的分母。特殊月份由上游考勤/工资口径传入已经确认的 `prorationRatio` 和可展示的 `prorationBasis`；领域层只校验比例是有限数且位于 `0..1`。测试中的 `12 / 26`、`8 / 26` 只是明确 fixture，不把 26 写成系统规则。真实接口缺少已确认折算比例时返回计算错误，不猜测日历天数、排班天数或固定计薪天数。

- [ ] **Step 4: 增加特殊月份、历史平均和工资调整红测**

在同一测试文件加入：

```ts
test("入职首月指标为零且工资只按工作天数折算", () => {
  const result = calculateTeamMonth({
    teamId: "t1", teamName: "车间一组", month: "2026-08",
    status: "collecting", actualPerformanceJmd: 163_000, rule,
    members: [{
      ...members[0],
      calculationKind: "joined_first_month",
      prorationRatio: 12 / 26,
      prorationBasis: "测试输入 12 / 26",
    }],
  });
  expect(result.members[0].carriedTargetJmd).toBe(0);
  expect(result.members[0].wageBudgetCny).toBeCloseTo(12_000 * 12 / 26, 10);
  expect(result.members[0].estimatedPayableCny).toBeCloseTo(12_000 * 12 / 26, 10);
  expect(result.completionRate).toBeNull();
  expect(result.calculationErrors).toContain("班组指标为 0，无法计算完成率");
});

test("月中离职先按天数折算指标和工资基数再乘班组完成率", () => {
  const departing = {
    ...members[0],
    calculationKind: "left_mid_month" as const,
    prorationRatio: 8 / 26,
    prorationBasis: "测试输入 8 / 26",
  };
  const result = calculateTeamMonth({
    teamId: "t1", teamName: "车间一组", month: "2026-08",
    status: "collecting", actualPerformanceJmd: 10_000, rule,
    members: [departing],
  });
  expect(result.members[0].carriedTargetJmd).toBeCloseTo(1_104_000 * 8 / 26, 10);
  expect(result.members[0].wageBaseCny).toBeCloseTo(12_000 * 8 / 26, 10);
  expect(result.members[0].wageBudgetCny)
    .toBeCloseTo((12_000 * 8 / 26) * result.completionRate!, 10);
  expect(result.members[0].estimatedPayableCny)
    .toBeCloseTo((12_000 * 8 / 26) * result.completionRate!, 10);
});

test("工资调整重算班组指标、统一完成率及全组工资且不改原输入", () => {
  const collecting = calculateTeamMonth({
    teamId: "t1", teamName: "车间一组", month: "2026-08",
    status: "collecting", actualPerformanceJmd: 58_000, members, rule,
  });
  const before = structuredClone(collecting);
  const preview = previewSalaryChange(collecting, "EMP-UAT-040", 13_000);
  expect(preview.after.teamTargetJmd).toBe(5_244_000);
  expect(preview.after.members[0].carriedTargetJmd).toBe(1_196_000);
  expect(preview.before.payrollTotalCny).toBeCloseTo(58_000 * 0.25 / 23, 10);
  expect(preview.after.payrollTotalCny).toBeCloseTo(preview.before.payrollTotalCny!, 10);
  expect(preview.before.members.map((member) => Number(member.estimatedPayableCny?.toFixed(2))))
    .toEqual([135.09, 157.61, 180.12, 157.61]);
  expect(preview.after.members.map((member) => Number(member.estimatedPayableCny?.toFixed(2))))
    .toEqual([143.78, 154.84, 176.96, 154.84]);
  expect(collecting).toEqual(before);
});

test("锁定月份拒绝工资预览", () => {
  const locked = calculateTeamMonth({
    teamId: "t1", teamName: "车间一组", month: "2026-07",
    status: "locked", actualPerformanceJmd: 163_000, members, rule,
  });
  expect(() => previewSalaryChange(locked, "EMP-UAT-040", 13_000)).toThrow(/月份已锁定/);
});

test("工资预算与最低应发工资是两个独立结果", () => {
  const result = calculateTeamMonth({
    teamId: "t1", teamName: "车间一组", month: "2026-08",
    status: "collecting", actualPerformanceJmd: 0, members: [members[0]],
    rule: { ...rule, minimumPayableCny: 100 },
  });
  expect(result.members[0].wageBudgetCny).toBe(0);
  expect(result.members[0].estimatedPayableCny).toBe(100);
});

test("历史平均只使用被比较月份之前的锁定月份", () => {
  const locked = [
    ["2026-05", 100_000],
    ["2026-06", 150_000],
    ["2026-07", 163_000],
  ].map(([month, actualPerformanceJmd]) => calculateTeamMonth({
    teamId: "t1", teamName: "车间一组", month: month as `2026-${string}`,
    status: "locked", actualPerformanceJmd: actualPerformanceJmd as number,
    members, rule,
  }));
  const current = calculateTeamMonth({
    teamId: "t1", teamName: "车间一组", month: "2026-08",
    status: "collecting", actualPerformanceJmd: 58_000, members, rule,
  });
  const rows = buildHistoryComparisons([...locked, current]);
  const july = rows.find((row) => row.snapshot.month === "2026-07")!;
  expect(july.historicalAverage.completionRate!).toBeCloseTo(
    (locked[0].completionRate! + locked[1].completionRate!) / 2,
    10,
  );
  expect(rows.some((row) => row.snapshot.month === "2026-08")).toBe(false);
});
```

- [ ] **Step 5: 运行新增红测，再实现特殊月份、工资预览和历史比较**

Run: `npm run test:unit -- tests/unit/performance-calculations.spec.ts`
Expected: FAIL，明确指向特殊月份折算、`previewSalaryChange()` 或 `buildHistoryComparisons()` 尚未满足新增断言；此时不得先改实现来跳过 RED。

实现纯函数 `previewSalaryChange(snapshot, memberId, newSalaryCny)` 时先深拷贝成员输入再调用 `calculateTeamMonth()`，返回不含 token 的 `SalaryChangeCalculation`，不得修改传入快照；完整月中单人标准工资变化会改变个人分配，但全组工资合计在该公式下可能保持不变，预览必须如实显示“无变化”。store/API 边界再把该计算结果包装为带 `previewToken/sourceRevision` 的 `SalaryChangePreview`。实现 `buildHistoryComparisons()` 时，只使用被比较月份之前的 `locked` 月份；排除当前 `collecting` 月和被比较月份本身，并分别计算完成率、实际绩效和工资测算三种单位的上月差值及滚动历史平均。没有此前锁定月份时，三个 `historicalAverage` 字段均为 `null`，对应 `comparisonStatus` 均为 `"insufficient_history"`。

- [ ] **Step 6: 运行完整领域绿测并提交**

Run: `npm run test:unit`
Expected: PASS，且不启动 Chrome 或 Next.js 服务器。

```bash
git add package.json playwright.unit.config.ts src/lib/performance/types.ts src/lib/performance/calculations.ts tests/unit/performance-calculations.spec.ts
git commit -m "feat: add performance calculation domain"
```

---

### Task 2: Mock 绩效仓库、API 合同与仪表盘一致性

**Files:**
- Create: `src/lib/api/mock-performance.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/lib/api/mock-data.ts`
- Modify: `src/lib/utils.ts`
- Test: `tests/unit/performance-store.spec.ts`

**Interfaces:**
- Consumes: Task 1 的计算函数和领域类型。
- Produces: `buildMockPerformanceStateV1()`、`getMockTeamPerformanceDetail()`、`getMockMemberDetail()`、`previewMockSalaryChange()`、`updateMockStandardSalary()`、`getMockDashboardPerformance()`、测试/迁移专用 `exportEnvelope()`；以及 `api.performance.team()`、`api.performance.member()`、`api.performance.previewSalary()`、`api.performance.updateSalary()`。

- [ ] **Step 1: 写仓库历史不可变与 dashboard 同源红测**

创建 `tests/unit/performance-store.spec.ts`：

```ts
import { expect, test } from "@playwright/test";
import {
  createMockPerformanceStore,
} from "../../src/lib/api/mock-performance";
import type {
  SaveStandardSalaryInput,
  UpdateStandardSalaryInput,
} from "../../src/lib/performance/types";

test("当前月改工资后 dashboard 与详情同源且七月锁定快照不变", () => {
  const store = createMockPerformanceStore();
  const editor = {
    actorId: "emp-001",
    permissions: { canViewPerformance: true, canEditSalary: true, canManageRules: true },
  };
  const revisionBefore = store.exportEnvelope().state.sourceRevision;
  const lockedBefore = structuredClone(store.exportEnvelope().state.lockedSnapshots);
  const julyBefore = structuredClone(store.team("t1", "2026-07").selected);
  const preview = store.previewSalary(editor, {
    teamId: "t1", memberId: "EMP-UAT-040", month: "2026-08", newSalaryCny: 13_000,
  });
  expect(preview.after.teamTargetJmd).not.toBe(preview.before.teamTargetJmd);
  store.updateSalary(editor, { ...preview.input, previewToken: preview.previewToken });
  expect(store.exportEnvelope().state.sourceRevision).toBe(revisionBefore + 1);
  const dashboard = store.dashboardPerformance();
  expect(dashboard.teams.find((team) => team.id === "t1")?.targetAmount)
    .toBe(store.team("t1", "2026-08").selected.teamTargetJmd);
  expect(dashboard.targetCompletedAmount).toBe(122_500);
  expect(dashboard.targetCompletedAmount)
    .toBe(dashboard.teams.reduce((sum, team) => sum + team.currentAmount, 0));
  expect(dashboard.targetTotalAmount)
    .toBe(dashboard.teams.reduce((sum, team) => sum + team.targetAmount, 0));
  expect(dashboard.targetCompletionRate).toBe(Number((
    dashboard.targetCompletedAmount / dashboard.targetTotalAmount * 100
  ).toFixed(1)));
  expect(store.team("t1", "2026-07").selected).toEqual(julyBefore);
  expect(store.exportEnvelope().state.lockedSnapshots).toEqual(lockedBefore);
});

test("只读 capability 不能绕过 UI 预览或保存工资", () => {
  const store = createMockPerformanceStore();
  const readOnly = {
    actorId: "emp-003",
    permissions: { canViewPerformance: true, canEditSalary: false, canManageRules: false },
  };
  const input = {
    teamId: "t1", memberId: "EMP-UAT-040", month: "2026-08" as const, newSalaryCny: 13_000,
  };
  expect(() => store.previewSalary(readOnly, input)).toThrow(/无权/);
  expect(() => store.updateSalary(readOnly, { ...input, previewToken: "forged" })).toThrow(/无权/);
});

test("store 拒绝锁定月份、错误成员、非法金额和绕过预览", () => {
  const store = createMockPerformanceStore();
  const editor = {
    actorId: "emp-001",
    permissions: { canViewPerformance: true, canEditSalary: true, canManageRules: true },
  };
  const valid: UpdateStandardSalaryInput = {
    teamId: "t1", memberId: "EMP-UAT-040", month: "2026-08", newSalaryCny: 13_000,
  };
  const invalidInputs: UpdateStandardSalaryInput[] = [
    { ...valid, month: "2026-07" },
    { ...valid, teamId: "t2" },
    ...[0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001]
      .map((newSalaryCny) => ({ ...valid, newSalaryCny })),
  ];
  for (const input of invalidInputs) {
    expect(() => store.previewSalary(editor, input)).toThrow(/月份已锁定|成员不属于班组|标准工资金额无效/);
    expect(() => store.updateSalary(editor, { ...input, previewToken: "forged" }))
      .toThrow(/月份已锁定|成员不属于班组|标准工资金额无效/);
  }
  expect(() => store.updateSalary(editor, { ...valid, previewToken: "forged" }))
    .toThrow(/请先预览|预览凭证无效/);
});

test("工资预览绑定 exact input 与 source revision", () => {
  const store = createMockPerformanceStore();
  const editor = {
    actorId: "emp-001",
    permissions: { canViewPerformance: true, canEditSalary: true, canManageRules: true },
  };
  const first: UpdateStandardSalaryInput = {
    teamId: "t1", memberId: "EMP-UAT-040", month: "2026-08", newSalaryCny: 13_000,
  };
  const stale = store.previewSalary(editor, first);
  expect(() => store.updateSalary(editor, {
    ...first, newSalaryCny: 13_001, previewToken: stale.previewToken,
  })).toThrow(/预览内容已变化|重新预览/);

  const second: UpdateStandardSalaryInput = {
    teamId: "t1", memberId: "EMP-UAT-041", month: "2026-08", newSalaryCny: 15_000,
  };
  const secondPreview = store.previewSalary(editor, second);
  store.updateSalary(editor, { ...second, previewToken: secondPreview.previewToken });
  const staleSave: SaveStandardSalaryInput = { ...first, previewToken: stale.previewToken };
  expect(() => store.updateSalary(editor, staleSave)).toThrow(/源数据已变化|重新预览/);
  expect(store.team("t1", "2026-08").selected.members
    .find((member) => member.memberId === "EMP-UAT-040")?.standardSalaryCny).toBe(12_000);
});
```

- [ ] **Step 2: 运行红测确认 Mock 仓库不存在**

Run: `npm run test:unit -- tests/unit/performance-store.spec.ts`
Expected: FAIL，缺少 `mock-performance` 模块或 `createMockPerformanceStore`。

- [ ] **Step 3: 实现版本化 Mock 状态与 12 个月锁定快照**

`src/lib/api/mock-performance.ts` 使用 `wh_performance_mock_v1` 作为浏览器持久化 key，并导出默认纯内存、可注入测试的 `createMockPerformanceStore({ initialState?, storage?, faults? } = {})`。模块导入阶段不得读取 `window` 或 `localStorage`；浏览器单例再显式注入 `Storage`。持久化使用 `types.ts` 的 `PersistedPerformanceEnvelopeV1`，读取未知 schema 时明确迁移或重建演示种子，不得半解析旧状态：

```ts
type MockPerformanceOperation = "teamRead" | "salaryPreview" | "salarySave";
interface MockPerformanceFaults {
  failNext?: Partial<Record<MockPerformanceOperation, string>>;
  delayMs?: Partial<Record<MockPerformanceOperation, number>>;
  dataScenario?: "emptyHistory" | "missingStandardSalary";
}
```

每个 `failNext` 错误只消费一次，便于页面显示错误后点击重试；浏览器单例把测试专用的 `window.__WH_PERFORMANCE_TEST_SCENARIO__` 映射为这些注入项。该全局变量只存在于 Mock/E2E，生产 API 不读取它。

`sourceRevision` 从 1 开始，只在会改变绩效计算源的成功写入后递增（当前工资、当前成员/实际绩效、规则启用）；普通读取、失败写入和仅保存规则草稿不得递增。它用于阻止基于陈旧源数据保存预览。

工资预览凭证保存在 store 的非持久化一次性 registry 中，记录 `{ normalizedInput, sourceRevision }`；token 本身使用不可预测随机值。浏览器刷新后旧 token 自然失效，用户必须重新预览。`updateSalary()` 先做权限和输入校验，再核对 registry 与当前 revision，持久化成功后才删除 token并递增 `sourceRevision`。

种子数据必须包含：

```ts
const CURRENT_MONTH = "2026-08";
const PREVIOUS_COMPLETE_MONTH = "2026-07";
const ACTIVE_RULE = {
  ruleId: "rule-v1",
  version: "V1",
  commissionRate: 0.25,
  cnyToJmdRate: 23,
  minimumPayableCny: 0,
};

const TEAM_SALARIES = {
  t1: [12_000, 14_000, 16_000, 14_000],
  t2: [18_000, 20_000, 16_000],
  t3: [14_000, 16_000, 20_000],
  t4: [12_000, 18_000],
};

const T1_ROSTER = [
  { memberId: "EMP-UAT-040", employeeNo: "WH-0040", name: "余咸生", role: "组长", standardSalaryCny: 12_000 },
  { memberId: "EMP-UAT-041", employeeNo: "WH-0041", name: "余一鹤", role: "组员", standardSalaryCny: 14_000 },
  { memberId: "EMP-UAT-042", employeeNo: "WH-0042", name: "翁雄", role: "组员", standardSalaryCny: 16_000 },
  { memberId: "EMP-UAT-056", employeeNo: "WH-0056", name: "王林", role: "组员", standardSalaryCny: 14_000 },
];

const JULY_ACTUAL = { t1: 163_000, t2: 177_500, t3: 0, t4: 0 };
const AUGUST_ACTUAL = { t1: 58_000, t2: 64_500, t3: 0, t4: 0 };
```

这些 2026-08 当前月和更早趋势值都是固定演示种子，不得标成真实账务事实，也不得随机生成。`2025-08` 至 `2026-07` 的实际绩效固定数组为：

```ts
const LOCKED_ACTUALS = {
  t1: [198_000, 225_000, 207_000, 240_000, 218_000, 210_000, 255_000, 188_000, 302_000, 246_000, 285_000, 163_000],
  t2: [205_000, 238_000, 220_000, 252_000, 229_000, 218_000, 264_000, 196_000, 315_000, 255_000, 296_000, 177_500],
  t3: [0, 45_000, 0, 80_000, 65_000, 0, 90_000, 75_000, 110_000, 0, 40_000, 0],
  t4: [88_000, 72_000, 95_000, 110_000, 105_000, 120_000, 98_000, 130_000, 115_000, 140_000, 90_000, 0],
};
```

车间一组必须严格使用上述已确认的四名成员，特别是王林的展示编号为 `WH-0056`，不得按数组下标误生成为 `WH-0043`；内部 `memberId` 与展示 `employeeNo` 不得混用。t2–t4 尚无用户确认的实名名单，只能使用明确标注为 synthetic UAT 的稳定成员资料，不得伪装成真实员工。正式演示种子只放入有明确标准工资的绩效成员；缺工资错误态使用独立测试 fixture，整个班组返回不可完整测算，不得静默从合计中排除该成员。

至少生成 `2025-08` 至 `2026-07` 的锁定快照。锁定快照存完整 `members`、`appliedRule` 和计算结果，读取历史时直接返回快照，不使用当前工资或当前规则重算。工资为空的成员必须使用 `standardSalaryCny: null` 并返回明确 `calculationError`，不得当作 `0`。

- [ ] **Step 4: 接入 API 客户端与 dashboard 摘要**

在 `src/lib/api/client.ts` 增加真实与 Mock 共用接口：

```ts
performance: {
  team: (teamId: string, month?: string) =>
    request<TeamPerformanceDetailResponse>(
      `/api/performance/teams/${teamId}${month ? `?month=${month}` : ""}`,
    ),
  member: (teamId: string, memberId: string, month: string) =>
    request<PerformanceMemberDetail>(
      `/api/performance/teams/${teamId}/members/${memberId}?month=${month}`,
    ),
  previewSalary: (input: UpdateStandardSalaryInput) =>
    request<SalaryChangePreview>("/api/performance/salary/preview", {
      method: "POST", body: JSON.stringify(input),
    }),
  updateSalary: (input: SaveStandardSalaryInput) =>
    request<UpdateStandardSalaryResult>(
      `/api/performance/teams/${input.teamId}/members/${input.memberId}/standard-salary`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
}
```

Mock API 从 `wh_session` 解析 session，再把 `{ actorId, permissions }` 显式传给 store；所有绩效读取先校验 `canViewPerformance`，所有 store 写方法都不接受缺失 access context 的调用。Mock 写操作必须再次校验 `canEditSalary` 和月份 `status === "collecting"`，不能只依赖隐藏按钮。动态 Mock 路径先用 `new URL(path, "http://mock")` 拆出 `pathname` 和 `searchParams` 再匹配。真实 `request()` 失败时解析 JSON `error/message` 并抛统一 `ApiError`，页面才能显示真实原因。`mockDashboard()` 改为读取 `getMockDashboardPerformance()`：四张卡和页头聚合必须都来自 2026-08 当前月；页头 `targetCompletedAmount` 为四组 `currentAmount` 合计 `122,500`，`targetTotalAmount` 为四组 `targetAmount` 合计，`targetCompletionRate` 由两者现场计算，禁止继续硬编码旧的 2026-07 `340,500 / 1.9%`。详情保留完整精度，dashboard 四卡和聚合卡仅在展示 DTO 边界把完成率四舍五入到一位小数（依次 `1.1%`、`1.3%`、`0%`、`0%`，聚合 `0.7%`）。日期文案统一为 `2026年8月 · 绩效归集中`。

工资预览和保存还必须在仓库边界校验：成员属于该班组、月份就是当前未锁定月份、金额为有限数值且 `0 < newSalaryCny <= 1_000_000`。`previewSalary()` 生成一次性 token 并绑定规范化后的 exact input 与当时 `sourceRevision`；`updateSalary()` 必须接收 `SaveStandardSalaryInput`，复验权限、输入、token 和 revision，成功保存后才消费 token。绕过预览、篡改金额/成员/月、或预览后任一计算源变化都必须拒绝并要求重新预览；无效请求不得消费仍有效的 token。权限使用 session 推导出的 capability，不在组件内散落角色判断；仅作为本项目 Mock/UAT capability fixture，`superadmin` 具备 `canEditSalary` 与 `canManageRules`，`finance` 具备 `canEditSalary`，`frontdesk_admin` 仅查看，`parts` 不具备 `canViewPerformance`，未来真实后端仍以返回 capability 为准。所有可查看身份读取同一个仓库和同一页面合同。

在 `src/lib/utils.ts` 增加展示函数，计算层不得调用：

```ts
export const formatCNYFull = (amount: number, digits = 2) =>
  `¥${amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const formatPercentRatio = (ratio: number, digits = 2) => `${(ratio * 100).toFixed(digits)}%`;
export const formatYearMonth = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
```

- [ ] **Step 5: 运行单元测试、类型检查并提交**

Run: `npm run test:unit && npm run typecheck`
Expected: PASS；dashboard 摘要与绩效详情读取同一 current-month 计算结果。

```bash
git add src/lib/api/mock-performance.ts src/lib/api/client.ts src/lib/api/mock-data.ts src/lib/utils.ts tests/unit/performance-store.spec.ts
git commit -m "feat: add performance mock API and snapshots"
```

---

### Task 3: 班组详情、月份、趋势与历史页面

**Files:**
- Create: `src/components/performance/performance-workspace.tsx`
- Create: `src/components/performance/team-performance-detail.tsx`
- Create: `src/components/performance/performance-trend-chart.tsx`
- Create: `src/components/performance/performance-history-table.tsx`
- Create: `src/components/performance/member-payroll-table.tsx`
- Modify: `src/app/performance/page.tsx`
- Modify: `src/components/dashboard/team-performance.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Create: `tests/e2e/helpers/performance-session.ts`
- Modify: `tests/e2e/dashboard.spec.ts`
- Test: `tests/e2e/performance-detail.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `api.performance.team()`、`TeamPerformanceDetailResponse` 和格式化函数。
- Produces: `/performance?team=<t1..t4>&month=<YYYY-MM>` 可交互页面；稳定 `data-testid` 合同供 Task 4 和后续规则版本计划使用。

- [ ] **Step 1: 写四组路由、月份同步和历史只读红测**

先创建 `tests/e2e/helpers/performance-session.ts`，导出 `usePerformanceIdentity(page, identity, scenario?)`、`observePerformanceRuntimeErrors(page)` 和 `assertNoPerformanceRuntimeErrors(page)`。helper 必须在首次导航前通过一次 `page.addInitScript()`：写入完整 `wh_session`；只有 `sessionStorage.getItem("wh_performance_e2e_seeded") !== "1"` 时才清除 `wh_performance_mock_v1`、安装一次测试 scenario 并写入该 sentinel。这样同一页面后续 `goto()`/reload 不会抹掉工资或规则持久化，也不会重复安装一次性 fault。固定支持 `superadmin`（可改工资、可管规则）、`finance`（可改工资）、`frontdesk_admin`（只读）和 `parts_no_performance`（不可查看），以及 `slow-team-read`、`team-read-failure-once`、`empty-history`、`missing-standard-salary`、`salary-save-failure-once` 测试场景；不得只写 role 字符串或依赖异步 IdentitySwitcher 才建立 session。

`usePerformanceIdentity()` 必须自动为传入 `Page` 安装一次 `pageerror` 与 `console` error 监听器；collector 以 `WeakMap<Page, string[]>` 保存，不得重复注册。`assertNoPerformanceRuntimeErrors(page)` 在页面关闭前断言两类错误均为空。默认 `page` 在 `afterEach` 统一断言；每个 `browser.newContext().newPage()` 创建的页面都必须在 `context.close()` 前显式断言，确保新详情/规则页面的异步渲染错误会真正使 E2E 失败。

创建 `tests/e2e/performance-detail.spec.ts`：

```ts
import { expect, test } from "@playwright/test";
import {
  assertNoPerformanceRuntimeErrors,
  usePerformanceIdentity,
} from "./helpers/performance-session";

test.beforeEach(async ({ page }) => {
  await usePerformanceIdentity(page, "superadmin");
});

test.afterEach(async ({ page }) => {
  await assertNoPerformanceRuntimeErrors(page);
});

test("四张班组卡分别进入正确班组并统一默认当前月", async ({ page }) => {
  const cases = [
    { id: "t1", name: "车间一组", target: "5,152,000", actual: "58,000" },
    { id: "t2", name: "车间二组", target: "4,968,000", actual: "64,500" },
    { id: "t3", name: "工程机械组", target: "4,600,000", actual: "JMD 0" },
    { id: "t4", name: "钣金喷漆组", target: "2,760,000", actual: "JMD 0" },
  ];
  for (const item of cases) {
    await page.goto("/");
    await page.getByTestId("team-card").filter({ hasText: item.name }).click();
    await expect(page).toHaveURL(new RegExp(`/performance\\?team=${item.id}`));
    await expect(page.getByTestId("performance-team-name")).toHaveText(item.name);
    await expect(page.getByTestId("overview-team-target")).toContainText(item.target);
    await expect(page.getByTestId("overview-actual-performance")).toContainText(item.actual);
    await expect(page.getByTestId("selected-month")).toHaveText("2026年8月");
    await expect(page.getByTestId("month-status")).toContainText("正在归集");
    await expect(page.getByText(/签名|保密确认/)).toHaveCount(0);
  }
});

test("上月和历史月份同步概览、成员表与工资合计", async ({ page }) => {
  await page.goto("/performance?team=t1");
  await page.getByTestId("month-previous").click();
  await expect(page).toHaveURL(/month=2026-07/);
  await expect(page.getByTestId("overview-team-target")).toContainText("5,152,000");
  await expect(page.getByTestId("overview-payroll-total")).toContainText("1,771.74");
  await expect(page.getByTestId("member-payroll-table")).toContainText("余咸生");
});

test("财务与只读身份看到同一默认月份、字段和历史入口", async ({ browser }) => {
  const captures: string[] = [];
  for (const identity of ["finance", "frontdesk_admin"] as const) {
    const context = await browser.newContext();
    const identityPage = await context.newPage();
    await usePerformanceIdentity(identityPage, identity);
    await identityPage.goto("/performance?team=t1");
    await expect(identityPage.getByTestId("overview-team-target")).toContainText("5,152,000");
    await expect(identityPage.getByTestId("member-payroll-table")).toContainText("余咸生");
    captures.push(await identityPage.getByTestId("performance-page").innerText());
    await expect(identityPage.getByTestId("selected-month")).toHaveText("2026年8月");
    await expect(identityPage.getByTestId("month-history-trigger")).toBeVisible();
    await assertNoPerformanceRuntimeErrors(identityPage);
    await context.close();
  }
  expect(captures[1]).toEqual(captures[0]);
});

test("无查看 capability 不泄露班组或成员工资", async ({ browser }) => {
  const context = await browser.newContext();
  const deniedPage = await context.newPage();
  await usePerformanceIdentity(deniedPage, "parts_no_performance");
  await deniedPage.goto("/performance?team=t1");
  await expect(deniedPage.getByTestId("performance-access-denied")).toContainText("无权查看班组绩效");
  await expect(deniedPage.getByTestId("member-payroll-table")).toHaveCount(0);
  await expect(deniedPage.getByText(/余咸生|月标准工资|应发工资测算/)).toHaveCount(0);
  await deniedPage.goto("/performance?view=rules");
  await expect(deniedPage.getByTestId("performance-access-denied")).toContainText("无权查看班组绩效");
  await expect(deniedPage.getByTestId("current-rule-version")).toHaveCount(0);
  await assertNoPerformanceRuntimeErrors(deniedPage);
  await context.close();
});

test("历史入口可切换到更早锁定月份并同步所有区域", async ({ page }) => {
  await page.goto("/performance?team=t1");
  await page.getByTestId("month-history-trigger").click();
  await page.getByTestId("history-month-option").filter({ hasText: "2026年6月" }).click();
  await expect(page).toHaveURL(/month=2026-06/);
  await expect(page.getByTestId("month-status")).toContainText("已锁定");
  await expect(page.getByTestId("overview-actual-performance")).toContainText("285,000");
  await expect(page.getByTestId("trend-comparison")).toContainText(/上涨|下跌/);
  await expect(page.getByTestId("member-payroll-table")).toContainText("全组合计");
});

test("读取失败可重试且不显示虚假数据", async ({ browser }) => {
  const context = await browser.newContext();
  const failurePage = await context.newPage();
  await usePerformanceIdentity(failurePage, "superadmin", "team-read-failure-once");
  await failurePage.goto("/performance?team=t1");
  await expect(failurePage.getByTestId("performance-load-error")).toContainText("演示读取失败");
  await expect(failurePage.getByTestId("overview-team-target")).toHaveCount(0);
  await failurePage.getByTestId("performance-retry").click();
  await expect(failurePage.getByTestId("overview-team-target")).toBeVisible();
  await assertNoPerformanceRuntimeErrors(failurePage);
  await context.close();
});

test("加载中分别保持概览、趋势和成员表骨架", async ({ browser }) => {
  const context = await browser.newContext();
  const slowPage = await context.newPage();
  await usePerformanceIdentity(slowPage, "superadmin", "slow-team-read");
  await slowPage.goto("/performance?team=t1");
  await expect(slowPage.getByTestId("overview-skeleton")).toBeVisible();
  await expect(slowPage.getByTestId("trend-skeleton")).toBeVisible();
  await expect(slowPage.getByTestId("member-table-skeleton")).toBeVisible();
  await expect(slowPage.getByTestId("performance-team-name")).toHaveText("车间一组");
  await assertNoPerformanceRuntimeErrors(slowPage);
  await context.close();
});

test("空历史和缺工资使用明确状态而不是零", async ({ browser }) => {
  for (const [scenario, expected] of [
    ["empty-history", "暂无已锁定历史月份"],
    ["missing-standard-salary", "缺少月标准工资"],
  ] as const) {
    const context = await browser.newContext();
    const scenarioPage = await context.newPage();
    await usePerformanceIdentity(scenarioPage, "superadmin", scenario);
    await scenarioPage.goto("/performance?team=t1");
    await expect(scenarioPage.getByTestId("performance-page")).toContainText(expected);
    if (scenario === "missing-standard-salary") {
      await expect(scenarioPage.getByTestId("overview-payroll-total")).toContainText("无法测算");
      await expect(scenarioPage.getByTestId("overview-payroll-total")).not.toContainText("¥0");
    }
    await assertNoPerformanceRuntimeErrors(scenarioPage);
    await context.close();
  }
});
```

同步更新 `tests/e2e/dashboard.spec.ts`，把四张卡的目标由四个相同 `/performance` 改为：

```ts
expect(teamHrefs).toEqual([
  "/performance?team=t1",
  "/performance?team=t2",
  "/performance?team=t3",
  "/performance?team=t4",
]);
await expect(page.getByTestId("team-performance"))
  .toContainText("点击任一班组进入绩效详情");
await expect(page.getByTestId("team-performance"))
  .not.toContainText("当前页浮窗查看");
await expect(page.getByTestId("team-performance-summary"))
  .toContainText("JMD 122,500 / JMD 17,480,000");
await expect(page.getByTestId("team-performance-rate")).toHaveText("0.7%");
await expect(page.getByTestId("team-card").filter({ hasText: "车间一组" })).toContainText("1.1%");
await expect(page.getByTestId("team-card").filter({ hasText: "车间二组" })).toContainText("1.3%");
```

在 `performance-detail.spec.ts` 另断言侧栏“绩效管理”链接 `href="/performance"`，进入后具有 `aria-current="page"`，并可用键盘 Enter 打开；同步删除/改写 `dashboard.spec.ts` 里对旧“当前页浮窗查看完成情况”整句的精确断言。

- [ ] **Step 2: 运行路由红测**

Run: `E2E_BASE_URL=http://127.0.0.1:3005 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/performance-detail.spec.ts tests/e2e/dashboard.spec.ts`
Expected: FAIL，因为 `/performance` 仍为占位页，四张卡没有 `team` 参数。

- [ ] **Step 3: 实现页面协调器和班组/月分层**

`performance-workspace.tsx` 使用 `useSearchParams()` 和 `useRouter()` 读取并同步 `team`、`month`，直接访问 `/performance` 时固定默认 `t1` 和 current month。`src/app/performance/page.tsx` 用 `<Suspense>` 包住读取 search params 的客户端工作台，保证 Next 14 production build 不发生 CSR bailout。页面不得根据 `role` 选择默认月份；只使用 API 返回的 capability 控制写按钮。

加载时概览、趋势、成员表分别显示保持原高度的稳定骨架；API 返回空历史时显示“暂无已锁定历史月份”；工资、成员、汇率或实际绩效缺失时显示对应字段错误并禁用受影响的测算/预览，不得把缺失值显示成 `0`。为 E2E 提供可注入的 Mock capability：`superadmin` 可编辑，`frontdesk_admin` 只读；两者读取相同数据、默认月份和页面结构。

必须提供以下测试合同：

```tsx
<main data-testid="performance-page">
  <nav data-testid="performance-team-switcher">...</nav>
  <button data-testid="month-current">...</button>
  <button data-testid="month-previous">...</button>
  <button data-testid="month-history-trigger">...</button>
  <span data-testid="selected-month">...</span>
  <span data-testid="month-status">...</span>
</main>
```

`team-performance.tsx` 使用 `href={`/performance?team=${team.id}`}`，并把错误提示“当前页浮窗查看”改为“点击任一班组进入绩效详情”。聚合卡的底层比率仍由 current-month 实际/指标现场计算，视图只在最终展示时保留一位小数为 `0.7%`。侧栏增加 `/performance` 的“绩效管理”入口。

- [ ] **Step 4: 实现概览、Recharts 趋势和历史表**

`performance-trend-chart.tsx` 使用 `ResponsiveContainer`、`ComposedChart`、`Bar` 和 `Line`。历史平均是每个被比较月份只看此前锁定月份的滚动值，因此用第二条 `Line dataKey="historicalAverage"`，不得用一个常数 `ReferenceLine` 代替。三种指标分别使用各自单位的 `completionHistoryAverage`、`actualHistoryAverageJmd` 和 `payrollHistoryAverageCny`。三种指标按钮固定为：

```ts
type TrendMetric = "completion" | "actual" | "payroll";
```

图表必须输出文字摘要和以下测试节点：

```tsx
<section data-testid="performance-trend-chart">
  <button data-testid="trend-metric" data-metric="completion">完成率趋势</button>
  <button data-testid="trend-metric" data-metric="actual">实际绩效</button>
  <button data-testid="trend-metric" data-metric="payroll">工资测算</button>
  <span data-testid="trend-average-line">历史平均 ...</span>
  <svg aria-label="绩效趋势图"><path data-testid="trend-average-path" d="..." /></svg>
  <p data-testid="trend-comparison">...</p>
</section>
```

当前 `collecting` 月弱化并标记“正在归集”；不足两个月时显示“历史数据不足”，不绘制虚假平均线。成员表列固定为员工、月标准工资、携带班组指标、工资预算、应发工资测算；禁止加入完成率列。

在 Step 1 的 E2E 文件补充可执行字段与趋势验收：

```ts
test("概览、历史表和成员表只显示完整绩效字段", async ({ page }) => {
  await page.goto("/performance?team=t1&month=2026-07");
  await expect(page.getByTestId("overview-team-target")).toContainText("5,152,000");
  await expect(page.getByTestId("overview-actual-performance")).toContainText("163,000");
  await expect(page.getByTestId("overview-completion-rate")).toContainText("3.1638%");
  await expect(page.getByTestId("overview-payroll-total")).toContainText("1,771.74");
  await expect(page.getByTestId("performance-history-table")).toContainText("比上月");
  await expect(page.getByTestId("performance-history-table")).toContainText("历史平均");
  await expect(page.getByTestId("performance-history-table")).toContainText("查看成员明细");
  await expect(page.getByTestId("history-row")).toHaveCount(12);
  const julyHistory = page.getByTestId("history-row").filter({ hasText: "2026年7月" });
  await expect(julyHistory).toContainText("JMD 163,000");
  await expect(julyHistory).toContainText("3.1638%");
  await expect(julyHistory).toContainText("¥1,771.74");
  await expect(julyHistory.getByTestId("history-view-members")).toBeVisible();
  const august = page.getByTestId("history-row").filter({ hasText: "2025年8月" });
  await expect(august.getByTestId("history-average-comparison")).toContainText("历史数据不足");
  const september = page.getByTestId("history-row").filter({ hasText: "2025年9月" });
  await expect(september.getByTestId("history-previous-comparison")).toContainText("上涨 JMD 27,000");
  await expect(september.getByTestId("history-average-comparison")).toContainText("高于此前历史平均 13.64%");
  const october = page.getByTestId("history-row").filter({ hasText: "2025年10月" });
  await expect(october.getByTestId("history-previous-comparison")).toContainText("下跌 JMD 18,000");
  await expect(october.getByTestId("history-average-comparison")).toContainText("低于此前历史平均 2.13%");
  const memberTable = page.getByTestId("member-payroll-table");
  await expect(memberTable).toContainText("全组合计");
  await expect(memberTable.getByRole("columnheader", { name: /完成率/ })).toHaveCount(0);
  await expect(memberTable.getByTestId("member-wage-budget").first()).toContainText("¥379.66");
  await expect(memberTable.getByTestId("member-estimated-pay").first()).toContainText("¥379.66");
  await expect(page.getByTestId("performance-page").getByText(/客户|车辆|工单|收款|实际发放工资/)).toHaveCount(0);
});

test("历史行的成员明细动作同步所选月份和成员表", async ({ page }) => {
  await page.goto("/performance?team=t1");
  const julyHistory = page.getByTestId("history-row").filter({ hasText: "2026年7月" });
  await julyHistory.getByTestId("history-view-members").click();
  await expect(page).toHaveURL(/team=t1.*month=2026-07/);
  await expect(page.getByTestId("selected-month")).toHaveText("2026年7月");
  await expect(page.getByTestId("member-payroll-table")).toContainText("余咸生");
  await expect(page.getByTestId("member-payroll-table")).toContainText("¥1,771.74");
});

test("三种趋势包含十二个完整月、滚动平均和弱化当前月", async ({ page }) => {
  await page.goto("/performance?team=t1&month=2026-07");
  await expect(page.getByTestId("trend-point")).toHaveCount(13);
  await expect(page.getByTestId("trend-average-line")).toContainText("4.5419%");
  await expect(page.getByTestId("trend-point").filter({ hasText: "2026年7月" })).toContainText("3.1638%");
  await expect(page.getByTestId("trend-comparison")).toContainText("低于此前历史平均 30.34%");
  await expect(page.getByTestId("trend-point").filter({ hasText: "2025年9月" })).toContainText("上涨");
  await expect(page.getByTestId("trend-point").filter({ hasText: "2025年10月" })).toContainText("下跌");
  await expect(page.getByTestId("trend-average-path")).toHaveAttribute("d", /\S+/);

  await page.locator('[data-testid="trend-metric"][data-metric="actual"]').click();
  await expect(page.getByTestId("performance-trend-chart")).toHaveAttribute("data-active-metric", "actual");
  await expect(page.getByTestId("trend-average-line")).toContainText("JMD 234,000");
  await expect(page.getByTestId("trend-point").filter({ hasText: "2026年7月" })).toContainText("JMD 163,000");

  await page.locator('[data-testid="trend-metric"][data-metric="payroll"]').click();
  await expect(page.getByTestId("performance-trend-chart")).toHaveAttribute("data-active-metric", "payroll");
  await expect(page.getByTestId("trend-average-line")).toContainText("¥2,543.48");
  await expect(page.getByTestId("trend-point").filter({ hasText: "2026年7月" })).toContainText("¥1,771.74");

  const collecting = page.getByTestId("trend-point").filter({ hasText: "2026年8月" });
  await expect(collecting).toHaveAttribute("data-status", "collecting");
  await expect(collecting).toContainText("正在归集");
  await expect(collecting).not.toContainText(/上涨|下跌|高于历史平均|低于历史平均/);
});
```

实现时给每个图表月份同步渲染可访问文字节点 `data-testid="trend-point"`，包含月份、当前所选指标的数值、涨跌方向、平均值和 `data-status`；切换 metric 必须同步切换这些节点，不能让三个按钮继续复用完成率数据。这不是隐藏假数据，而是图表的等价文字摘要。滚动平均折线的真实 SVG path 暴露为 `data-testid="trend-average-path"`。历史表每月行使用 `data-testid="history-row"`，上月比较与历史平均比较分别使用 `history-previous-comparison`、`history-average-comparison`，首个无基线月份必须明确显示“历史数据不足”；“查看成员明细”按钮使用 `data-testid="history-view-members"`，点击后把 URL/所选月份/成员表同步到该锁定月。当前归集月不得输出整月最终涨跌结论。趋势按钮使用 `aria-pressed`，月份/班组切换使用 `aria-current` 或 `aria-selected`，涨跌同时包含箭头和文字，不能只依赖颜色。

- [ ] **Step 5: 运行页面与 dashboard 测试并提交**

Run: `E2E_BASE_URL=http://127.0.0.1:3005 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/performance-detail.spec.ts tests/e2e/dashboard.spec.ts`
Expected: PASS，原 dashboard 间隙、阴影、hover 和 430px 回归继续通过。

```bash
git add src/app/performance/page.tsx src/components/performance src/components/dashboard/team-performance.tsx src/components/layout/sidebar.tsx tests/e2e/performance-detail.spec.ts tests/e2e/dashboard.spec.ts
git commit -m "feat: build team performance history page"
```

---

### Task 4: 成员详情、工资影响预览与标准工资编辑

**Files:**
- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/performance/member-salary-dialog.tsx`
- Modify: `src/components/performance/member-payroll-table.tsx`
- Modify: `src/components/performance/performance-workspace.tsx`
- Test: `tests/e2e/performance-detail.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `api.performance.member()`、`previewSalary()`、`updateSalary()`。
- Produces: `member-wage-dialog`、工资影响预览、保存后整页同步更新和只读历史详情。

- [ ] **Step 1: 写工资编辑红测**

在 `performance-detail.spec.ts` 增加：

```ts
test("改标准工资前预览并重算整组，七月快照保持不变", async ({ page }) => {
  await page.goto("/performance?team=t1&month=2026-07");
  const julyBefore = await page.getByTestId("member-payroll-table").innerText();

  await page.getByTestId("month-current").click();
  const memberTable = page.getByTestId("member-payroll-table");
  const changedRow = memberTable.getByTestId("member-row").filter({ hasText: "余咸生" });
  await expect(changedRow.getByTestId("member-estimated-pay")).toContainText("¥135.09");
  for (const row of await memberTable.getByTestId("member-row").all()) {
    await expect(row).not.toContainText("%");
  }
  const completionBefore = await page.getByTestId("overview-completion-rate").innerText();
  await changedRow.click();
  await expect(page.getByTestId("member-wage-dialog")).toContainText("WH-0040");
  await expect(page.getByTestId("member-wage-dialog")).toContainText("组长");
  await expect(page.getByTestId("member-wage-dialog")).toContainText("历月工资测算");
  await page.getByTestId("standard-wage-input").fill("13000");
  await page.getByTestId("preview-wage-impact").click();
  await expect(page.getByTestId("wage-impact-member-target")).toContainText("1,196,000");
  await expect(page.getByTestId("wage-impact-team-target")).toContainText("5,244,000");
  await page.getByTestId("save-standard-wage").click();
  await expect(page.getByTestId("wage-adjustment-history")).toContainText("12,000");
  await expect(page.getByTestId("wage-adjustment-history")).toContainText("13,000");
  await expect(memberTable.getByTestId("member-row").filter({ hasText: "余咸生" })
    .getByTestId("member-estimated-pay")).toContainText("¥143.78");
  for (const [name, payable] of [
    ["余一鹤", "¥154.84"], ["翁雄", "¥176.96"], ["王林", "¥154.84"],
  ] as const) {
    await expect(memberTable.getByTestId("member-row").filter({ hasText: name })
      .getByTestId("member-estimated-pay")).toContainText(payable);
  }
  expect(await page.getByTestId("overview-completion-rate").innerText()).not.toBe(completionBefore);
  await expect(page.getByTestId("overview-payroll-total")).toContainText("630.43");

  await page.getByTestId("member-dialog-close").click();
  await page.reload();
  await expect(page.getByTestId("overview-team-target")).toContainText("5,244,000");
  await expect(page.getByTestId("member-row").filter({ hasText: "余咸生" })).toContainText("¥13,000");
  await page.getByTestId("member-row").filter({ hasText: "余咸生" }).click();
  await expect(page.getByTestId("wage-adjustment-history")).toContainText("12,000");
  await expect(page.getByTestId("wage-adjustment-history")).toContainText("13,000");
  await page.getByTestId("member-dialog-close").click();
  await page.getByTestId("month-previous").click();
  await expect(page.getByTestId("member-payroll-table")).toHaveText(julyBefore);
});

test("历史锁定月份成员详情完整但没有编辑控件", async ({ page }) => {
  await page.goto("/performance?team=t1&month=2026-07");
  await page.getByTestId("member-row").filter({ hasText: "余咸生" }).click();
  const dialog = page.getByTestId("member-wage-dialog");
  await expect(dialog).toContainText("WH-0040");
  await expect(dialog).toContainText("组长");
  await expect(dialog).toContainText("班组统一完成率");
  await expect(dialog).toContainText("工资预算");
  await expect(dialog).toContainText("应发工资测算");
  await expect(dialog).toContainText("历月工资测算");
  await expect(dialog.getByTestId("member-history-row")).toHaveCount(12);
  const julyResult = dialog.getByTestId("member-history-row").filter({ hasText: "2026年7月" });
  await expect(julyResult).toContainText("¥379.66");
  await expect(julyResult).toContainText("JMD 1,104,000");
  await expect(page.getByTestId("standard-wage-input")).toHaveCount(0);
  await expect(page.getByTestId("preview-wage-impact")).toHaveCount(0);
  await expect(page.getByTestId("save-standard-wage")).toHaveCount(0);
});

test("标准工资金额校验使用人民币范围", async ({ page }) => {
  await page.goto("/performance?team=t1");
  await page.getByTestId("member-row").first().click();
  await expect(page.getByLabel("月标准工资（人民币）")).toBeVisible();
  for (const value of ["0", "-1", "1000001"]) {
    await page.getByTestId("standard-wage-input").fill(value);
    await page.getByTestId("standard-wage-input").press("Tab");
    await expect(page.getByTestId("standard-wage-error")).toContainText("大于 0 且不超过 ¥1,000,000");
    await expect(page.getByTestId("preview-wage-impact")).toBeDisabled();
    await expect(page.getByTestId("save-standard-wage")).toBeDisabled();
  }
});

test("工资保存失败保留输入和已确认预览", async ({ browser }) => {
  const context = await browser.newContext();
  const failurePage = await context.newPage();
  await usePerformanceIdentity(failurePage, "superadmin", "salary-save-failure-once");
  await failurePage.goto("/performance?team=t1");
  await failurePage.getByTestId("member-row").filter({ hasText: "余咸生" }).click();
  await failurePage.getByTestId("standard-wage-input").fill("13000");
  await failurePage.getByTestId("preview-wage-impact").click();
  await failurePage.getByTestId("save-standard-wage").click();
  await expect(failurePage.getByTestId("wage-save-error")).toContainText("演示保存失败");
  await expect(failurePage.getByTestId("standard-wage-input")).toHaveValue("13000");
  await expect(failurePage.getByTestId("wage-impact-team-target")).toContainText("5,244,000");
  await expect(failurePage.getByText(/保存成功/)).toHaveCount(0);
  await failurePage.getByTestId("member-dialog-close").click();
  await failurePage.reload();
  await expect(failurePage.getByTestId("overview-team-target")).toContainText("5,152,000");
  const unchangedRow = failurePage.getByTestId("member-row").filter({ hasText: "余咸生" });
  await expect(unchangedRow).toContainText("¥12,000");
  await unchangedRow.click();
  await expect(failurePage.getByTestId("wage-adjustment-history")).not.toContainText("13,000");
  await assertNoPerformanceRuntimeErrors(failurePage);
  await context.close();
});

test("成员浮窗支持键盘关闭并恢复焦点", async ({ page }) => {
  await page.goto("/performance?team=t1");
  const row = page.getByTestId("member-row").first();
  await row.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("member-wage-dialog");
  const firstFocusable = page.getByTestId("member-dialog-close");
  const lastFocusable = page.getByTestId("preview-wage-impact");
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await page.getByTestId("standard-wage-input").fill("13000");
  await expect(lastFocusable).toBeEnabled();
  await firstFocusable.focus();
  await expect(firstFocusable).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastFocusable).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstFocusable).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("member-wage-dialog")).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("只读身份当前月仍看完整成员详情但没有编辑表单", async ({ browser }) => {
  const context = await browser.newContext();
  const readOnlyPage = await context.newPage();
  await usePerformanceIdentity(readOnlyPage, "frontdesk_admin");
  await readOnlyPage.goto("/performance?team=t1");
  await readOnlyPage.getByTestId("member-row").first().click();
  await expect(readOnlyPage.getByTestId("member-wage-dialog")).toContainText("班组统一完成率");
  await expect(readOnlyPage.getByTestId("member-wage-dialog")).toContainText("历月工资测算");
  await expect(readOnlyPage.getByTestId("standard-wage-input")).toHaveCount(0);
  await expect(readOnlyPage.getByTestId("preview-wage-impact")).toHaveCount(0);
  await expect(readOnlyPage.getByTestId("save-standard-wage")).toHaveCount(0);
  await assertNoPerformanceRuntimeErrors(readOnlyPage);
  await context.close();
});
```

- [ ] **Step 2: 运行红测确认对话框和 mutation 不存在**

Run: `E2E_BASE_URL=http://127.0.0.1:3005 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/performance-detail.spec.ts`
Expected: FAIL，新增的工资编辑、历史只读、金额校验和焦点陷阱测试至少一项明确失败；完整文件运行保证 Step 1 新增的每条红测都实际执行。

- [ ] **Step 3: 实现可访问 Dialog 与成员详情**

`src/components/ui/dialog.tsx` 必须包含：`role="dialog"`、`aria-modal="true"`、标题关联、打开后聚焦关闭按钮、Tab 焦点限制在浮窗内、首元素 Shift+Tab 环回末元素、末元素 Tab 环回首元素、背景不可交互、Escape 关闭、遮罩关闭、关闭时恢复触发元素焦点，以及移动端 `max-h-[calc(100vh-2rem)] overflow-y-auto`。成员工资 Dialog 的明确可测顺序为关闭按钮在首，合法输入后的“预览影响”按钮为末（保存按钮在未预览时 disabled，不计入焦点环）。尊重 `prefers-reduced-motion`。

成员详情始终显示当前或所选月份工资、携带班组指标、统一完成率、工资预算、应发测算、历月结果和调整记录；每个锁定月结果行使用 `data-testid="member-history-row"`，必须显示月份、当月携带指标、工资预算和应发测算。只有 `permissions.canEditSalary && snapshot.status === "collecting"` 时显示输入和预览按钮。

- [ ] **Step 4: 实现先预览后保存及真实错误状态**

表单状态使用明确阶段：

```ts
type SalaryEditState =
  | { status: "idle" }
  | { status: "previewing" }
  | { status: "previewed"; preview: SalaryChangePreview }
  | { status: "saving"; preview: SalaryChangePreview }
  | { status: "error"; message: string; preview?: SalaryChangePreview };
```

修改输入后使旧预览失效；未完成预览时禁用保存。保存请求必须从当前 `SalaryChangePreview` 取 `previewToken`，连同该预览的 exact input 组成 `SaveStandardSalaryInput`，不得重新从可能已变化的表单拼一个未绑定请求。保存成功后用 API 返回的 `UpdateStandardSalaryResult.detail` 替换页面状态，同时用 `.member` 更新浮窗及调整记录，保证概览、趋势、成员表、成员详情与 dashboard 同源。`salarySave` fault 必须在任何 state/storage mutation 之前触发；失败时工资、dashboard、调整记录和 `sourceRevision` 原子地保持不变，且不消费有效 token。保存失败保留输入与预览；若后端报告源数据已变化，则保留输入但把状态退回 `idle` 并要求重新预览。显示 `data-testid="wage-save-error"`，不得显示成功提示。

- [ ] **Step 5: 运行测试、检查可访问性并提交**

Run: `npm run test:unit && E2E_BASE_URL=http://127.0.0.1:3005 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/performance-detail.spec.ts`
Expected: PASS；键盘可打开成员行、编辑、关闭并恢复焦点。

```bash
git add src/components/ui/dialog.tsx src/components/performance/member-salary-dialog.tsx src/components/performance/member-payroll-table.tsx src/components/performance/performance-workspace.tsx tests/e2e/performance-detail.spec.ts
git commit -m "feat: add member wage adjustment flow"
```

---

### Task 5: 响应式、明暗主题与最终回归

**Files:**
- Modify: `tests/e2e/performance-detail.spec.ts`
- Modify: `design-qa.md`
- Create: `../qa/performance-detail-pass1-1920x841.png`
- Create: `../qa/performance-detail-pass1-dark-1920x841.png`
- Create: `../qa/performance-detail-pass1-430x932.png`
- Create: `../qa/performance-detail-pass1-dark-430x932.png`

**Interfaces:**
- Consumes: Tasks 1–4 的完整班组绩效体验。
- Produces: 可核验的桌面/移动、明/暗主题证据和全量绿测结果。

- [ ] **Step 1: 写响应式与图表语义红测**

增加测试：

```ts
test("430px 班组绩效页面无文档横向溢出且表格自身可滚动", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/performance?team=t1");
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBe(width.client);
  await expect(page.getByTestId("member-table-scroll")).toHaveCSS("overflow-x", "auto");
  await expect(page.getByTestId("history-table-scroll")).toHaveCSS("overflow-x", "auto");
  const memberOverflow = await page.getByTestId("member-table-scroll").evaluate((element) =>
    element.scrollWidth > element.clientWidth,
  );
  expect(memberOverflow).toBe(true);
  const historyOverflow = await page.getByTestId("history-table-scroll").evaluate((element) =>
    element.scrollWidth > element.clientWidth,
  );
  expect(historyOverflow).toBe(true);
  const chartBox = await page.getByTestId("performance-trend-chart").boundingBox();
  expect(chartBox?.x).toBeGreaterThanOrEqual(0);
  expect((chartBox?.x ?? 0) + (chartBox?.width ?? 0)).toBeLessThanOrEqual(430);

  await page.getByTestId("member-row").first().click();
  const dialogBox = await page.getByTestId("member-wage-dialog").boundingBox();
  expect(dialogBox?.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox?.y).toBeGreaterThanOrEqual(0);
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(430);
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(932);
  await expect(page.getByTestId("member-dialog-scroll")).toHaveCSS("overflow-y", "auto");
});

test("趋势不只依赖颜色表达涨跌", async ({ page }) => {
  await page.goto("/performance?team=t1&month=2026-07");
  await expect(page.getByTestId("trend-comparison")).toContainText(/上涨|下跌|历史数据不足/);
});
```

- [ ] **Step 2: 运行红测并修复最后的响应式问题**

Run: `E2E_BASE_URL=http://127.0.0.1:3005 E2E_REUSE_SERVER=0 npm run test:e2e -- tests/e2e/performance-detail.spec.ts --grep "430px|趋势不只"`
Expected: 初次实现若存在文档溢出、Dialog 裁切或纯颜色趋势会 FAIL；只修复这些失败，不改变已确认信息结构。

- [ ] **Step 3: 生成同尺寸视觉证据并比较已确认布局**

使用系统 Chrome channel，在 1920×841 和 430×932 下生成四张明暗截图到外置卷 `../qa`。桌面截图与固化的 `../qa/team-performance-approved-layout-1920.png` 并排比较，检查月份入口、四项概览、趋势图、成员表、历史区、暗色对比和移动端表格容器。把 P0/P1/P2 修完后，在 `design-qa.md` 写入证据路径并以单独一行结束：

```text
final result: passed
```

- [ ] **Step 4: 运行全量验证**

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

Expected: 全部 exit 0；只允许已确认的既有 `logo.tsx` `<img>` lint warning，不得新增 warning、console error 或 page error。

- [ ] **Step 5: 提交最终 QA 证据说明**

```bash
git add tests/e2e/performance-detail.spec.ts design-qa.md
git commit -m "test: verify team performance detail"
```
