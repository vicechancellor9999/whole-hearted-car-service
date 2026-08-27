# 工单管理与检查报价协作中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有业务单列表升级为可查询全部单据、展示流程数量、今日普通车辆首次派检均衡和班组实时负载的工单管理中心，并接入署名检查、AI 整理、报价版本和班组继承规则。

**Architecture:** 先把单据、检查提交、检查报价版本和作业派组拆成独立领域对象，再由无筛选污染的运营概览接口提供统计。WorkBuddy 只实现表现层，Codex 负责领域规则、API、TDD、集成和浏览器验收。

**Tech Stack:** Next.js 14、React、TypeScript、Tailwind CSS、Playwright、现有 mock API/client 模式。

## Global Constraints

- 所有工作区和 QA 产物必须位于 `/Volumes/公司文件`。
- 用户当前预览端口 `3002` 只读；开发和 E2E 使用隔离端口。
- WorkBuddy 不修改领域、API、测试或权限文件。
- 检查原文和署名不可被 AI 或前台覆盖。
- 普通车辆均衡只比较车间一组和车间二组，且系统不自动派单。
- 前台正式交单后禁止普通改组。
- 生产代码必须先有对应失败测试。

---

### Task 1: 单据编号与检查报价领域合同

**Files:**
- Modify: `src/lib/orders/types.ts`
- Create: `src/lib/orders/document-number.ts`
- Create: `src/lib/orders/inspection-types.ts`
- Test: `tests/unit/orders-document-number.spec.ts`
- Test: `tests/unit/orders-inspection-domain.spec.ts`

**Interfaces:**
- Produces: `formatBusinessOrderNo(parts)`, `formatInspectionReportNo(parts)`, `InspectionSubmission`, `InspectionQuoteDocument`, `InspectionQuoteVersion`, `OrderAssignment`。
- Consumes: `America/Jamaica` 业务日、配置化 branch/brand code。

```ts
interface DocumentNumberParts {
  branchCode: string;
  brandCode: string;
  businessDate: `${number}${number}${number}${number}${number}${number}${number}${number}`;
  sequence: number;
}

function formatBusinessOrderNo(parts: DocumentNumberParts): string;
function formatInspectionReportNo(parts: DocumentNumberParts): string;

interface InspectionSubmission {
  id: string;
  inspectionReportNo: string;
  vehicleId: string;
  inspectorId: string;
  inspectorName: string;
  inspectorTeamId: OrderTeamId;
  submittedAt: string;
  naturalLanguageResult: string;
  suggestedLaborItems: Array<{ id: string; name: string; quotedJmd: number }>;
  suggestedPartItems: Array<{ id: string; name: string; quantity: number }>;
}

interface OrderAssignment {
  id: string;
  vehicleId: string;
  documentId: string;
  kind: "inspection" | "repair";
  vehiclePool: "ordinary" | "engineering" | "bodywork";
  teamId: OrderTeamId;
  status: "awaiting_acceptance" | "in_progress" | "blocked" | "returned" | "completed";
  assignedAt: string;
  acceptedAt?: string;
  completedAt?: string;
}
```

- [ ] **Step 1: 写编号失败测试**

  断言业务单格式为 `KGN-WH-2026080919422`，检查报价格式为 `KGN-WH-IR-2026080919422`；拒绝非法分店代码、非五位序号和非法日期。

  ```ts
  expect(formatBusinessOrderNo({
    branchCode: "KGN", brandCode: "WH", businessDate: "20260809", sequence: 19422,
  })).toBe("KGN-WH-2026080919422");
  expect(formatInspectionReportNo({
    branchCode: "KGN", brandCode: "WH", businessDate: "20260809", sequence: 19422,
  })).toBe("KGN-WH-IR-2026080919422");
  ```

- [ ] **Step 2: 运行编号测试并确认 RED**

  Run: `npm run test:unit -- tests/unit/orders-document-number.spec.ts`

  Expected: FAIL，缺少 `document-number` 模块。

- [ ] **Step 3: 最小实现编号格式化与校验**

  浏览器不得扫描最大编号；生成接口只消费服务端已原子分配的五位序号。

- [ ] **Step 4: 写检查领域失败测试**

  覆盖原始自然语言、署名班组、AI 草稿不能覆盖原文、V1/V2 版本、逐项客户决定和转换来源唯一性。

- [ ] **Step 5: 运行检查领域测试并确认 RED**

  Run: `npm run test:unit -- tests/unit/orders-inspection-domain.spec.ts`

- [ ] **Step 6: 最小实现领域类型和纯函数**

  `InspectionSubmission` 保存不可变原文；`InspectionQuoteVersion` 保存前台确认版本；`OrderAssignment` 独立于文档目录。

- [ ] **Step 7: 运行两份测试并确认 GREEN**

  Run: `npm run test:unit -- tests/unit/orders-document-number.spec.ts tests/unit/orders-inspection-domain.spec.ts`

- [ ] **Step 8: 提交**

  `git commit -m "feat: add orders document and inspection contracts"`

### Task 2: 今日派检均衡与班组实时负载

**Files:**
- Create: `src/lib/orders/operations-overview.ts`
- Modify: `src/lib/orders/types.ts`
- Modify: `src/lib/orders/seed.ts`
- Test: `tests/unit/orders-operations-overview.spec.ts`

**Interfaces:**
- Produces: `buildOrdersOperationsOverview(records, assignments, businessDate)` → `OrdersOperationsOverview`。
- Consumes: 去重车辆、普通/特殊分流、检查/维修 assignment 状态。

```ts
type OrderOperationsStage =
  | "inspection_awaiting_dispatch"
  | "inspection_awaiting_acceptance"
  | "inspection_in_progress"
  | "inspection_awaiting_frontdesk"
  | "quote_awaiting_customer"
  | "quote_accepted_awaiting_order"
  | "repair_awaiting_dispatch"
  | "repair_awaiting_acceptance"
  | "repair_in_progress"
  | "blocked"
  | "returned_awaiting_frontdesk"
  | "awaiting_formal_handover"
  | "submitted_awaiting_collection"
  | "vehicle_collected";

interface OrdersOperationsOverview {
  businessDate: string;
  firstInspectionDistribution: {
    distinctOrdinaryVehicles: number;
    t1: number;
    t2: number;
    difference: number;
  };
  workloads: Array<{
    teamId: OrderTeamId;
    inspectionAwaiting: number;
    inspectionInProgress: number;
    repairAwaiting: number;
    repairInProgress: number;
    blocked: number;
    returnedAwaitingFrontdesk: number;
    activeTotal: number;
  }>;
  processCounts: Record<OrderOperationsStage, number>;
}
```

- [ ] **Step 1: 写运营概览失败测试**

  覆盖：20 辆普通车 10/10；同车检查转工单不重复计入首次派检；改组不改写首次派检；当前负载转移到新组；工程机械和钣喷不进入一二组均衡；阻滞和回交不计当前在手作业。

  ```ts
  const overview = buildOrdersOperationsOverview(records, assignments, "2026-08-09");
  expect(overview.firstInspectionDistribution).toEqual({
    distinctOrdinaryVehicles: 20, t1: 10, t2: 10, difference: 0,
  });
  expect(overview.workloads.find((item) => item.teamId === "t2")?.activeTotal).toBe(8);
  ```

- [ ] **Step 2: 运行测试并确认 RED**

  Run: `npm run test:unit -- tests/unit/orders-operations-overview.spec.ts`

- [ ] **Step 3: 最小实现运营聚合**

  概览统计基于完整数据集，不受列表 search、teamId、documentType 或历史筛选影响。

- [ ] **Step 4: 运行测试并确认 GREEN**

  Run: `npm run test:unit -- tests/unit/orders-operations-overview.spec.ts`

- [ ] **Step 5: 提交**

  `git commit -m "feat: calculate dispatch balance and team workload"`

### Task 3: Mock API 与列表查询扩展

**Files:**
- Modify: `src/lib/api/mock-orders.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/lib/orders/query.ts`
- Test: `tests/unit/orders-api.spec.ts`
- Test: `tests/unit/orders-query.spec.ts`

**Interfaces:**
- Produces: `api.orders.operationsOverview()`, 扩展后的 `api.orders.list(query)`。
- Consumes: Task 1/2 的领域类型与聚合函数。

```ts
api.orders.operationsOverview(): Promise<OrdersOperationsOverview>;
api.orders.list(query: OrderListQuery & {
  documentType?: "all" | "inspection_quote" | "business_order";
  stage?: OrderOperationsStage;
  handlerId?: string;
  createdOn?: string;
}): Promise<OrderListResponse>;
```

- [ ] **Step 1: 写 API 失败测试**

  精确断言运营概览不随列表筛选变化；检查与报价、维修工单、全部单据查询均可返回；无有效 session 时拒绝。

- [ ] **Step 2: 运行测试并确认 RED**

  Run: `npm run test:unit -- tests/unit/orders-api.spec.ts tests/unit/orders-query.spec.ts`

- [ ] **Step 3: 最小实现 API 和查询参数**

  新增 `documentType`、`stage`、`date`、`handler` 等筛选，保留现有逐字搜索和 URL 归一化行为。

- [ ] **Step 4: 运行测试并确认 GREEN**

  Run: `npm run test:unit -- tests/unit/orders-api.spec.ts tests/unit/orders-query.spec.ts`

- [ ] **Step 5: 提交**

  `git commit -m "feat: expose orders operations API"`

### Task 4: WorkBuddy 视觉重构

**Files:**
- Modify: `src/app/orders/page.tsx`
- Modify: `src/components/orders/orders-workspace.tsx`
- Modify: `src/components/orders/orders-toolbar.tsx`
- Modify: `src/components/orders/orders-table.tsx`
- Modify: `src/components/orders/team-summary-cards.tsx`
- Create: `src/components/orders/dispatch-balance.tsx`
- Create: `src/components/orders/process-counts.tsx`
- Create: `src/components/orders/workload-board.tsx`

**Interfaces:**
- Consumes: `api.orders.operationsOverview()` 和扩展 `api.orders.list(query)`。
- Produces: 1920px/430px、明暗主题的工单管理表现层。

- [ ] **Step 1: WorkBuddy 按设计文档实现纯表现层**

  标题使用“工单管理”，首屏同时呈现今日首次派检、实时负载和流程数量；保留现有搜索与响应式列表，不写本地业务计算。

- [ ] **Step 2: WorkBuddy 用系统 Chrome 做视觉 QA**

  生成 1920px 和 430px 明暗截图到 `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/orders-operations-workbuddy`，不得在仓库写截图或缓存。

- [ ] **Step 3: WorkBuddy 提交其文件范围**

  `git commit -m "feat: redesign orders operations center"`

### Task 5: 集成、交互与端到端验收

**Files:**
- Modify: `tests/e2e/orders.spec.ts`
- Modify: `src/components/orders/orders-workspace.tsx`
- Create: `src/components/orders/inspection-quote-dialog.tsx`

**Interfaces:**
- Consumes: Task 1-4 全部接口。
- Produces: 可运行、可筛选、可下钻且无假动作的页面。

- [ ] **Step 1: 写 E2E 失败测试**

  覆盖编号、全部单据页签、20 辆 10/10、负载不等时两套数字同时可见、流程卡筛选、检查原文/AI 草稿/署名、继承班组、正式交单前改组和正式交单后锁定。

- [ ] **Step 2: 运行 E2E 并确认 RED**

  使用隔离端口和系统 Chrome，不能复用 3002。

- [ ] **Step 3: 最小集成 UI 与 API**

  列表、流程卡和概览统一使用服务端合同；同页详情使用对话框，不使用抽屉。

- [ ] **Step 4: 运行 focused GREEN**

  Run: `npm run test:e2e -- tests/e2e/orders.spec.ts`

- [ ] **Step 5: 运行全量验证**

  Run: `npm run typecheck`

  Run: `npm run test:unit`

  Run: `npm run test:collaboration`

  Run: `npm run test:e2e -- tests/e2e/orders.spec.ts tests/e2e/dashboard.spec.ts`

- [ ] **Step 6: 系统 Chrome 视觉验收**

  1920px 与 430px、明暗主题均需 HTTP 200、console/pageerror 0、无 Next overlay、根容器无横向溢出。

- [ ] **Step 7: 提交**

  `git commit -m "feat: complete orders operations workflow"`
