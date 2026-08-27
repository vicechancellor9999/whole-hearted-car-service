# 售后维修轮次与绩效汇总 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一张 Business Order 内完成售后新维修轮次、独立交单绩效事实、月度班组汇总和对应 PC 操作入口。

**Architecture:** 复用现有追加式维修轮次与正式交单事实，由服务层事务创建售后轮次并从有效交单实时汇总绩效。前端使用现有 PC 页面作为基准，将正式服务结果映射到 Business Order 详情和绩效页面。

**Tech Stack:** Next.js 16、React 19、TypeScript、PostgreSQL、Drizzle schema、Vitest、Playwright

**Spec:** `docs/superpowers/specs/2026-08-24-after-sales-performance-design.md`

## Global Constraints

- 业务时间和月份按 `America/Jamaica` 计算。
- 金额保存为最小货币单位整数。
- 退款不参与绩效计算。
- 维修轮次、正式交单和取消交单均为追加事实。
- 正式 PC 前端以现有成熟前端源码为展示和交互基准。
- 老板账号全系统只读。

---

### Task 1: 售后维修轮次服务

**Files:**
- Modify: `src/modules/business-order/repair-round-service.integration.test.ts`
- Modify: `src/modules/business-order/repair-round-service.ts`

**Interfaces:**
- Consumes: `business_orders.current_repair_round_no`、`repair_rounds`、`formal_handoffs`、`formal_handoff_cancellations`
- Produces: `RepairRoundService.startAfterSalesRound()`、`RepairRoundService.listRepairRounds()`、`RepairRoundHistoryRecord`

- [ ] **Step 1: 写售后轮次失败测试**

覆盖未正式交单、问题为空、已作废 Business Order、老板写入、并发版本冲突和成功创建第二轮。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm test -- src/modules/business-order/repair-round-service.integration.test.ts`

Expected: FAIL，服务尚无 `startAfterSalesRound` 与 `listRepairRounds`。

- [ ] **Step 3: 实现售后轮次事务**

实现签名：

```ts
async startAfterSalesRound(input: {
  businessOrderId: number;
  expectedBusinessOrderVersion: number;
  issue: string;
  context: BusinessOrderActionContext;
}): Promise<CurrentRepairRound>
```

事务锁定当前 Business Order 和维修轮次，验证当前轮存在有效正式交单，插入下一轮，更新当前轮次投影并写入 `business_order.after_sales_round_started` 审计事件。

- [ ] **Step 4: 实现轮次历史查询**

返回每轮来源、问题、状态、班组、创建时间、关键维修事件和有效正式交单。

- [ ] **Step 5: 运行服务与相邻回归测试**

Run: `pnpm test -- src/modules/business-order/repair-round-service.integration.test.ts src/modules/business-order/formal-handoff-service.integration.test.ts`

Expected: PASS。

### Task 2: 月度绩效汇总服务

**Files:**
- Create: `src/modules/performance/performance-service.ts`
- Create: `src/modules/performance/performance-service.integration.test.ts`
- Create: `src/modules/performance/performance-runtime.ts`

**Interfaces:**
- Consumes: `formal_handoffs`、`formal_handoff_cancellations`、`repair_teams`、`business_orders`、`vehicles`
- Produces: `PerformanceService.getMonthlyPerformance()`、`MonthlyPerformanceResult`

- [ ] **Step 1: 写月度绩效失败测试**

测试同月有效交单求和、取消交单排除、跨月售后进入新月份、不同班组分别汇总、退款写入前后结果一致、老板只读查询。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm test -- src/modules/performance/performance-service.integration.test.ts`

Expected: FAIL，因为绩效服务尚不存在。

- [ ] **Step 3: 实现汇总查询**

实现签名：

```ts
async getMonthlyPerformance(input: {
  month: string;
  viewerAccountId: number;
}): Promise<MonthlyPerformanceResult>
```

用一次有效交单明细查询构建班组汇总和全店总额；使用取消表判断有效性，不读取退款表。

- [ ] **Step 4: 运行服务回归测试**

Run: `pnpm test -- src/modules/performance/performance-service.integration.test.ts src/modules/payment/payment-service.integration.test.ts`

Expected: PASS。

### Task 3: Business Order 售后入口与轮次历史

**Files:**
- Modify: `src/app/(protected)/business-orders/actions.ts`
- Modify: `src/app/(protected)/business-orders/[businessOrderId]/page.tsx`
- Modify: `src/app/(protected)/business-orders/pages.test.tsx`
- Reference: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/main/src/components/orders/quick-order-detail.tsx`
- Reference: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/main/src/components/orders/arrow-chain-status.tsx`

**Interfaces:**
- Consumes: `startAfterSalesRound()`、`listRepairRounds()`
- Produces: Business Order 详情中的售后入口和完整轮次历史

- [ ] **Step 1: 写页面失败测试**

验证已正式交单时显示售后回厂操作，新轮次后恢复待派单；每轮交单和绩效独立显示；老板只显示历史。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm test -- 'src/app/(protected)/business-orders/pages.test.tsx'`

Expected: FAIL，页面尚无售后入口和完整轮次历史。

- [ ] **Step 3: 连接服务操作**

在统一 Business Order action 中增加 `start_after_sales_round`，提交当前版本和售后问题，成功后回到同一详情页。

- [ ] **Step 4: 迁入现有 Business Order 展示结构**

复用现有 PC 前端的页面层级、方块进度条和操作区，把正式数据映射到对应区域；收费项目保持现有一行式布局。

- [ ] **Step 5: 运行页面测试**

Run: `pnpm test -- 'src/app/(protected)/business-orders/pages.test.tsx'`

Expected: PASS。

### Task 4: 正式绩效页面

**Files:**
- Create: `src/app/(protected)/performance/page.tsx`
- Create: `src/app/(protected)/performance/page.test.tsx`
- Modify: `src/modules/permissions/role-navigation.ts`
- Modify: `src/modules/permissions/role-navigation.test.ts`
- Reference: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/main/src/components/performance/performance-workspace.tsx`

**Interfaces:**
- Consumes: `PerformanceService.getMonthlyPerformance()`
- Produces: `/performance` 月份汇总、班组合计和正式交单明细

- [ ] **Step 1: 写页面和导航失败测试**

验证三种 PC 身份均可查看，老板页面没有写入操作，月份切换后显示对应交单明细。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm test -- 'src/app/(protected)/performance/page.test.tsx' src/modules/permissions/role-navigation.test.ts`

Expected: FAIL，正式绩效页面和导航尚不存在。

- [ ] **Step 3: 实现页面并映射现有前端结构**

按月份显示全店绩效、班组汇总和每次有效交单明细，使用现有绩效页面的信息密度和布局。

- [ ] **Step 4: 运行页面测试**

Run: `pnpm test -- 'src/app/(protected)/performance/page.test.tsx' src/modules/permissions/role-navigation.test.ts`

Expected: PASS。

### Task 5: 回归与浏览器验收

**Files:**
- Modify: `tests/e2e/business-order-repair-cycle.spec.ts`
- Create: `tests/e2e/after-sales-performance.spec.ts`

**Interfaces:**
- Consumes: 正式登录、Business Order、售后轮次、正式交单、绩效页面
- Produces: 可重复执行的纵向业务验收路径

- [ ] **Step 1: 写端到端路径测试**

覆盖第一轮正式交单、售后第二轮、负绩效交单、月度汇总和老板只读。

- [ ] **Step 2: 运行类型、单元和集成测试**

Run: `pnpm typecheck && pnpm test`

Expected: PASS。

- [ ] **Step 3: 运行代码检查和构建**

Run: `pnpm lint && pnpm build`

Expected: PASS。

- [ ] **Step 4: 在 3211 浏览器验收**

登录超级管理员，完成售后新轮次和绩效查看；再以老板身份验证只读。核对页面身份、控制台、操作结果和现有 PC 前端基准。
