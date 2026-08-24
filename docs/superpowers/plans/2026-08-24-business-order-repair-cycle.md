# 正式系统阶段 3：Business Order 与第一轮维修实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可持久化、可追溯、可实际操作的 Business Order、收费版本、维修轮次、接车资料、独立 Inspection Report 与正式交单闭环。

**Architecture:** Business Order 保存车辆和付款责任快照；收费采用当前版本指针加不可变版本明细；每一轮维修独立保存流转事实；Inspection Report 只强制关联车辆；正式交单与取消均追加事实。服务层在事务中校验角色、状态、版本和金额，PC 页面只调用服务层能力。

**Tech Stack:** Next.js 16、React 19、TypeScript、PostgreSQL 18、Drizzle ORM、Zod、Vitest、PGlite。

**Spec:** `docs/architecture/2026-08-24-formal-system-roadmap.md`

## Global Constraints

- 只开发和测试，不连接正式服务器、域名或生产数据库。
- 页面和正式文件只使用 `Business Order` 全称。
- 金额保存 JMD 最小货币单位整数，接口使用十进制字符串，禁止浮点金额运算。
- 状态只有 `待派单、已派单、维修中、回单待审核、已交单`；完成状态由后续取车与结清事实计算。
- Inspection Report 是独立工作成果；车辆必填，来源 Business Order 和维修轮次均可空。
- 收款、Receipt、退款、取车、停车费和催收属于后续阶段，本计划只预留查询接口，不创建假记录。
- 每个写操作校验乐观锁版本并写统一审计；老板只读，超级管理员与前台可操作。

---

### Task 1：Business Order 与收费版本数据库事实

**Files:**
- Create: `src/db/schema/business-order.ts`
- Create: `src/db/schema/business-order.integration.test.ts`
- Modify: `src/db/schema/index.ts`
- Create: `drizzle/0009_business_order_core.sql`

**Interfaces:**
- Produces: `businessOrders`、`businessOrderChargeVersions`、`businessOrderChargeItems`、`businessOrderNotes`。
- Business Order 保存 `vehicleId`、个人/公司付款责任二选一快照、可选公司联系人、当前收费版本、创建人、作废事实和 `version`。
- 收费行种类固定为 `labor | part | other`；行保存双语名称/描述、收费单位、数量定点值、含税单价、本项折扣和稳定排序。

- [ ] **Step 1: 写失败的结构测试**

```ts
it("rejects a Business Order without exactly one payer snapshot", async () => {
  await expect(insertBusinessOrder({ personId: null, companyId: null }))
    .rejects.toThrow();
});

it("keeps charge versions immutable and requires nonnegative totals", async () => {
  await expect(updateChargeVersion(existingVersionId)).rejects.toThrow();
  await expect(insertChargeItem({ unitPriceMinor: -1 })).rejects.toThrow();
});
```

- [ ] **Step 2: 运行红灯测试**

Run: `pnpm vitest run src/db/schema/business-order.integration.test.ts`

Expected: FAIL，因为 Business Order 结构尚不存在。

- [ ] **Step 3: 建立最小表、约束、索引和不可变触发器**

编号格式使用 `BO-YYYYMMDD-NNNN`；Business Order 必须且只能保存一个付款责任主体；公司付款时联系人必须属于该公司。收费版本与收费行禁止更新和删除，收费修改通过新版本完成。

- [ ] **Step 4: 生成迁移并验证绿灯**

Run: `pnpm db:generate && pnpm vitest run src/db/schema/business-order.integration.test.ts && pnpm exec drizzle-kit check`

Expected: PASS，迁移顺序和快照一致。

- [ ] **Step 5: 提交数据库事实**

```bash
git add src/db/schema drizzle
git commit -m "feat: add Business Order core schema"
```

### Task 2：Business Order 创建与收费版本服务

**Files:**
- Create: `src/modules/business-order/business-order-schemas.ts`
- Create: `src/modules/business-order/business-order-runtime.ts`
- Create: `src/modules/business-order/business-order-service.ts`
- Create: `src/modules/business-order/business-order-service.integration.test.ts`
- Modify: `src/modules/permissions/permissions.ts`
- Modify: `src/modules/permissions/permissions.test.ts`

**Interfaces:**
- Produces: `createBusinessOrder(input, actor)`、`listBusinessOrders(query, actor)`、`getBusinessOrder(id, actor)`、`replaceChargeVersion(input, actor)`、`voidBusinessOrder(input, actor)`。
- `createBusinessOrder` 从车辆当前归属复制付款责任快照；公司车辆要求选择当前有效公司联系人。
- `replaceChargeVersion` 接受 `expectedBusinessOrderVersion`、修改原因、三类收费行、分类折扣和整单折扣，返回金额汇总和新版本号。

- [ ] **Step 1: 写创建、金额和权限失败测试**

```ts
it("copies the vehicle payer and creates the first empty charge version", async () => {});
it("calculates line discounts before category and whole-order discounts", async () => {});
it("rejects stale versions and owner writes", async () => {});
it("voids only an unassigned order and audits the reason", async () => {});
```

- [ ] **Step 2: 运行红灯测试**

Run: `pnpm vitest run src/modules/business-order/business-order-service.integration.test.ts`

Expected: FAIL，因为服务和权限尚不存在。

- [ ] **Step 3: 实现金额守恒和事务服务**

计算顺序固定：数量乘含税单价，减本项折扣；分组后减对应分类折扣；全部分组相加后减整单折扣。任一折扣不得使所属金额为负。所含 GCT 为最终应税含税金额乘 `15 / 115`，使用整数舍入函数。

- [ ] **Step 4: 运行服务和权限测试**

Run: `pnpm vitest run src/modules/business-order src/modules/permissions`

Expected: PASS。

- [ ] **Step 5: 提交创建与收费服务**

```bash
git add src/modules/business-order src/modules/permissions
git commit -m "feat: add Business Order creation and charges"
```

### Task 3：维修轮次、派单、接单、回单与接车资料

**Files:**
- Modify: `src/db/schema/business-order.ts`
- Create: `drizzle/0010_repair_rounds.sql`
- Create: `src/modules/business-order/repair-round-service.ts`
- Create: `src/modules/business-order/repair-round-service.integration.test.ts`
- Modify: `src/modules/customer-vehicle/attachment-storage.ts`

**Interfaces:**
- Produces: `assignRound`、`acceptRound`、`recordIntakeMileage`、`attachIntakePhoto`、`submitWorkReturn`、`returnWorkReturn`、`approveWorkReturn`。
- 派单事实保存班组、操作者、客户已确认询问结果和时间；维修轮次事实以追加记录保存，禁止覆盖第一轮时间戳。
- 接车照片复用 `storedFiles`，同时关联维修轮次和车辆档案。

- [ ] **Step 1: 写完整第一轮流转失败测试**

```ts
it("returns without changes when an unpaid order is not confirmed", async () => {});
it("records assignment, acceptance, mileage, return, rejection and approval separately", async () => {});
it("allows intake records only after acceptance", async () => {});
```

- [ ] **Step 2: 运行红灯测试**

Run: `pnpm vitest run src/modules/business-order/repair-round-service.integration.test.ts`

Expected: FAIL，因为维修轮次事实尚不存在。

- [ ] **Step 3: 实现状态投影和追加事实**

当前状态由本轮最新事实投影，不允许任意直接写状态。回单退回和再次提交继续使用同一轮。班组停用继承只转移未完成轮次的当前责任，不改写原派单历史。

- [ ] **Step 4: 运行迁移和服务测试**

Run: `pnpm vitest run src/db/schema/business-order.integration.test.ts src/modules/business-order/repair-round-service.integration.test.ts && pnpm exec drizzle-kit check`

Expected: PASS。

- [ ] **Step 5: 提交维修轮次服务**

```bash
git add src/db/schema drizzle src/modules/business-order src/modules/customer-vehicle
git commit -m "feat: add repair round workflow"
```

### Task 4：独立 Inspection Report

**Files:**
- Create: `src/db/schema/inspection-report.ts`
- Create: `src/modules/inspection-report/inspection-report-service.ts`
- Create: `src/modules/inspection-report/inspection-report-service.integration.test.ts`
- Create: `drizzle/0012_inspection_reports.sql`
- Modify: `src/db/schema/index.ts`

**Interfaces:**
- Produces: `createInspectionReport`、`submitInspectionReport`、`correctInspectionReport`、`listVehicleInspectionReports`。
- 车辆必填；来源 Business Order、来源维修轮次、实际检查人、代录人和纸质照片均可独立保存。

- [ ] **Step 1: 写独立性和更正失败测试**

```ts
it("submits a report with a vehicle and no Business Order", async () => {});
it("keeps the submitted report immutable and appends a correction", async () => {});
it("does not change Business Order status or charges", async () => {});
```

- [ ] **Step 2: 运行红灯测试**

Run: `pnpm vitest run src/modules/inspection-report/inspection-report-service.integration.test.ts`

Expected: FAIL，因为报告结构尚不存在。

- [ ] **Step 3: 实现独立报告和更正链**

报告编号使用 `IR-YYYYMMDD-NNNN`。提交后原内容不可更新；更正使用新记录指向被更正报告。来源字段只用于追溯，不作为创建条件。

- [ ] **Step 4: 验证绿灯**

Run: `pnpm vitest run src/modules/inspection-report src/db/schema && pnpm exec drizzle-kit check`

Expected: PASS。

- [ ] **Step 5: 提交 Inspection Report**

```bash
git add src/db/schema src/modules/inspection-report drizzle
git commit -m "feat: add independent Inspection Reports"
```

### Task 5：正式交单、当月取消与收费快照

**Files:**
- Modify: `src/db/schema/business-order.ts`
- Create: `src/modules/business-order/formal-handoff-service.ts`
- Create: `src/modules/business-order/formal-handoff-service.integration.test.ts`
- Create: `drizzle/0013_formal_handoffs.sql`

**Interfaces:**
- Produces: `formallyHandOffRound`、`cancelFormalHandoffInSameMonth`。
- 每次交单保存维修轮次、班组、绩效值、牙买加交单月份、收费版本和完整金额快照；取消追加记录，不删除原交单；再次交单新增事实。

- [ ] **Step 1: 写交单事实失败测试**

```ts
it("freezes team, performance and charge totals at handoff", async () => {});
it("cancels only in the Jamaica calendar month and preserves the original fact", async () => {});
it("creates a new fact when handed off again", async () => {});
```

- [ ] **Step 2: 运行红灯测试**

Run: `pnpm vitest run src/modules/business-order/formal-handoff-service.integration.test.ts`

Expected: FAIL，因为交单事实尚不存在。

- [ ] **Step 3: 实现交单与取消事务**

只有已审核回单可交单。绩效值允许正、零、负。取消要求填写原因且只能取消当前有效交单；收费后续修改不更新既有交单快照。

- [ ] **Step 4: 验证绿灯**

Run: `pnpm vitest run src/modules/business-order && pnpm exec drizzle-kit check`

Expected: PASS。

- [ ] **Step 5: 提交正式交单事实**

```bash
git add src/db/schema src/modules/business-order drizzle
git commit -m "feat: add formal handoff facts"
```

### Task 6：PC 操作页面与阶段验收

**Files:**
- Create: `src/app/(protected)/business-orders/page.tsx`
- Create: `src/app/(protected)/business-orders/[businessOrderId]/page.tsx`
- Create: `src/app/(protected)/business-orders/actions.ts`
- Create: `src/app/(protected)/inspection-reports/page.tsx`
- Create: `src/app/(protected)/inspection-reports/actions.ts`
- Create: `src/app/(protected)/business-orders/pages.test.tsx`
- Modify: `src/modules/permissions/role-navigation.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Business Order 列表后端翻页；详情页状态区是一条由小方块组成的长进度条，并在同一区域显示当前全部可执行操作。
- 收费行固定一行：`项目名称｜描述｜单位｜数量｜含税单价｜本项折扣｜含税小计｜译｜删`，工时、配件、其他费用分区，不出现横向滚动条。
- 维修工操作入口不在 PC 页面；本阶段服务接口已为后续手机端复用。

- [ ] **Step 1: 写页面失败测试**

```tsx
it("shows every editable charge field on one row without a horizontal-scroll container", async () => {});
it("shows only valid current actions in the progress area", async () => {});
it("keeps owner controls read-only", async () => {});
```

- [ ] **Step 2: 运行红灯测试**

Run: `pnpm vitest run src/app/\(protected\)/business-orders`

Expected: FAIL，因为页面尚不存在。

- [ ] **Step 3: 实现紧凑页面和服务端操作**

新建入口先按规范化车牌搜索；无车辆时进入车辆创建并可返回继续建单。创建时间自动生成。详情页提供收费、派单、代录回单、Inspection Report 来源入口和正式交单操作；所有失败显示明确业务原因。

- [ ] **Step 4: 全量验证**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm exec drizzle-kit check && git diff --check`

Expected: 全部通过，无构建警告。

- [ ] **Step 5: 浏览器验收并提交**

按验收清单第 7–12 节逐项操作，记录 URL、角色、输入和持久化结果。确认阶段 3 后再进入独立收款、Receipt 与退款。

```bash
git add src/app src/modules/permissions src/app/globals.css
git commit -m "feat: add Business Order PC workflow"
```
