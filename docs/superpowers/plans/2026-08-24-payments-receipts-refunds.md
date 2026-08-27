# Payments, Receipts, and Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立逐笔不可修改收款、每笔唯一 Receipt、自由金额退款、退款凭证与客户签收，并在 Business Order 内形成可操作的财务闭环。

**Architecture:** 收款、Receipt、退款和退款证据均保存为追加事实；Business Order 当前应收仍来自最新版收费项目，累计收款和累计退款来自独立交易，余额实时推导。每笔收款在同一事务中冻结 Receipt 渲染快照；补打只读取原编号和原快照。退款不绑定收费项目、不修改原收款，也不影响绩效。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、PostgreSQL/Drizzle ORM、Zod、Vitest + PGlite。

**Spec:** `docs/architecture/2026-08-24-formal-system-roadmap.md` 第 5.8、5.9、6、7 节。

## Global Constraints

- 用户界面必须写全称 `Business Order`，不使用缩写。
- 每次收款是独立且不可编辑的记录；三笔收款对应三张不同编号的 Receipt。
- 每笔 Receipt 保存生成当时的收费项目、备注、历次收付款、当次收款和余额快照；补打不得重算或换号。
- 退款金额按实际填写，不绑定项目，不修改收费项目、收款、Receipt 或绩效。
- 退款必须先保存原因、退款方式和原单处理情况；现金退款当场保存客户签字，非现金退款在记录生成后追加一次实际付款凭证且不得替换。
- 原单无法交回时允许退款，但必须选择“原单无法交回”并填写说明。
- 应收余额始终按 `当前折后应收 - 累计收款 + 累计退款` 推导，不保存可手填余额。
- 超级管理员可退款；前台只有取得 `sensitive_operations.execute` 下放权限后才可退款；老板只读。
- 所有金额使用 JMD 最小货币单位整数保存；输入金额最多两位小数。
- 不部署，不写生产密钥，不创建演示业务记录。

---

### Task 1：不可改写财务事实表

**Files:**
- Create: `src/db/schema/payment.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/schema/payment.integration.test.ts`
- Create: `drizzle/0014_payments_receipts_refunds.sql`
- Create: `drizzle/meta/0014_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `businessOrderPayments`、`paymentReceipts`、`businessOrderRefunds`、`refundEvidenceFiles`。
- `paymentReceipts.paymentId` 一对一，`receiptNo` 全局唯一，`renderSnapshot` 为不可改写 JSONB。
- `businessOrderRefunds` 保存正金额、方式、原因、原单状态、无法交回说明和发生时间。
- `refundEvidenceFiles` 复用 `stored_files`，区分 `refund_proof` 与 `customer_signature`。

- [ ] **Step 1: 写失败测试**

```ts
it("keeps payments, receipts, refunds and evidence append-only", async () => {
  await expect(database.exec("update business_order_payments set amount_minor = 1")).rejects.toThrow();
  await expect(database.exec("delete from payment_receipts")).rejects.toThrow();
  await expect(database.exec("update business_order_refunds set reason = 'changed'")).rejects.toThrow();
});
```

- [ ] **Step 2: 运行红灯测试**

Run: `pnpm vitest run src/db/schema/payment.integration.test.ts`

Expected: FAIL，因为财务事实表尚不存在。

- [ ] **Step 3: 实现表、约束和禁止 UPDATE/DELETE 的触发器**

```ts
export const receiptSnapshotSchema = z.object({
  businessOrder: z.object({ orderNo: z.string(), plate: z.string(), payerName: z.string() }),
  charges: z.unknown(),
  transactions: z.array(z.unknown()),
  currentPaymentMinor: z.number().int().positive(),
  balanceAfterMinor: z.number().int(),
});
```

编号格式使用 `PAY-YYYYMMDD-0001`、`RCT-YYYYMMDD-0001`、`RFD-YYYYMMDD-0001`；外键一律 `restrict`，金额必须大于零，文本原因不得为空。

- [ ] **Step 4: 生成迁移并验证通过**

Run: `pnpm db:generate && pnpm vitest run src/db/schema/payment.integration.test.ts && pnpm exec drizzle-kit check`

Expected: PASS；迁移只新增本任务对象。

- [ ] **Step 5: 提交**

```bash
git add src/db/schema drizzle
git commit -m "feat: add immutable payment facts"
```

---

### Task 2：逐笔收款、Receipt 快照和余额守恒

**Files:**
- Create: `src/modules/payment/payment-errors.ts`
- Create: `src/modules/payment/payment-schemas.ts`
- Create: `src/modules/payment/payment-service.ts`
- Create: `src/modules/payment/payment-runtime.ts`
- Create: `src/modules/payment/payment-service.integration.test.ts`
- Modify: `src/modules/business-order/business-order-runtime.ts`

**Interfaces:**
- Produces: `PaymentService.recordPayment(input)`、`PaymentService.getBusinessOrderLedger(input)`、`PaymentService.getReceipt(input)`。
- `recordPayment` 输入 `businessOrderId`、`amount`、`paymentMethodItemId`、`note` 和标准操作上下文。
- `getBusinessOrderLedger` 返回 `currentDueMinor`、`totalPaidMinor`、`totalRefundedMinor`、`balanceMinor` 和按发生时间排序的独立交易。

- [ ] **Step 1: 写失败测试**

```ts
it("records three independent payments and creates three immutable receipts", async () => {
  const first = await service.recordPayment({ amount: "3000", ...input });
  const second = await service.recordPayment({ amount: "2500", ...input });
  const third = await service.recordPayment({ amount: "1000", ...input });
  expect(new Set([first.receiptNo, second.receiptNo, third.receiptNo]).size).toBe(3);
  expect((await service.getBusinessOrderLedger(query)).totalPaidMinor).toBe(650_000);
});
```

另测：老板不能收款、停用支付方式不能使用、并发编号唯一、收费后来修改不改变旧 Receipt、补打读取同一快照。

- [ ] **Step 2: 运行红灯测试**

Run: `pnpm vitest run src/modules/payment/payment-service.integration.test.ts`

Expected: FAIL，因为服务尚不存在。

- [ ] **Step 3: 实现收款事务**

```ts
await database.transaction(async (transaction) => {
  const due = await lockBusinessOrderAndReadCurrentCharges(transaction, input.businessOrderId);
  const history = await readLedgerFacts(transaction, input.businessOrderId);
  const payment = await insertPaymentFact(transaction, parsed, context);
  const snapshot = buildReceiptSnapshot({ due, history, payment });
  const receipt = await insertReceiptFact(transaction, payment.id, snapshot, context);
  await assertLedgerConservation(transaction, input.businessOrderId);
  await writeAuditEvent(transaction, { eventType: "payment.recorded", ...audit });
  return { payment, receipt };
});
```

收款允许分次、允许超过当前应收；系统只显示由事实推导的余额，不自行决定抵扣项目。

- [ ] **Step 4: 运行服务与全量测试**

Run: `pnpm vitest run src/modules/payment/payment-service.integration.test.ts && pnpm test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/modules/payment src/modules/business-order/business-order-runtime.ts
git commit -m "feat: add independent payments and receipts"
```

---

### Task 3：自由金额退款、凭证和客户签收

**Files:**
- Modify: `src/modules/payment/payment-schemas.ts`
- Modify: `src/modules/payment/payment-service.ts`
- Modify: `src/modules/payment/payment-service.integration.test.ts`
- Create: `src/modules/payment/refund-attachment-storage.ts`
- Create: `src/modules/payment/refund-attachment-storage.test.ts`

**Interfaces:**
- Produces: `PaymentService.recordRefund(input)`、`PaymentService.appendRefundProof(input)`。
- 创建退款输入包括 `amount`、`paymentMethodItemId`、`reason`、`originalDocumentStatus`、`originalDocumentNote`；现金退款另含客户签字文件元数据。非现金退款凭证在记录生成后单独追加。
- 退款不接收收费项目 ID 或收款 ID。

- [ ] **Step 1: 写失败测试**

```ts
it("accepts an arbitrary refund amount without touching payments, charges or performance", async () => {
  const refund = await service.recordRefund({ amount: "5000", reason: "客户退款", ...proof });
  expect(refund.amountMinor).toBe(500_000);
  expect(await unchangedFacts()).toEqual({ payments: true, charges: true, handoffs: true });
});
```

另测：非现金退款无凭证也能先生成；之后可追加一次凭证；第二次上传替换被拒绝；现金缺客户签字拒绝且不要求额外凭证；原单无法交回但无说明拒绝；老板拒绝；无下放权限的前台拒绝；有下放权限的前台成功；审计事件分别为 `refund.created` 和 `refund.proof_attached`。

- [ ] **Step 2: 运行红灯测试**

Run: `pnpm vitest run src/modules/payment/payment-service.integration.test.ts src/modules/payment/refund-attachment-storage.test.ts`

Expected: FAIL，因为退款接口和安全存储尚不存在。

- [ ] **Step 3: 实现退款事务和文件补偿清理**

退款文件仅允许 JPG、PNG、WebP、PDF，每个不超过 25 MB，保存到 `refund-files/YYYY/MM/`。现金签字随退款事务归档；非现金退款先写入退款事实，实际退款后另行上传凭证。文件先落盘、事务失败则删除新文件；凭证追加事务锁定退款记录并拒绝覆盖已有凭证。

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run src/modules/payment && pnpm test`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/modules/payment
git commit -m "feat: add refund evidence workflow"
```

---

### Task 4：Business Order 内直接收退款与 Receipt 打印

**Files:**
- Create: `src/app/(protected)/business-orders/[businessOrderId]/finance-actions.ts`
- Create: `src/app/(protected)/business-orders/[businessOrderId]/finance-panel.tsx`
- Create: `src/app/(protected)/business-orders/[businessOrderId]/receipts/[receiptId]/page.tsx`
- Create: `src/app/(protected)/business-orders/[businessOrderId]/refunds/[refundId]/page.tsx`
- Create: `src/app/api/refund-evidence/[fileId]/route.ts`
- Modify: `src/app/(protected)/business-orders/[businessOrderId]/page.tsx`
- Modify: `src/app/globals.css`
- Create: `src/app/(protected)/business-orders/[businessOrderId]/finance-panel.test.tsx`

**Interfaces:**
- Business Order 详情内直接显示收款、退款、Receipt 和余额，不跳到另一个台账再返回。
- Receipt 页面以已冻结快照渲染中文/英文客户版本；补打按钮不创建新编号。
- 退款页面就是一张“退款说明与签收单”，显示车辆、Business Order、退款金额、原因、原单处理、凭证和签收，不再拆成多张单。

- [ ] **Step 1: 写失败页面测试**

```tsx
it("records each payment from the Business Order and exposes its own Receipt", async () => {});
it("lets an authorized user enter any refund amount without choosing charge items", async () => {});
it("shows owner the immutable ledger without write controls", async () => {});
```

- [ ] **Step 2: 运行红灯测试**

Run: `pnpm vitest run 'src/app/(protected)/business-orders/[businessOrderId]/finance-panel.test.tsx'`

Expected: FAIL，因为财务面板尚不存在。

- [ ] **Step 3: 实现同页财务面板和打印页**

面板固定显示：当前折后应收、累计收款、累计退款、未结余额；其下逐笔显示时间、类型、方式、金额、操作人、备注和对应 Receipt/退款签收单入口。收款表单只填金额、方式、备注；退款表单只填金额、方式、原因、原单情况、凭证和现金签字，不出现收费项目选择。

- [ ] **Step 4: 完整验证**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm exec drizzle-kit check && git diff --check`

Expected: 全部通过；普通 PC 宽度无横向滚动条。

- [ ] **Step 5: 提交**

```bash
git add src/app src/app/globals.css
git commit -m "feat: add Business Order payment workflow"
```

---

### Task 5：人工验收清单

**Files:**
- Create: `docs/acceptance/phase-4-payments-receipts-refunds.md`

- [ ] **Step 1: 写明可重复操作步骤**

1. 以前台登录，打开一张已有收费项目的 Business Order。
2. 分别录入 JMD 3,000、JMD 2,500、JMD 1,000 三笔收款。
3. 确认出现三条不可编辑收款和三个不同 Receipt 编号。
4. 逐张打开 Receipt，核对当次金额、收费项目、历次收付款、时间、方式和收款后余额。
5. 修改 Business Order 收费项目后补打第一张 Receipt，确认编号和旧快照不变。
6. 以无敏感权限前台尝试退款，确认系统拒绝且不产生退款事实。
7. 下放敏感权限后先生成任意金额非现金退款，确认不选择项目、也不要求预先提供退款凭证；退款生成后再补传一次实际退款凭证，确认凭证不可替换。
8. 录入现金退款，未提供客户签字时确认无法提交；客户签字后完成，签字本身即为客户收款证据，不再另传退款凭证。
9. 选择原单无法交回，未填说明时确认无法提交；填说明后完成。
10. 打开退款说明与签收单，确认全部信息集中在同一张单。
11. 核对应收、累计收款、累计退款和余额满足守恒公式。
12. 检查收费版本、原收款、Receipt、正式交单和绩效事实均未被退款改写。
13. 以老板登录，确认能够查看全账但没有收款和退款按钮。
14. 检查审计记录含收款；日报敏感操作数据源含退款车辆、操作人、原因和金额。

- [ ] **Step 2: 浏览器逐项验收并记录证据**

记录每一步使用的 URL、角色、输入、生成编号和数据库持久化结果。若本机尚无 PostgreSQL 运行环境，明确记录为环境阻塞，不用假数据冒充验收通过。

- [ ] **Step 3: 提交清单**

```bash
git add docs/acceptance/phase-4-payments-receipts-refunds.md
git commit -m "docs: add payment acceptance checklist"
```
