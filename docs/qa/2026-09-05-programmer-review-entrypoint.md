# 程序员审查入口 · 2026-09-05

## 交付状态

这是候选工作树的审查导航，不是部署批准，也不是已完成结构重构的声明。当前目标的逐项证据和缺口见 [核心路径收敛审计](2026-09-05-core-paths-closure-audit.md)。

- 当前审查目录：`/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime`。
- 当前 HEAD：`8f5fe6f`。当前工作树并不等于该提交；必须审查未提交与新增文件。
- 3220 当前监听 PID92917，cwd 为上述目录的 `apps/web`；浏览器停在 `/login`。不是正式系统目录。
- 本轮没有改产品代码、迁移数据库、删除记录、重启服务或整理提交。既有改动的作者和批次不能仅由工作树差异推断。

## 规模与审查风险

统计 `apps/web/src` 与根 `src` 的 ts/tsx/js/jsx/mjs/cjs/css/sql，排除 test/spec 文件及测试目录，不含依赖、构建与 QA 输出。前端数字包含现存 Mock 实现；不能当成正式运行路径代码量。

| 范围 | 文件 | 行 | 字节 |
| --- | ---: | ---: | ---: |
| 前端 src | 414 | 88,210 | 4,335,224 |
| 根 src 非测试源码 | 191 | 34,776 | 1,338,905 |

`git diff --stat` 当前已跟踪差异为 93 文件、8,869 行新增、1,361 行删除；不包含新增未跟踪文件。不得把此数字冒充完整变更量。

重点大文件：

| 文件（相对项目根） | 行 / 字节 | 审查关注点 |
| --- | ---: | --- |
| apps/web/src/components/orders/formal-business-order-detail.tsx | 1,776 / 162,060 | 多业务区、异步请求、草稿恢复与页面状态集中 |
| apps/web/src/components/orders/formal-inspection-report-detail.tsx | 678 / 87,494 | 内联 JSX 长行；编辑、AI、报告、跟进、附件、历史集中 |
| src/modules/business-order/repair-round-service.ts | 2,474 / 97,585 | 维修轮次、绩效与撤销的事务及审计边界 |
| apps/web/src/lib/api/mock-orders.ts | 9,161 / 432,176 | 旧模拟路径与正式路径的引用边界，不可未经分析整文件删除 |

未跟踪目录中存在 `apps/web/.next-e2e/` 与 `apps/web/.next-pending-quote-verification/`。这些是构建输出，不应混入交付源码审查；本轮仅识别，没有删除。用 `git ls-files --others --exclude-standard` 检查新增源码，不能只看 `git diff`。

## 建议审查顺序

以下是审查分组，不代表已经拆成独立提交；拆提交前需要追溯所有者、依赖与基线，不能对当前树直接全量暂存。

1. **业务规则和数据变更**：`src/db/schema/`、`drizzle/0042` 至 `0051` 与 `drizzle/meta/_journal.json` 的差异；核对迁移顺序、历史兼容、事务、备份恢复和数据回退方案。尚未取得可部署结论。
2. **金额、绩效、交单**：`src/modules/business-order/`、`src/modules/performance/`；分别核对计算、服务、权限、幂等、历史快照。先处理收敛审计列出的整单折扣规范冲突。
3. **检查与删除服务**：`src/modules/inspection-report/`、`src/modules/record-deletion/`、对应根 `src/app/api/`。已有依赖预检不等于依赖可作废；不可因前端想删除而移除服务端保护。
4. **API 与恢复协议**：`apps/web/src/lib/api/`、`apps/web/src/lib/inspection/`、`performance-draft-storage.ts`、`round-deletion-storage.ts`、`record-deletion-recovery.ts`。重点看账号隔离、迟到响应、未知结果、原请求身份和存储失败。
5. **核心界面与打印**：两个详情文件、已拆出的收费/单据/预览组件、CSS Modules、前端及后端 PDF 生成器。以用户双联、语言、JOB、分类汇总、金额单行及各尺寸实页证据验收。
6. **旧入口和 Mock**：由实际 import、路由与运行配置确认是否可达，再决定保留、隔离或移除。文件名带 mock 不能证明未被正式页面调用。

## 可复现检查入口

从候选根目录执行，先检查各测试配置与环境隔离；不要连接现有财务数据库运行写入测试。

```sh
pnpm --dir apps/web test:workspace
pnpm --dir apps/web typecheck
pnpm typecheck
git diff --check
```

上面是从当前 package.json/config 核实的入口，不是本轮全部通过的声明。定向后端 6 文件 93 项的最近执行结果和完整命令在收敛审计中；前端最近 28 文件 279 项的结果属于 15:03 检查点。组件模拟、隔离服务、真实浏览器验收必须分别记录，不能互相替代。

当前服务正在运行，不要为了审查重复启动或迁移；需要另建可抛弃环境时，全部文件、数据库与缓存留在外置卷，并使用不同端口。

## 接手时的真实剩余项

- 恢复正常登录后，补验最新检查报价触控/容器修复的 3220 桌面、iPad、手机实页结果。
- 确定整单折扣规范；确定正式单据/沟通的作废、留痕与已发送副本处理规则，再补依赖解除路线。
- 验证受支持的外置下载目的地及实际最终文件；不自动向客户发送或调用付费 AI。
- 对结构做独立审查；此入口没有消除大组件、多路径和累计差异风险，更不能证明整仓适合部署。

## P0-A 首批结果：核心路径调用链与风险（09-05 自动续接）

本节落实上线总计划的 P0-A，只覆盖业务单、单据、检查结果三条路径；不是全模块审查完成，也不是独立人类审查结论。本轮只读源码，未运行测试、构建或写业务数据库。实际浏览器仍为 `/login`；PID92917 cwd 仍为候选 `apps/web`。目标查询结果为 null，未建立替代目标。

### 正式入口和旧入口分开看

| 路径 | 实际调用链（均为项目相对路径） | 处置建议与证据边界 |
| --- | --- | --- |
| `/orders/business/[id]` | `apps/web/src/app/orders/business/[id]/page.tsx` → `FormalBusinessOrderDetailView` → `lib/api/formal-business-orders.ts` → `/api/formal/business-orders/:id` → 根 `src/app/api/business-orders/[businessOrderId]/route.ts` → `business-order-runtime.ts` 中正式服务/PostgreSQL | 保留正式路由、服务与现有恢复保护；按收费/轮次/绩效/文档等职责重构大详情，不机械拆行数。此路由不是同名旧详情组件 |
| 详情 `tab=documents` | `formal-business-order-documents-workspace.tsx` → document/revisions API → `business-order-document-service.ts` 冻结快照并保存追加版本 PDF → 指定 revision/language 文件 → 预览、下载、系统打印 | 保留版本、幂等和同源文件链路；PDF失败保留快照并有后续生成恢复，不能重构时删掉这个协议 |
| `/orders/business/:id/documents/:documentId/print` | `FormalBusinessOrderDocumentPrintSheet` → 正式 snapshot → HTML → `window.print()` | 旧 HTML 路线仍有页面文件，不读选中 PDF revision；需要旧链接兼容/重定向设计与实页验证，不与正式 PDF 视为同一链路 |
| `/orders/business/:id/print` | `QuickOrderPrintSheet` → `api.quickOrders.detail`/financialStatement → 通用 `client.ts` | 旧 Quick 路线仍存在；Mock 开启时走模拟，关闭时请求旧 `/api/quick-orders/*`。本次未找到该旧 API 对应实现，未实测 URL，不直接宣称当前 404 |
| `/orders/inspections` 与数字 ID 详情 | 路由直接引 Formal 列表/详情 → `formal-inspections.ts` → Web `/api/formal/inspection-reports` 薄包装重导出根 handler → `InspectionReportService` | 保留正式入口、独立报告和追加工作区版本，分离编辑/AI/跟进/文档/历史职责 |
| 列表与 BO 内新建检查 | 两入口使用 `FormalInspectionCreateDialog`，BO传车辆和来源单 → 正式创建 POST | 保留共享入口和客户端恢复；来源关系、服务器防重另见风险 R04 |
| 检查 AI | `formal-inspections.ts` → `/api/ai/chat` → `ai-route-executor.ts` → 供应商请求 | 当前是请求内执行，不是已经完成的持久后台任务；任务恢复/缓存/预算不能因为有加载动画就算通过 |
| 检查报告 PDF | 正式 detail.workspace → `buildFormalInspectionDocument` → 浏览器生成 Blob → 预览/下载/打印共用字节 | 取已加载正式数据，不是未保存草稿；不等于服务端已归档不可变报告文件。打印来源与归档规则需要分别评审 |
| 工作台旧报价导入 | `WorkbenchWorkspace` → `QuickOrderCreateDialog` → `QuoteImportDialog` → `api.inspectionReports.list/detail` | 与正式检查列表不同合同；关闭 Mock 后走旧接口，并无就地正式 DTO 转换。未读取当前配置/运行此入口，不称此刻一定使用模拟数据 |
| 车辆详情检查历史 | `apps/web/src/components/customers/vehicle-detail-page.tsx:119-120` 正式模式返回空历史；343起隐藏旧区域 | 静态确认该路径未接正式检查历史；不能从正式列表已可用外推“车辆能查到检查” |

### 首批风险清单与可验证的下一步

本表的“静态确认”表示代码调用/条件已读到，不代表已在真实账号下复现。下一步测试应在隔离正式环境执行，外部发送用替身，不能调用真实短信或通过真实删除做验证。

| ID / 优先级 | 当前证据与风险 | 下一步回归与处理边界 |
| --- | --- | --- |
| R01 / 高 | `inspection-report-service.ts:540-548,549-579,935-952`：沟通读/写只调用 `requireReportReader`，丢弃返回的维修工班组范围；写入直接按 reportId 找对象。对照 415-427 的报告读取明确带班组过滤。`communications/route.ts:14-37` 直接调用写入，未先验证该报告所属班组 | 用两个班组、两个报告的隔离数据，覆盖跨组直接写/读服务拒绝、同组允许、停用账号拒绝；HTTP越权不得产生沟通或审计业务事实。当前外部 GET 详情还会执行报告读取，不把内部读服务缺口直接说成已证明可通过详情HTTP窃取数据 |
| R02 / 高 | `sms/route.ts:32-54`：报告读取后即调用供应商，再记录沟通；缺少独立发送权限与外部副作用意图/结果查询合同。供应商接受后数据库失败会返回整体错误，有重复发送风险 | 隔离覆盖未授权请求的供应商调用数为0、供应商接受但保存失败、超时结果未知、原请求核对/幂等。owner 当前有 `business_order.collaborate` 权限，不能擅自把所有沟通一刀切为禁用；外部发送资格要明确 |
| R03 / 高 | `formal-inspection-report-detail.tsx:193-209`：所有非空回复都写 `status: confirmed`，`inspection-report-derivation.ts:353-360` 把其派生为闭环；“下周再确认”也会关闭跟进 | 以延期、明确接受、拒绝、仅询问四例补合同和测试；未作决定不能算已确认，保留待跟进人/时间路线。现有测试若保护错误含义需要按用户要求修改，不能为了绿测沿用 |
| R04 / 高 | 检查创建对话框有恢复 attempt.id，但 `formal-inspections.ts:248-285` 发请求未带该身份；服务创建每次生成编号并插入，requestId仅审计 | 隔离同一请求超时后再提交、并发重复、同key不同payload、不同账号；应产生同一结果而非第二报告。先定义服务契约及唯一性事务；客户端不自动重试不等于服务器幂等 |
| R05 / 中高 | `formal-inspections.ts:122-138` 列表缺运行时响应验证；列表页把缺失 items/total 兜底为空。HTTP200仅有账号ID可能显示成没有记录 | 返回不完整/错误类型/错页响应应展示读取失败并可重试，不能清空正确旧数据。补列表合同测试，不只断言请求URL |
| R06 / 中高 | `formal-business-orders.ts:666-675,853-899` 单据生成/修复/版本读不传期限；检查 GET/PATCH 同样无期限；现有期限只用于部分动作 | 永久等待响应头/正文的隔离测试：到期释放操作并保留草稿/原requestId，表述结果未知，允许查询；迟到结果不清新稿、不乱导航。不能仅覆盖fetch reject就称超时闭环完成 |
| R07 / 中高 | 同时存在正式 PDF revision、旧正式 HTML、旧 Quick 三条打印链路 | 以普通双联/长单、中文/英文、R1/R2分别比较入口、版本、字段修订与输出；收据组件仍在旧 HTML 文件中，不能整文件直接删除；用户已验收的正式打印实现优先保持 |
| R08 / 中 | 车辆历史和工作台旧导入未统一到正式检查合同，见上表 | 隔离真实结构数据验证车辆→检查→来源BO往返、工作台创建入口和正式列表一致；错误应可重试，不以空数据代替失败 |

已知但本轮不重复解决：整单折扣冲突、无效依赖作废规则、最新检查容器/触控修复的真实登录后验收、外置最终下载核验，继续见收敛审计。

### 处置优先顺序

1. 人类程序员先审 R01/R02 权限与外部副作用合同，下一实施包写隔离红测，禁止真实发短信验证。
2. R03 的“回复不等于同意”已有用户方向；补延期跟进合同与完整交互，不只改一句提示。
3. R04/R05/R06 统一请求身份、响应验证与等待结果分类，避免继续在各详情组件各补一套。
4. R07/R08 收敛旧入口，保留已确认的打印版本与原始历史；在可登录的隔离正式环境完成三端操作证据。

本批没有将 P0-A 全系统盘点标完成，也没有授权或实施全系统重构。既有测试结果仍按原日期记录；本轮只验证文档链接/格式和源码调用证据。
