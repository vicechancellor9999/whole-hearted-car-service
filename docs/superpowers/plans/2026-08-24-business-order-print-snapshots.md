# Business Order Office and Mechanic Print Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一张 Business Order 中生成可补打的办公室留底联和全中文维修工联，并保存每次正式生成时的不可修改渲染快照。

**Architecture:** 新增追加式 `business_order_document_snapshots` 事实表。每次“生成”都从当前 Business Order、收费版本、收付款史和维修轮次组装 JSONB 快照，之后的收费修改、收款或退款不会改写旧打印件。补打只按文档 ID 读取原编号和原快照；如用户需要当前数据，明确再生成一份新文档。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、PostgreSQL/Drizzle ORM、Vitest + PGlite。

## Global Constraints

- 界面一律写全称 `Business Order`。
- 办公室留底联为中英文参照，重点显示收费项目、工时/配件/其他费用、本项折扣、分类折扣、整单折扣、含税总额、所含 15% GCT、收付款历史、余额、备注和客户认可签字区。
- 维修工联全中文，只显示 Business Order 编号、车辆、VIN、当前维修轮次/班组、施工项目、工作说明、责任义务与提前告知、回单填写区。
- 维修工联严禁显示客户姓名、电话、TRN、联系人、单价、折扣、总额、收付款、余额或绩效。
- 办公室内部备注只进办公室联；维修工联只进与施工相关的客户诉求、工作说明、责任义务与提前告知。
- 文档事实表不允许 UPDATE/DELETE；渲染页不回查实时业务数据。
- 超级管理员和前台可生成；老板只能查看和补打已生成文档。
- 不部署，不新建演示业务数据。

---

### Task 1：不可修改的打印文档事实

**Files:**
- Create: `src/db/schema/business-order-document.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/business-order-document.integration.test.ts`
- Create: `drizzle/0015_business_order_documents.sql`
- Create: `drizzle/meta/0015_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- 文档类型：`office_archive` 和 `mechanic_work`。
- 编号：`OFF-YYYYMMDD-0001` 和 `MEC-YYYYMMDD-0001`，全局唯一。
- 共同来源：Business Order、收费版本、生成时间和生成人。维修工联额外强制关联具体维修轮次。

- [ ] 先写失败测试：表和约束存在，文档编号类型匹配，维修工联必须有维修轮次，UPDATE/DELETE 均被拒绝。
- [ ] 运行红灯测试并保留失败证据。
- [ ] 实现 Drizzle 表、索引、检查约束和追加式触发器。
- [ ] 生成迁移，验证 schema 测试和 `drizzle-kit check`。
- [ ] 提交：`feat: add immutable Business Order print facts`。

---

### Task 2：生成、冻结和补打服务

**Files:**
- Create: `src/modules/business-order/business-order-document-service.ts`
- Create: `src/modules/business-order/business-order-document-service.integration.test.ts`
- Modify: `src/modules/business-order/business-order-runtime.ts`

**Interfaces:**
- `generateOfficeArchive(input)`：冻结当前 Business Order、收费版本、收付款历史、余额和办公室备注。
- `generateMechanicWorkCopy(input)`：冻结当前维修轮次、班组、车辆和施工项目，构建时即排除客户与金额字段。
- `listForBusinessOrder(input)`：按生成时间倒序返回已生成文档。
- `getDocument(input)`：只读文档事实和原快照。

- [ ] 先写失败测试：收费和收款变化后旧办公室联不变；维修工联快照不含客户、金额、收付款、绩效字段；老板不能生成但可读取。
- [ ] 运行红灯测试。
- [ ] 实现事务、编号、快照组装、审计和查询。独立数据可并行查询，避免服务端流水等待。
- [ ] 运行服务测试和全量测试。
- [ ] 提交：`feat: freeze Business Order print snapshots`。

---

### Task 3：Business Order 内生成与文档历史

**Files:**
- Create: `src/app/(protected)/business-orders/[businessOrderId]/document-actions.ts`
- Create: `src/app/(protected)/business-orders/[businessOrderId]/document-history.tsx`
- Create: `src/app/(protected)/business-orders/[businessOrderId]/document-history.test.tsx`
- Modify: `src/app/(protected)/business-orders/[businessOrderId]/page.tsx`

- [ ] 先写失败页面测试：可写角色看到“生成办公室留底联”和“生成维修工联”；老板只看文档历史；每条历史可打开补打。
- [ ] 运行红灯页面测试。
- [ ] 实现服务端 action、权限校验、重定向和同页文档历史。
- [ ] 验证页面测试。
- [ ] 提交：`feat: add Business Order print controls`。

---

### Task 4：办公室留底联和全中文维修工联打印页

**Files:**
- Create: `src/app/(protected)/business-orders/[businessOrderId]/documents/[documentId]/page.tsx`
- Create: `src/app/(protected)/business-orders/[businessOrderId]/documents/[documentId]/page.test.tsx`
- Modify: `src/app/globals.css`

- [ ] 先写失败渲染测试：办公室联显示中英文收费、折扣、GCT、收付款、余额、备注和签字区；维修工联只显示中文车辆、施工项目、备注和回单区，断言敏感字段未渲染。
- [ ] 运行红灯渲染测试。
- [ ] 实现一个文档路由下的分类渲染，补打不创建新文档，A4 打印隐藏导航和操作。
- [ ] 运行页面测试、类型检查和构建。
- [ ] 提交：`feat: add office and mechanic print pages`。

---

### Task 5：验收清单与全量校验

**Files:**
- Create: `docs/acceptance/phase-5-business-order-print-copies.md`

- [ ] 写明实际操作顺序：生成两种打印件、查看文档历史、打印、修改收费/增加收款后补打、老板只读、维修工联脱敏。
- [ ] 运行 `npm test && npm run typecheck && npm run lint && npm run build && npm exec drizzle-kit check && git diff --check`。
- [ ] 明确记录人工浏览器验收状态；未配置正式系统 PostgreSQL 时不伪称已手工验收。
- [ ] 提交：`docs: add Business Order print acceptance checklist`。
