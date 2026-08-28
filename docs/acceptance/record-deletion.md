# 正式记录删除验收

## 用户可见规则

- 正式客户档案、车辆档案、业务单、检查单详情页都显示名为“删除”的操作。
- 可执行角色：`super_admin`、`front_desk`。其他角色不显示删除入口。
- 最终确认必须完成：选择删除原因、逐项选择需要一并删除的关联主记录、重新检查关联、输入当前记录编号、点击“确认删除”。
- 删除原因：重复创建、录入错误、测试数据、其他；选择“其他”时必须填写说明。
- 资格不满足时只显示具体原因，不发送删除请求。

## 数据边界

- 删除是正式业务操作，不是绕过数据库约束的直接 `DELETE`。
- 客户、公司客户、公司联系人、车辆、业务单、维修轮次和检查单主记录均有数据库删除闸门；普通 SQL 即使目标记录没有从属资料也会被拒绝。
- 预检和执行之间任何关联资料或版本变化都会使预览失效，必须重新检查。
- 客户和车辆的手机号、TRN、车牌、VIN 在成功删除后释放，可被新档案再次使用。
- 数据库只允许同一事务中、已登记请求编号和精确行键的删除；直接 SQL、伪造上下文和扩大删除范围仍被拒绝。
- 删除、审计和待清理文件任务同一事务提交；文件物理清理失败会保留任务并重试，不回滚已确认的数据库删除。
- 审计和删除回执保留记录类型、编号、原因、操作者、结果和计数，不保留已释放的手机号、TRN、车牌或 VIN 原文。
- 成功审计保存操作者角色快照、原因说明、预览指纹和删除数量；权限拒绝、阻断、预览失效和执行失败另写 `record.deletion_rejected` 及标准阻止码。

## 资格与阻断

### 客户档案

- 可以一并选择仅有主档关系的车辆。
- 当前车辆和仅存在于车主历史中的车辆都必须进入关联删除范围，不能因车辆已经换主而漏检外键关系。
- 已存在不能随主档删除的业务事实时阻断：`HAS_CUSTOMER_BUSINESS_FACT`。
- 未选择关联车辆时阻断：`HAS_VEHICLE`。

### 车辆档案

- 可一并选择尚未开始维修且符合资格的业务单、草稿检查单。
- 争议、进出场、里程、维修或停车事实分别以 `HAS_VEHICLE_DISPUTE`、`HAS_VEHICLE_PRESENCE_FACT`、`HAS_MILEAGE_RECORD`、`HAS_REPAIR_FACT`、`HAS_PARKING_FACT` 阻断。

### 业务单

- 仅待派单、恰好一个初始维修轮次且没有后续业务事实时可删除。
- 派工/维修/回单/里程/照片/收退款/Receipt/正式文件/正式交单/取车离场/停车事实均阻断。
- 浏览器验收固定覆盖 `HAS_PAYMENT`；策略测试覆盖其余阻断码。

### 检查单

- 仅草稿且没有沟通、更正关系或正式文件引用时可删除。
- 已提交检查单以 `INSPECTION_SUBMITTED` 阻断。

## 自动化验收数据

所有编号均为隔离夹具，不读取或删除现有业务记录：

- 客户：`CUST-202608-9901`
- 车辆：`VEH-202608-9901`
- 业务单：`KGN-WH-2026082799901`
- 检查单：`IR-20260827-9901`

端到端路径：

1. 前台删除草稿检查单，返回列表后刷新仍不存在，执行请求只有一次。
2. 已提交检查单显示 `INSPECTION_SUBMITTED`，没有确认按钮，也没有执行请求。
3. 有收款事实的业务单显示 `HAS_PAYMENT`，没有执行请求。
4. 非授权角色看不到删除入口。
5. 客户必须明确勾选关联车辆并重新检查，成功后手机号和车牌身份释放提示可见，返回列表刷新后两条记录均不存在。
6. `390 × 844` 视口下弹窗完全位于视口内，页面无横向溢出。
7. 首次执行返回网络错误后再次确认，浏览器沿用同一个幂等请求号。

## 验收命令

```bash
pnpm exec vitest run src/modules/record-deletion src/app/api/record-deletions src/modules/permissions/permissions.test.ts
pnpm --dir apps/web exec playwright test --config=playwright.unit.config.ts tests/unit/formal-record-deletions.spec.ts tests/unit/record-delete-dialog.spec.tsx tests/unit/record-deletion-entry-points.spec.tsx
NEXT_PUBLIC_FORMAL_CUSTOMER_VEHICLE=true pnpm --dir apps/web exec playwright test tests/e2e/record-deletion.spec.ts
pnpm typecheck
pnpm typecheck:web
pnpm build
git diff --check
```

## 候选系统人工验收

候选入口：`http://localhost:3220/`

正式候选必须通过仓库根目录的 `pnpm build` 构建；该命令在编译期固定 `NEXT_PUBLIC_USE_MOCK=false`、`NEXT_PUBLIC_FORMAL_AUTH=true`、`NEXT_PUBLIC_FORMAL_CUSTOMER_VEHICLE=true`。仅在 `next start` 时修改这些公开变量不会改变已经生成的浏览器代码。客户和车辆详情会监听 `wh:formal-session-changed`，确保 HTTP-only 正式会话稍晚到达时重新发起正式读取。

1. 使用超级管理员或前台账号登录。
2. 只创建新的测试客户、测试车辆、未开展业务的测试业务单或草稿检查单。
3. 分别进入 `/customers/{编号}`、`/vehicles/{编号}`、`/orders/business/{id}`、`/orders/inspections/{id}`。
4. 验证删除资格、关联选择、原因、编号确认、返回列表和刷新持久性。
5. 查询 `record_deletion_receipts` 确认回执；查询 `record_deletion_file_tasks` 确认文件任务为 `pending`、`failed` 或 `completed`，失败任务可重试。
6. 不对实施前已存在的业务记录执行删除。

2026-08-27 的 3220 实际验收创建并删除了独立测试客户，确认：删除弹窗可见、预检完成、确认后返回列表、刷新后记录仍不存在、详情接口返回 404。同一请求号的两次并发执行均返回 200 和同一业务结果，数据库只产生 1 条 `record.deleted` 审计。普通 SQL 删除探针被主记录闸门拒绝。测试客户为 0、活动验收会话为 0；只保留不含身份原文的正式删除回执和审计。

最终验证结果：正式后端 110 个测试文件、398 项全部通过；Web 单元测试 995 项全部通过；协作边界 11 项全部通过；删除端到端测试 7 项全部通过；根与 Web 类型检查、正式生产构建及 `git diff --check` 全部通过。
