# Whole Hearted 正式系统续接入口

**最后更新：** 2026-08-28（Jamaica）\
**正式仓库：** `/Volumes/公司文件/Whole Hearted Car Service 正式系统`

每次继续开发时，按以下顺序读取：

1. `docs/superpowers/specs/2026-08-27-3210-canonical-single-app-design.md`：当前 3210 单体应用设计。
2. `docs/superpowers/specs/2026-08-25-single-formal-repository-rescue-design.md`：正式数据、权限和业务来源顺序。
3. `docs/architecture/FORMAL_SYSTEM_BUSINESS_BASELINE.md`：候选业务基线（未批准），仅用于保留候选条款来源。
4. `docs/acceptance/FORMAL_SYSTEM_END_TO_END_ACCEPTANCE.md`：候选端到端验收清单（未批准），不构成最终验收判定依据。

候选业务和验收材料发生冲突时，以用户明确发言、已批准设计和已批准分模块规格为准。

## 当前目标

以当前 3210 PC 系统为唯一应用界面，把正式服务与 PostgreSQL 能力并入同一个 Next.js 16 进程，形成可以由用户实际操作和复算的单店业务闭环：

```text
客户与车辆
→ Business Order 与维修轮次
→ Inspection Report
→ 收费版本与备注版本
→ 正式交单与绩效事实
→ 逐笔收款与双语 Receipt
→ 逐笔退款与双语退款签收单
→ 取车、挂账与停车
→ 经营概览、日报、月报与人话审计
```

## 当前修复顺序

1. 经营概览、今日/本周/本月/本年统计与目标口径全部读取正式后端。
2. 客户和车辆档案使用正式数据、完整编辑入口、正确归属与自动在场状态。
3. Business Order、收费、备注、维修轮次、收退款和打印以用户明确发言、已批准设计和已批准分模块规格为准形成闭环；候选业务基线材料仅作为待确认的候选输入。
4. Inspection Report 保持车辆中心的独立记录，并可选关联来源 Business Order。
5. 工作台、系统设置、基础字典和历史审计清除剩余临时数据入口。
6. 完成构建、自动测试、浏览器逐项验收和重启持久化验证。

## 续接纪律

- 先确认外置卷已挂载并可写。
- 只在本文件标明的正式仓库继续工作。
- 每完成一项，必须同时更新实现、自动测试和人工验收证据。
- 页面显示、正式接口和数据库事实必须一致；浏览器本地存储只允许保存界面偏好与刷新通知，不保存正式业务记录。
- 每次停止前，将已完成项、正在处理项、验证命令和剩余阻塞更新到本文件。

## 当前状态

- 当前 3210 界面已确定为唯一应用界面；候选版本在隔离工作区和 3220 端口开发与验收。
- 现有 3210、3211 和当前数据库在候选通过前保持不变。
- 已记录候选业务基线与候选端到端验收清单；二者尚未获得业务批准。
- 正在把现有正式接口改为单进程调用，并恢复经营概览与绩效目标计算。
- 3220 候选已新增正式“绩效参数”设置入口：全厂默认提成比例与 CNY→JMD 汇率按月版本化；维修组可按月设置特殊提成比例，并以空比例版本恢复全厂默认。所有版本均为 PostgreSQL 追加事实并写审计。
- 经营概览缺少月度绩效参数时，各维修组卡片直达 `/settings?team=<id>#performance-parameters` 并自动选中对应维修组；绩效页也提供同一入口。
- 2026-08-27 验证：正式后端 96 文件 / 336 测试通过，Web 963 单元测试通过，根与 Web 类型检查通过，生产构建通过；3220 浏览器确认设置入口、四个维修组、空值校验、直达预选和控制台无错误。候选数据库没有写入猜测参数。

## 2026-08-27 客户驾驶证采集交付

- **隔离候选工作区：** `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime`
- **候选分支：** `codex/3210-single-runtime`
- **候选入口：** `http://127.0.0.1:3220`
- **候选 PostgreSQL：** `127.0.0.1:55433`，数据与上传文件均位于候选工作区 `.runtime/`。

已实现并接入正式客户主档：

- 个人客户与公司客户都可在新建流程中选择驾驶证图片、拍摄或上传、识别后人工核对，再随客户事务一次提交。
- 公司证件明确归属主要联系人；公司注册地址和联系人证件地址分别保存、分别展示。
- 手机号、TRN 和驾驶证均为可后补资料；缺失时显示 `待补`，不会伪造完成事实。
- 证件状态固定为 `待补`、`待核验`、`已核验`、`需重新核验`；客户详情支持补录、替换和只读历史。
- 替换证件只追加新版本并封存旧版本；原始图片通过鉴权接口读取，不向页面暴露存储键。
- 超级管理员和前台管理员可写；老板身份保持全局只读。识别服务只返回姓名、出生日期、性别、地址四个安全字段，原始识别响应不进入数据库或审计。

隔离候选验收事实：

- 个人客户 `CUST-202608-0003` 已通过浏览器完成上传、人工核对、建档、受保护原件读取、刷新持久化和证件替换；主档姓名与地址随当前证件同步，旧记录保留为已替换历史。
- 公司客户 `COMP-202608-0002` 与主要联系人 `CUST-202608-0004` 已验证归属关系；公司地址为 `1 Company Avenue, Kingston`，联系人证件地址为 `77 Personal Lane, Spanish Town`，两者未互相覆盖。
- 候选数据库共有 3 条驾驶证记录和 3 份驾驶证原件；3 份文件的实际字节数与数据库 SHA-256 全部匹配。替换审计 1 条、核验审计 3 条，审计中未发现 Base64、原始 OCR 或供应商响应。
- 桌面和 430px 移动视口均无横向溢出；验收截图位于 `apps/web/docs/screenshots/formal-customer-license-*-20260827.png`。
- 最终回归：后端 101 文件 / 361 测试通过，Web 978/978 通过，协作边界 11/11 通过，根与 Web 类型检查通过，生产构建通过；lint 为 0 错误、1 条既有测试警告。

安全回退点：`backups/candidate-runtime-pre-license-20260827T1845-JM.tar.gz`，SHA-256 为 `b058e3e138b278d053bc2d6257ebee5342ac268f7a3b771210e010d50ff8d98d`。该备份只包含隔离候选运行时，不属于 Git 交付。

## 2026-08-27 正式记录删除交付

- **隔离候选工作区：** `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime`
- **候选分支：** `codex/3210-single-runtime`
- **候选入口：** `http://127.0.0.1:3220`
- **完整规格与验收：** `docs/superpowers/specs/2026-08-27-record-deletion-design.md`、`docs/acceptance/record-deletion.md`

客户档案、车辆档案、Business Order 和检查单详情已接入统一“删除”操作。超级管理员与前台可执行；其他角色不可见且接口拒绝。删除前由正式后端重新计算关联图，主记录逐项确认，从属记录按计数展示；存在真实业务事实时整体阻断，不做部分删除。

数据库主记录和原有 append-only 从属记录均要求同一事务中的请求编号、精确表名和精确行键授权。浏览器重试沿用同一个请求号，服务端使用事务级 advisory lock 串行化同号并发请求。当前车辆与历史车主关系都参与删除图。成功与拒绝分别写 `record.deleted` 和 `record.deletion_rejected`；自由文本补充说明不进入不可变审计，也不保存手机号、TRN、车牌、VIN、地址或证件内容。

3220 真实验收已完成页面删除、刷新持久性、详情 404、两次同号并发只执行一次、普通 SQL 删除被拒绝。验收测试客户与活动临时会话均为 0。最终回归：正式后端 110 文件 / 398 测试、Web 995/995、协作边界 11/11、删除 E2E 7/7、根与 Web 类型检查及正式生产构建全部通过。

## 2026-08-28 GitHub 与数据灾备

- **私有远程仓库：** `https://github.com/vicechancellor9999/whole-hearted-car-service`
- **稳定代码分支：** `codex/3210-single-runtime`，稳定提交 `f44cd1e`
- **稳定标签：** `checkpoint-2026-08-27-record-deletion`
- **AI 在建备份分支：** `codex/ai-service-wip-20260827`，首个在建快照提交 `6d7a01c`
- **加密数据灾备：** GitHub Release `data-backup-20260828T000230_EST`
- **本地加密包：** `/Volumes/公司文件/Whole Hearted Car Service 远程灾备/20260828T000230_EST/whole-hearted-runtime-20260828T000230_EST.tar.gz.enc`
- **加密包 SHA-256：** `f638ec8e7cc9d70ea31c73965b6bdab3af154ff0e76000e936b19437d12eb75e`
- **恢复密钥：** macOS 钥匙串服务 `whole-hearted-data-backup`，账号 `vicechancellor9999`；密钥不得写入仓库、文档或聊天。

数据灾备包含隔离候选的 PostgreSQL 物理快照、上传附件、AI 服务运行设置、根环境文件和 Web 环境文件。备份前数据库已正常停机；加密包已解密到独立目录，并在 `55434` 端口独立启动。恢复库与原库均为 46 张公共表、283 行，逐表数量指纹一致；随后恢复库已关闭，`3220/login` 返回 HTTP 200。验证材料位于同一 Release 的 `manifest.json`、`restore-verification.json` 和 `restored-database-summary.json`。

恢复时先下载 Release 的全部附件并核对 `.sha256`，从钥匙串读取密钥，只恢复到新的明确目录和备用端口；验证通过前禁止覆盖当前 `.runtime/postgresql`。原候选运行方式保持：

```bash
cd '/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime'
pnpm start:candidate
```

后续提交纪律：每个功能使用独立 `codex/` 分支；实现、自动测试和浏览器验收完成后再提交并推送。每天结束、开始高风险改动前以及每个可验收节点都要推送。`.env.local`、`.runtime/`、`backups/`、构建缓存、测试结果和真实密钥不得进入 Git；运行数据继续通过加密 Release 单独灾备。

## 2026-08-28 Business Order 详情工作区优化

- **实现提交：** `c3e1dc4 feat: refine business order workspaces`
- **候选入口：** `http://127.0.0.1:3220/orders/business/1`
- **批准规格：** `docs/superpowers/specs/2026-08-28-business-order-detail-refinement-design.md`

已完成：

- 收款和退款改为可关闭的居中浮窗；收费项目的“编辑/保存”固定在同一标题操作位置，并明确显示“新增工时”“新增配件”“新增其他费用”“新增备注”。
- 三联工作区增加页面内正式单据预览、浏览器系统打印、新窗口打开，以及客户签字、服务照片、财务凭证和其他资料的 Business Order 附件中心；附件支持选择、拖拽和粘贴。
- 历史标签页改为紧凑时间线；字段前后变化默认收起，可按条展开。
- 沟通标签页改为评论流；保留 @、作者编辑和已编辑标记，并支持多张照片、粘贴照片和纯照片评论。照片只保存一次，再关联到评论和业务附件。
- 新增正式 PostgreSQL 附件表、鉴权读取接口、25 MB 文件边界和审计；删除误建业务单时同步清理评论、提及、附件关系和孤儿物理文件任务。

运行与保护事实：

- 启动器已成功应用 `0032_business_order_attachments` 和 `0033_record_deletion_collaboration_files`；候选库当前有 34 条 Drizzle 迁移，附件表和评论表均存在。
- 迁移前备份：`backups/pre-business-order-refinement-20260828T030838_EST.tar.gz`，SHA-256 `098a07fa902511b47971866e31b0614d8eb604a89c7b95eecbc2a92ef19575a3`。
- 验证：正式后端 115 文件 / 411 测试通过；Web 1005/1005 通过；本轮重点前端 32/32、后端附件与删除 15/15；根与 Web 类型检查、修改文件 lint、正式生产构建全部通过。
- 3220 已用生产构建重启，`/login` 返回 HTTP 200；未登录访问业务单和附件接口按预期跳转登录。
- 应用内浏览器控制通道在本轮验收时返回空列表，因此尚未记录人工视觉点击结论。下一次浏览器通道恢复后，优先验收四个标签、收退款浮窗、iframe 系统打印、附件上传/读取和评论照片发布。

## 2026-08-28 全系统平衡双主题交付

- **实现分支：** `codex/ai-service-wip-20260827`
- **候选入口：** `http://127.0.0.1:3220`
- **批准规格：** `docs/superpowers/specs/2026-08-28-balanced-dual-theme-design.md`
- **实现计划与验收记录：** `docs/superpowers/plans/2026-08-28-balanced-dual-theme.md`

主题入口固定为三种模式：`跟随系统`、`柔和亮色`、`舒适暗色`。新用户默认跟随系统；用户的模式选择保存在 `wh_theme_mode`，当前解析结果保存在 `wh_theme`。旧版 `wh_theme` 与 `wh_theme_source` 会在首次加载时迁移，不需要手工清理浏览器设置。跟随系统模式会监听操作系统主题变化，并在页面首次绘制前设置根节点主题，避免先亮后暗的闪烁。

应用颜色由 `apps/web/src/app/theme-tokens.css` 的语义角色统一管理。页面画布、侧栏、主卡片、嵌套区域、边界、文字、强调色和状态色使用同一层级逻辑；共享导航、页头、弹窗、卡片、表单、删除确认和 Business Order 四个工作区均已接入。历史页面通过应用壳范围内的语义兼容映射继承同一调色逻辑。三联正式单据及打印页继续使用白纸黑字的独立文档色板，浏览器打印和存 PDF 不受应用主题影响。

本轮实现提交顺序：

1. `c6e6968 feat: define system theme modes`
2. `8a4ffa1 feat: add three-mode theme control`
3. `1d46487 feat: add balanced semantic theme tokens`
4. `79d76fa feat: migrate shared chrome to semantic theme`
5. `d0adb4e feat: theme business order workspace`
6. `398f96f feat: balance legacy product surfaces`
7. `3b60282 test: align business order theme expectations`

交付验证：Web 全量单元测试 `1011/1011` 通过；主题与打印 E2E `12/12` 通过；主题与 Business Order 联合 E2E `18/18` 通过；Web 类型检查和生产构建通过；修改范围 lint 为 0 错误。生产构建已在 3220 重启，Next.js 监听进程工作目录为候选仓库 `apps/web`，PostgreSQL 继续监听 55433 并使用候选 `.runtime/postgresql`，`/login` 返回 HTTP 200。亮暗登录页截图位于 `apps/web/docs/screenshots/theme-20260828/`。
