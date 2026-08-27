# 移交给 Codex：Invoice / Quotation 单据文件与打印排版（2026-08-20）

> 交接范围：业务单（BO）Invoice 客户文件、检查结果（IR）Quotation、四联 A4 打印排版。
> 相关提交：9ec0ee9（本轮排版/PDF 修复，已验证通过）。

## 口径与仓库规则（动手前必读）

- 原型 mock-only：全部数据在浏览器 localStorage（wh_* 键），无真实后端。权威口径见 HANDOVER.md 与 docs/development-spec-alignment-2026-08-17.md。
- 单据边界（老板定）：Quotation 只活在 IR 内；Invoice 只活在 BO 内；BO 四联 A4 打印 = 中文客户联 / 英文客户联 / 维修工联（无价格+检查结果+签字栏）/ 中英参照联（留档）。
- 仓库规则（AGENTS.md）：只在 main 分支、单工作区；提交前必须过 typecheck + test:collaboration；改页面行为必须同步 e2e 并全量通过；离开前必须提交，不许留 typecheck 挂掉的工作树。

## 现状（截至 9ec0ee9，已实测验证）

1. **BO Invoice 客户文件**：BO 详情页「Invoice 客户文件」区，zh/en/bilingual 三语先预览后下载。
   - 链路：客户端 fetch /api/pdf/invoice，携带 localStorage 的 wh_* 快照 → 服务端 Chromium 渲染 /orders/business/[id]/print?copy=…&pdf=1 → page.pdf(A4, margin 0)。
   - 关键坑（不要再踩）：服务端 Chromium 是全新浏览器，不带会话会把打印页渲染成「无权读取客户与车辆完整目录」错误页。必须：① 客户端带 wh_* 存储快照、路由 addInitScript 回放；② page.pdf 前 waitForSelector('[data-testid^="quick-print-sheet-"]')。
   - 路由已复用同一个 headless Chromium（每次冷启动 1–3 秒是预览/下载超时的根源）。
2. **四联打印**：src/components/orders/quick-order-print.tsx。收费表 5 列（#/项目/数量/单价/小计）。正确结构：合计行 = 空 td colSpan=2 + 标签 td colSpan=2（跨数量+单价，右对齐）+ 金额 td（落在小计列）；分区标题 td colSpan = itemCols + (showPrices ? 3 : 1)。此前合计行整体左偏一列（标签压数量列、金额压单价列、小计列空置）已修。
3. **IR Quotation PDF**：src/lib/orders/ir-pdf.ts（pdf-lib，客户端生成，字体 public/fonts/NotoSansSC-Regular-wh.ttf）。报价表列：# / 项目（含备注行）/ 类别 / 数量·单位 / 单价 / 金额；待报价行单价列写「待报价」、金额列写「—」。检查发现按语言渲染：en 用 findingEn（缺省兜底 findingZh）、bilingual 中英双行；下一步待定（nextStep）以警示色打印。此前英文版印中文、无单价列、残留版本号 V2，均已修。
4. **停车费发票**：src/app/parking/[caseId]/invoice/page.tsx，独立页面，表格结构正确，未动。

## 未完成 / 需要接手的问题

1. **【待办】英文联里班组名与维修工名仍是中文**：
   - 班组名来源 src/lib/teams/team-dictionary.ts（TeamDefinition 只有中文 name，无 nameEn）；维修工名是 QuickOrder.mechanicName（中文）。en/bilingual 副本目前直接显示中文。
   - 选项 A：TeamDefinition 加 nameEn 字段（设置页班组改名 UI 同步双语）；QuickOrder 加 mechanicNameEn（派单/接单入口补录）。选项 B：老板提供英文名单后做内置映射。老板尚未给英文名单——需要先向老板要。
2. **【注意】e2e 假绿教训**：不要用「画布深色像素数 > 阈值」断言 PDF 正确——错误页上全是字也会通过。要么用 pdfjs 提取 PDF 文本断言（tests/unit/ir-pdf.spec.ts 有现成 extractText 模板），要么断言打印页 DOM 几何（tests/e2e/orders.spec.ts 四联打印用例有现成合计列对齐断言）。
3. **【注意】e2e flake**：/api/pdf/invoice 的预览/下载用例曾在并发场景超时（dev server 同时被多个 worker 打满）。复跑验证时不要同时跑别的重负载脚本。
4. **【背景】HANDOVER.md「已知遗留」**：第 3 项班组成员名单待老板提供；performance-detail 工资保存 e2e 为已知 flake（重跑即过）。

## 关键文件

- BO 四联打印版：src/components/orders/quick-order-print.tsx
- Invoice PDF 路由：src/app/api/pdf/invoice/route.ts
- Invoice 前端区：src/components/orders/quick-invoice-pdf-section.tsx
- IR/Quotation PDF 生成：src/lib/orders/ir-pdf.ts、src/lib/orders/pdf-shared.ts（共享 Painter/字体/品牌头）、src/components/orders/ir-pdf-section.tsx
- 报价面板（IR 内）：src/components/orders/quotation-panel.tsx
- 停车费发票：src/app/parking/[caseId]/invoice/page.tsx
- 测试：tests/unit/ir-pdf.spec.ts、tests/e2e/orders.spec.ts、tests/e2e/inspection-reports.spec.ts

## 验证命令

```bash
pnpm run typecheck
pnpm run test:collaboration
pnpm exec playwright test --config=playwright.unit.config.ts
E2E_BASE_URL=http://127.0.0.1:3210 E2E_REUSE_SERVER=1 pnpm exec playwright test tests/e2e/orders.spec.ts tests/e2e/inspection-reports.spec.ts
```

dev server：pnpm exec next dev -p 3210（固定 3210；起服前先清 .next；同一 worktree 禁双 dev）。

## 演示锚点

- BO 详情（含 Invoice 客户文件区）：/orders/business/qbo-0001
- 四联打印：/orders/business/qbo-0001/print?copy=zh | en | technician | office
- IR 详情（含 Quotation 与客户文件 PDF）：/orders/inspections/inspection-report-demo-01
- 停车费发票：/parking → 案件详情 → 收款开票
