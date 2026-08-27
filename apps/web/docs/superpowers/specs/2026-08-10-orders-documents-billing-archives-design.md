# 工单、检查结果、收费与档案重构设计

> 本规格取代 `2026-08-09-orders-operations-center-design.md` 中“混合所有单据”“检查报告与报价合并为一个对象”“派检均衡与实时负载等大并列”等旧设计。实施必须以本规格为准。
>
> 2026-08-20 修订：Inspection Report、Quotation、客户通知、客户回复及 IR→BO 边界由 `2026-08-20-inspection-report-redesign-design.md` 取代；本规格继续约束 Invoice、退款与跨文件共同规则。
>
> 2026-08-22 修订：本规格的退款算式、收费来源、停车更正与正式文件原则继续有效；独立收付款事实、正式退款单、跨月工时退款对冲、v2 迁移/恢复、会话栅栏、公开逐笔账目及消费者归属由 `2026-08-22-independent-payment-refund-records-design.md` 接管。历史事实不因该修订被合并、改号或补造。

## 1. 设计目标

本轮重构解决五个问题：

1. 业务单、Inspection Report、Quotation 和 Invoice 不再作为同一种目录行混合；
2. 前台可以快速判断今日普通车辆首次派检是否均衡，以及四组当前真实负载；
3. Inspection Report 同时满足内部事实留存、客户沟通和专业 PDF；当前不基于 IR→BO 文本备注推导项目实施率；
4. Business Order 内完整呈现施工与 Invoice，但施工状态、付款状态和车辆离店状态互不覆盖；
5. 客户档案、车辆档案、停车费、收费与交车各自拥有清晰职责，同时引用同一份业务记录。

系统继续沿用现有蓝灰视觉、明暗主题、圆角、阴影和响应式基础，不推倒当前视觉体系。

## 2. 导航与页面归属

### 2.1 最终导航

> 2026-08-10 修订（产品决定）：调度总览迁入`业务工作台`（独立顶级导航），工单管理组只保留业务单与检查结果。IR 闭环到客户回复为止；转不转 Business Order 由建单侧负责。该早期决定中“BO 侧保留来源引用”和“§8 继续统计实施率”的内容已被 2026-08-20 最新口径废止：新流程只在 BO 普通备注写可编辑、可删除的 IR 编号文本，不建立结构化来源关系，也不据此计算实施率。写 IR 遇到配件价格未知时，向配件报价大厅发起协助申请。

```text
业务工作台（含调度总览：派检均衡、班组负载、流程数量、IR 跟进强提醒）

工单管理
  业务单｜Business Order
  检查结果｜Inspection Report

客户与车辆管理
  客户档案
  车辆档案

收付款与交车
停车费
```

### 2.2 页面边界

- `调度总览`：只展示派检均衡、班组负载和流程数量，不放混合单据表。
- `业务单｜Business Order`：只查询业务单；Invoice 在业务单详情内部。
- `检查结果｜Inspection Report`：只查询检查结果；详情内展示关联 Quotation。
- `客户档案`：从付款主体和长期关系角度查看车辆、文件、欠款、挂账资格和沟通。
- `车辆档案`：从车辆历史角度查看检查、报价、施工、照片、里程、Invoice 和停车事实。
- `收付款与交车`：跨业务单汇总付款、余额、签账、放车和取车操作，不复制 Invoice。
- `停车费`：拥有通知、宽限、计费、减免和调整规则；其他页面只读取结果。

Quotation 不设置独立顶级导航。它在 Inspection Report 详情、客户档案和车辆档案中作为同一份关联文件出现。

## 3. 业务对象与关系

### 3.1 Business Order

Business Order 是客户已同意实施的收费业务主记录，包含：

- 客户、车辆和普通业务备注；
- 已同意的服务项目；
- 工时、配件和其他费用收费行；
- 派组、接单、施工、阻滞、照片、维修工回传；
- 回交前台、前台复核、正式交单、取车；
- 内部 Invoice、付款记录、放车安排和审计记录。

检查、诊断、保养、维修、钣喷属于服务类型；它们的人工收费统一归入工时，不新增顶级收费分类。

### 3.2 Invoice

Invoice 是 Business Order 内部的版本化财务文件，不是独立施工流程。它必须有自己的编号、版本、金额快照和签收记录。

Invoice 的状态必须拆成两条轴：

```text
paymentStatus
  unpaid           未付款
  partially_paid   部分支付／未付清
  paid             已付清

settlementArrangement
  normal             正常结算
  credit             挂账
  special_agreement  特殊协商
```

界面可组合显示，例如 `未付清 · 挂账`。不得把“挂账”与“未付款／未付清／已付清”做成互斥四选一。

施工完成、Invoice 结清和车辆离店是三条独立事实。车辆经授权离店时，未付 Invoice 仍保持未付或部分支付，不得伪装为已付清。

### 3.3 Inspection Report

Inspection Report 的当前定义、页面、客户闭环、永久照片、Quotation 和 IR→BO 边界全部以 `2026-08-20-inspection-report-redesign-design.md` 为准。本规格只保留跨文件共同边界：Inspection Report 是车辆检查事实，永久进入车辆档案，不与 Business Order 混排；旧内部阶段、AI 草稿展示、逐项客户决定和结构化来源关系均不再作为实施要求。

### 3.4 Quotation

Quotation 只在 Inspection Report 详情中持续编辑，不设置顶级导航。V1、V2……只是每次成功生成客户文件的序号，不是锁定报价内容的版本实体。勾选当前报价行创建 Business Order 时只复制当下客户、车辆、收费行和逐项优惠；新 BO 备注预填 IR 编号普通文本，双方不建立结构化来源关系，后续互不反写。完整规则以 `2026-08-20-inspection-report-redesign-design.md` 第 2.3、10.3 和 12 节为准。

## 4. 单据编号

- Business Order：`KGN-WH-2026080919422`。
- Inspection Report：`KGN-WH-IR-2026080919422`。
- Quotation：`KGN-WH-QT-2026080919422`，版本另记 `V1`、`V2`、`V3`。
- Invoice：`KGN-WH-INV-2026080919422`，版本另记。
- `KGN` 来自门店资料；Kingston 当前使用 `KGN`，未来分店使用其配置代码。
- `WH` 代表 Whole Hearted。
- `20260809` 为 `America/Jamaica` 业务日。
- 末尾五位为服务端生成并原子递增的唯一序号；浏览器不得扫描现有单据后自行生成。

## 5. 调度总览

### 5.1 今日普通车辆首次派检

这一信息必须压缩成一条横向胶囊，不能再与实时负载做成两个等大卡片。

胶囊要求：

- 左侧为车间一组，右侧为车间二组；
- 分段宽度体现当日首次派检偏向；
- 同时显示两组精确车辆数、合计和差值；
- 只统计今日普通车辆第一次派检查；
- 同一车辆重复检查、检查转 Business Order、后续改组均不重复计数；
- 工程机械和钣金喷漆等特殊分流不进入普通车辆均摊；
- 不显示“公平／不公平”的主观结论，不自动派单，也不强制 50/50。

10/10 只代表数量均衡。若二组当前施工负载高，前台可以把更多新检查任务派给一组。

### 5.2 班组当前实时负载

实时负载是调度总览的主区域，位于派检胶囊下方并占满可用宽度。四组分别显示：

- 待接检查；
- 检查中；
- 待接维修；
- 维修施工中；
- 等配件／其他阻滞；
- 已回交待前台。

负载按当前有效任务计算，不按报告数量、报价版本或目录行数计算。没有标准工时和标准产能时，不显示虚构百分比。

### 5.3 流程数量

流程数量按实体分组，不混成一张表：

- 检查结果客户闭环：尚未通知客户、已通知并等待回复、客户已回复并闭环；闭环结果另分有意向／没意向；
- 业务流程：待派、待接、施工中、等配件、回交待前台、待正式交单、已交单待取车、已取车；
- 财务与交车流程：未付款、部分支付、已付清、挂账余额、特殊协商、待取车。

点击数字进入对应页面和筛选条件。

## 6. Inspection Report 页面

本节旧页面结构与状态已全部废止，不得用于实现或验收。Inspection Report 列表、详情顺序、三段客户闭环、通知渠道、客户回复、照片、Quotation、正式文件及创建 Business Order 的当前规则，统一见 `2026-08-20-inspection-report-redesign-design.md`。

## 7. 客户 PDF 与预览

### 7.1 客户版内容

客户版 Inspection Report PDF 包含：

- 公司与门店资料；
- 客户、车辆、检查日期和文件编号；
- 工时项目报价、客户所需配件清单，以及存在时的其他费用；
- 工时／配件每行原单价、项目优惠、折后单价和折后小计；其他费用最终一口价；包含三类收费的总计；
- 配件询价说明与人工可编辑的整体总备注；
- 文件生成序号、Jamaica 生成时间、客户确认签名和日期。

客户版不得包含：

- 维修工自然语言原文；
- 维修工个人署名；
- AI 草稿；
- 内部审核、退回和修改记录；
- 内部 Note 或不必要的员工信息。
- 现场照片和内部高折扣笔迹。

### 7.2 三种固定语言版本

每次正式文件生成都由同一次操作读取的当前已保存业务数据产生。此规则适用于 Inspection Report、Quotation、Business Order、Invoice、挂账签账、特殊协商放车文件和停车费减免凭证：

- 中文 PDF；
- English PDF；
- 中英对照 PDF。

三份文件共享业务数据、金额、版本和面向客户的确认／签署事实，不允许分别编辑。这里不包括第 10.1 节内部高折扣笔迹；该笔迹不得进入任何客户文件。原始自然语言永久保留，不被翻译内容覆盖。

### 7.3 PDF 预览

点击任何正式文件后先打开系统内 PDF 预览，不自动下载。预览必须使用最终生成并归档的 PDF，不得以相似 HTML 页面冒充。

预览支持：

- 中文／English／中英对照切换；
- 页面缩略图、翻页、缩放和适应宽度；
- 下载、打印和发送；
- 显示文件编号、版本、生成时间和语言；
- 预览、下载、打印和发送使用完全相同的文件版本。

### 7.4 项目级优惠展示

所有面向客户且显示价格的 Quotation 与 Invoice 正式文件，都必须把工时／配件优惠落到具体收费项目并显示同一组金额事实：原单价、每单位项目优惠、折后单价和折后小计。正式文件不再显示一笔独立于收费行之外、会被再次扣减的工时优惠、配件优惠或整单优惠。

为避免 A4 表格过宽，同一价格单元格可以依次显示“原单价／每单位优惠 × 数量 = 本项优惠合计／折后单价”，折后小计保持独立右对齐金额列；优惠为 0 时显示“—”。数量大于 1 时，本项优惠合计必须与汇总总优惠可核对。中文、English 和中英对照文件使用相同数值，预览、下载、打印和发送内容必须一致，任何金额均不得显示小数。

存在固定总额其他费用时，Quotation、Business Order 与 Invoice 客户文件增加独立 `OTHER CHARGES／其他费用` 分区，只显示项目说明和最终一口价 `amountJmd`，不显示数量、原价、优惠、折后价或“—”伪优惠；金额完整进入单据总计。停车费只在 Business Order／Invoice 客户文件中保持独立停车分区，不得混入其他费用；IR Quotation 不含停车投影。没有相应记录时不输出空分区。

如需向客户说明退款口径，只使用与分类金额一致的说明：“工时与配件优惠已逐项列示；退款按实际 Invoice 中对应项目的折后单价及实际可退数量计算。其他费用没有折扣，适用退款时按 Invoice 所列最终一口价处理。”English 为：“Labor and parts discounts are shown by item. Any applicable refund is calculated using the discounted unit price and refundable quantity shown on the actual Invoice. Other charges are not discounted; where a refund applies, it uses the final fixed amount shown on the Invoice.”不得再出现“退款时先扣回整单折扣”或跨项目追偿的旧文案。

## 8. 项目采纳率与实施率

本节旧自动统计方案废止。当前 IR→BO 只复制当下收费内容，并在 BO 普通备注写入可编辑、可删除的 IR 编号文本；系统不保存结构化来源关系，因此不得从该文本推导项目采纳率、实施率、班组归因或绩效。将来如需此类指标，必须重新取得产品批准并设计独立的明确事实来源，不能恢复已否定的 `SourceProjectLink`。

## 9. Business Order 页面与详情

### 9.1 列表

只显示 Business Order，不显示 Inspection Report 行。保留当前已认可的搜索、组合筛选、状态数量和响应式列表结构。

### 9.2 详情

详情至少包含：

- 客户、车辆和单据身份；
- 普通业务备注（可以包含“来自检查结果：{IR 编号}”文本，但不解析成数据关系）；
- 已同意服务项目；
- 工时、配件、其他费用；
- 班组、维修工和当前施工状态；
- 维修工照片和回传记录；
- 等配件、阻滞和沟通；
- 回交、前台复核、正式交单和取车事实；
- Invoice、付款、挂账和特殊协商；
- 改组、金额调整和完整审计。

业务单成立后、前台正式交单前允许人工改组。正式交单后不得普通改组，只能走带原因和权限的更正流程。

## 10. 收费分类

顶级收费分类固定为：

```text
labor         工时
parts         配件
other_service 其他费用
```

`other_service` 必须使用判别式定价模式，不能把固定一口价与停车投影混成同一种可编辑金额：

- `pricingMode = fixed_total`：面向员工和客户显示“其他费用”，canonical `code` 只允许 `towing` 拖车、`offsite_service` 外派服务或 `other` 其他已说明费用；
- `pricingMode = parking_projection`：canonical `code` 固定为 `parking_overtime`，必须带稳定 `parkingCaseId`，并只读投影停车模块某一明确 `sourceRevision`／`asOf` 的最终净额。

固定总额其他费用的 canonical 字段至少包含稳定收费行 ID、类别、定价模式、`code`、中英文名称、中英文备注和唯一权威金额 `amountJmd`。它没有数量、单位、待报价、原单价、优惠或折后单价；同一业务存在两笔费用时建立两行。若现有 Quick BO DTO 暂时需要单位价形状，只能只读派生 `quantity = 1`、`unit = '项'`、`unitEn = 'item'`、`unitPriceJmd = amountJmd`、`unitDiscountJmd = 0`，不得与 `amountJmd` 双重持久化。

`amountJmd` 沿用现有含 15% GCT 的最终成交金额口径，Quotation、BO 与 Invoice 不得再次加税。

固定总额其他费用没有折扣：任何非零优惠载荷都必须拒绝，不能参加自动均摊或工时 20%／配件 12.5% 门槛，签字也不能授权打折。其金额变化叫“一口价修改”，必须留痕，但不生成折扣事实。停车投影的天数、减免和净额只能在停车模块修改，BO／Invoice 不得二次改价或折扣。

新单据的工时／配件项目优惠是收费行字段，不是独立金额调整；其他费用没有优惠字段。减免、冲销和四舍五入仍是金额调整，不伪装成收费项目。旧 Invoice 的 `discount` adjustment 仅为历史兼容只读保留，新 Invoice 不得再创建该 adjustment。营业收入统计必须单独支持其他费用和停车费并保持总额守恒，不能把它们偷偷并入配件或互相混算。

每个 Invoice 版本必须满足：工时折后净额、配件折后净额、固定总额其他费用、停车费只读投影与合法金额调整的合计，等于该版本 Invoice 总额；任何分摊和退款也必须保持金额守恒。

### 10.1 项目级优惠、整单均摊与退款

新 Quotation、Business Order 和 Invoice 的工时与配件收费行统一使用：

```text
unitPriceJmd = 优惠前原单价
unitDiscountJmd = 每单位项目优惠
finalUnitPriceJmd = unitPriceJmd - unitDiscountJmd
grossLineJmd = unitPriceJmd × quantity
lineDiscountJmd = unitDiscountJmd × quantity
finalLineJmd = finalUnitPriceJmd × quantity
```

`finalUnitPriceJmd`、`grossLineJmd`、`lineDiscountJmd` 与 `finalLineJmd` 都是派生值，不作为可独立修改的第二套权威金额。原单价、项目优惠、折后单价和所有小计均为非负 JMD 安全整数，不得出现小数；`0 <= unitDiscountJmd <= unitPriceJmd`。人工逐项优惠可以产生任意整数折后单价；只有自动均摊器产出的折后单价必须为 JMD 50 的整数倍，即尾数为 `00` 或 `50`。待报价行优惠固定为 0，并排除在优惠与金额合计之外。

分类与总计使用同一安全整数函数：

```text
laborNetJmd = Σ labor.finalLineJmd
partsNetJmd = Σ 已报价 parts.finalLineJmd
otherFeeTotalJmd = Σ fixed_total.amountJmd
parkingTotalJmd = Σ parking_projection.amountJmd
totalDiscountJmd = Σ labor.lineDiscountJmd + Σ parts.lineDiscountJmd
chargeSubtotalJmd = laborNetJmd + partsNetJmd + otherFeeTotalJmd + parkingTotalJmd
invoiceTotalJmd = chargeSubtotalJmd + 合法非折扣金额调整
```

Quotation 不含停车投影，因此当前报价合计为 `laborNetJmd + partsNetJmd + otherFeeTotalJmd`；BO、Invoice 和账单分别展示其他费用与停车费后再合并总计。停车模块给出的 `parkingTotalJmd` 已含该模块完成的减免，Invoice 不得再次扣减。

“均摊整单优惠”只是一次性计算与填写工具，不是订单字段或 Invoice adjustment。参与集合只能包含已报价的 `labor`／`parts` 行；`fixed_total`、`parking_projection` 或其他计价模式即使由客户端提交参与 ID，服务端也必须拒绝。目标优惠表示所有参与行应用后的优惠合计，不是在既有优惠上再追加；未参与行保留原优惠且不计入本次目标。目标必须是非负 JMD 整数且不超过参与行优惠前小计合计。工具按参与行的优惠前小计占比，尽量使各行折扣率接近，同时只产出满足折后单价 50 倍数约束的逐项优惠；数量为 `q` 的收费行每次可达变化量为 `q × 50`。实际参与行优惠合计不得超过目标；先最小化 `目标优惠 - 实际优惠合计`，再以实际优惠合计 `A`、参与行原价小计合计 `G` 最小化 `Σ(lineDiscountJmd × G - A × grossLineJmd)²`，最后按稳定收费行 ID 打破同分；全部计算使用安全整数或 BigInt，不得用浮点舍入决定财务结果。受数量步长限制不能精确命中时，页面同时显示参与行目标、参与行实际优惠、未分摊差额、整单应用前优惠和整单应用后优惠；差额不写入单据，也不得生成隐藏尾差或另一笔整单优惠。若参与行原价与目标组合根本不存在任何同时满足“折后单价为 50 倍数、非负且实际优惠不超过目标”的结果，禁用“应用”并提示调整目标或参与行，当前优惠完全不变。应用后逐项优惠仍可人工修改。

高折扣签字按工时与配件分开判断：`工时项目优惠合计 × 100 > 工时原价合计 × 20` 时触发工时门槛，`已报价配件项目优惠合计 × 1000 > 已报价配件原价合计 × 125` 时触发配件门槛。严格超过 20%／12.5% 才触发，等于阈值不触发；待报价配件不参与。某类别已报价原价合计为 0 时，该类别折扣率按 0 处理且不触发签字，不执行除以 0。自动均摊与人工修改使用相同门槛；任一类别超线，本次优惠保存需要一份非空笔迹，两类同时超线仍只签一次。任何会改变工时／配件门槛分子或分母的写入，都必须按写入后的完整工时／配件收费行重新计算门槛，包括修改其原单价、每单位优惠、数量、类别或待报价状态，以及新增、删除、重新分类工时／配件收费行；即使没有直接改优惠字段，也不得绕过签字判断。只新增、删除或修改固定其他费用或停车投影、且同一事务没有改变工时／配件门槛分子或分母时，不触发也不消费高折扣笔迹。

该签字只是系统内部的一次性形式留痕：任何人都可以在签名板留下任意非空笔迹，系统不识别、选择或保存审批人 ID／姓名，也不得宣称验证了实际签字人。签字留痕只保存当前操作账号、原始笔迹和签字时间，并挂在本次优惠保存审计事件上；优惠审计事件保存当次逐项优惠、工时／配件原价、优惠合计和折扣率。笔迹只能被一次成功保存消费，只同意该次写入后的价格与优惠；失败不消费，同一 `mutationId` 网络重试不重复消费，后续任何会改变门槛分子或分母的写入仍超线时必须重新画。正式文件生成、预览和发送读取已保存价格，不重复签字，内部笔迹不得进入客户文件。Quotation、Business Order 与 Invoice 创建或修改收费记录时都执行这一规则。

已签 Quotation 原样创建 BO，BO 仍按自己的完整工时／配件行重新计算并在超线时取得一份新笔迹；已签 BO 原样创建或启用新的 Invoice 收费快照，Invoice 仍重新计算并取得自己的新笔迹。每个目标单据使用全新的 `mutationId`、操作账号、笔迹、签字时间和审计事件，绝不复制或复用来源单据的任何签字数据；目标单据内工时与配件同时超线仍只签一次。新建或启用金额未变的 Invoice 版本仍是新的收费快照写入并重新签；同一已保存版本的预览、下载、打印和发送只是读取，不重新签。

BO→Invoice 写入失败时，BO 及其签字不变，不产生 Invoice 版本或消费 Invoice 笔迹；Invoice 已提交但响应丢失时，同一 Invoice `mutationId` 与同一标准化载荷返回原版本，不增加版本或消费次数。同一 `mutationId` 只能重试相同收费行、金额、类别与来源 revision；任一载荷变化都属于新操作并使用新 ID，超线时重新画。

Invoice 必须把开票时每个工时／配件行的原单价、每单位项目优惠、折后单价和数量，以及每个其他费用行的固定 `code`／`amountJmd` 保存为该版本的金额快照。停车投影另保存 `code = parking_overtime`、`parkingCaseId`、`sourceRevision`、`asOf` 与当时 `amountJmd`；每个 Invoice 版本内同一 `parkingCaseId` 最多一行。系统另维护唯一活动占用 `activeParkingClaim[parkingCaseId] = { logicalInvoiceId, financiallyEffectiveVersionId, chargeLineId }`：BO 上的当前投影只作信息展示、不占用；首个含该停车案件的财务生效 Invoice 必须在版本启用事务内以 compare-and-set 从“不存在”原子取得占用；同一逻辑 Invoice 启用新版本时原子转移占用；另一逻辑 Invoice 在旧占用完成作废／更正前不得再次计费。任何 claim 取得或转移失败都必须让整个版本启用失败，不得留下已生效金额或半占用。交车聚合对全部财务生效 Invoice 与 `unbilled` 项按 `parkingCaseId` 去重，已被活动 Invoice 承载的 BO／当前停车投影只显示来源，不再次计入金额。

停车案件以后继续计费或发生减免，不得静默改写已生效 Invoice 版本，只能按下述停车更正事务生成新的 Invoice 版本。同一逻辑 Invoice 的收费行使用稳定 `chargeLineId`；新版本中同一 lineage 的行继续使用该 ID，删除后重建不得取得新 ID 来恢复已退款额度，真正不同的新行才取得新 ID。每张逻辑 Invoice 同时只有一个 `financiallyEffectiveVersionId` 可以发起退款，旧版本只读；累计退款额度按逻辑 Invoice + 稳定收费行 ID 跨版本归集，生成 V2 不得让 V1 已退项目重新获得可退额度。创建或启用版本时，高折扣门槛校验、Invoice 新笔迹消费、金额快照、版本审计和 `financiallyEffectiveVersionId` 更新必须原子完成。

退款必须从财务生效版本选择具体稳定收费行。工时／配件选择正整数退款数量；固定总额其他费用当前只允许整行一次退款，不提供任意部分金额或小数数量；停车投影不进入普通收费行退款入口，停车更正由停车模块发起。先计算收费行冲减金额：

```text
refundableLineAmountJmd = labor/parts 的 finalLineJmd；fixed_total 其他费用的 amountJmd
requestedLineCreditJmd = labor/parts: refundQuantity × finalUnitPriceJmd；fixed_total: amountJmd（整行）
remainingLineCreditJmd = max(0, refundableLineAmountJmd - 该稳定收费行迁移后历次 receivableReductionJmd - legacyLineRefundOccupancyJmd)
itemBackedRefundCeilingJmd = 财务生效版本可退款工时／配件折后小计与 fixed_total 其他费用的合计（不含 parking_projection）
ordinaryRefundableLineIds = 该逻辑 Invoice 历代版本全部 labor／parts／fixed_total 稳定收费行 lineage ID 集合（含已从当前版本删除的旧行，排除 parking_projection）
remainingInvoiceCreditJmd = max(0, itemBackedRefundCeilingJmd - ordinaryRefundableLineIds 对应的迁移后 receivableReductionJmd - ordinaryRefundableLineIds 对应的 legacyLineRefundOccupancyJmd - legacyUnassignedRefundOccupancyJmd)
receivableBeforeRefundJmd = 财务生效版本在本次操作前、已计入既往冲减与合法调整但尚未扣除收款的净应收
laborPartsReceivableReductionJmd = min(requestedLineCreditJmd, remainingLineCreditJmd, remainingInvoiceCreditJmd, receivableBeforeRefundJmd)
fixedTotalReceivableReductionJmd = amountJmd（仅在下述整行前置条件全部通过后）
netPaidBeforeJmd = 累计收款 - 全部历史及迁移后 cashRefundJmd
outstandingBeforeJmd = max(0, receivableBeforeRefundJmd - netPaidBeforeJmd)
cashRefundJmd = max(0, receivableReductionJmd - outstandingBeforeJmd)
```

`receivableReductionJmd` 是本次撤销的收费价值；工时／配件取上式 `laborPartsReceivableReductionJmd`。固定总额其他费用不允许被 `min(...)` 静默截成部分退款：执行前必须确认该稳定行从未有 `receivableReductionJmd` 或任何 legacy occupancy，且 `remainingLineCreditJmd`、`remainingInvoiceCreditJmd`、`receivableBeforeRefundJmd` 都不小于完整 `amountJmd`；全部通过才令 `receivableReductionJmd = amountJmd`，任一条件不满足就拒绝普通退款并要求走明确财务更正。一旦该 fixed-total lineage 已有任何退款或 occupancy，后续普通版本不得改写其 `amountJmd`、恢复额度或再次退款。

`cashRefundJmd` 才是实际退给客户的现金。未付部分只冲减应收，不能把尚未收到的钱退成现金；已全额支付时两者相等，部分支付时现金退款不得超过客户净已付余额。工时／配件退款数量是正整数；同一稳定收费行累计退款数量不得超过财务生效版本的该行数量，累计 `receivableReductionJmd` 不得超过该行尚未冲减的折后小计。启用新版本时，工时／配件稳定收费行的新数量不得小于其已退款数量／占用事实；fixed-total lineage 始终服从上一段的完整冻结规则，有任何退款或 occupancy 后不得在普通版本改写金额。实际包含多个可独立退还的固定收费时必须在正式开票前拆成多行。不满足时拒绝启用并要求走明确的财务更正，不能通过换版本重置退款事实。已明确归属于停车投影的历史冲减或 occupancy 只进入停车更正账，不扣减普通工时／配件／其他费用的 `remainingInvoiceCreditJmd`；无法归属的历史 occupancy 仍按上式占用整个普通退款上限，直至核对完成。

停车更正不进入普通收费行退款入口。以当前财务生效停车快照为 `oldParkingAmountJmd`、停车模块待生效 revision 的最终净额为 `newParkingAmountJmd`；新财务生效 Invoice 版本中包含 `newParkingAmountJmd` 的完整 `invoiceTotalJmd` 是更正后唯一应收事实，`parkingDeltaJmd = newParkingAmountJmd - oldParkingAmountJmd` 只进入审计，不得再作为第二笔 adjustment、应收增加或应收冲减重复入账。先按新版本及既往合法冲减计算 `receivableAfterCorrectionJmd`，再使用整张逻辑 Invoice 的 `netPaidBeforeJmd = 累计收款 - 全部历史及迁移后 cashRefundJmd`；本次现金退款为 `parkingCashRefundJmd = min(max(0, -parkingDeltaJmd), max(0, netPaidBeforeJmd - receivableAfterCorrectionJmd))`。因此尚未收取的停车金额只随新版本降低应收，只有更正后出现真实净超付时才退现金，且现金退款不超过本次停车降额。

停车模块必须用稳定 `mutationId` 在同一事务中校验 source revision、生成并启用新 Invoice 版本、取得或转移 `activeParkingClaim`、写停车更正审计及必要现金退款；不能只换快照或另写一笔重复应收差额。无收款时同一事务的现金退款为 0。同一 `mutationId` 与标准化载荷重试返回原结果；来源 revision 或金额变化必须使用新 ID，并发更正不得重复改版本、取得 claim 或退款。

新单据中，任何会降低工时／配件实际成交价的优惠都必须在 Invoice 正式生效前落到具体工时／配件收费行；同一行中不同实物需要不同优惠时拆成多行。其他费用只允许在开票前直接修改并审计最终一口价，不得把降价建模成折扣；停车费减免只在停车模块完成。`write_off` 是内部应收处理，`rounding` 是非项目金额调整，两者不增加收费行可退款额度，也不能变成现金退款。旧 Invoice 仍含全单 waiver／adjustment 时，所有收费行累计 `receivableReductionJmd` 还必须受该 Invoice 剩余应收总额上限约束，避免全退各行后超过该 Invoice 实际净额。

退款不重新分配其他项目优惠，也不读取后来修改的 Quotation 或 BO。工时／配件退款不可变保存逻辑 Invoice ID、版本 ID、稳定收费行 ID、退款数量、原单价／每单位优惠／折后单价快照；固定总额其他费用退款保存同一组标识、整行退款标记和 `amountJmd` 快照。两类都保存 `receivableReductionJmd`、`cashRefundJmd`、经办人、时间、方式和事实原因；财务生效版本校验、收费行剩余可退额度、应收冲减、退款事件和现金流水必须原子提交，并发退款不得超退或重复退款。

旧工时优惠、配件优惠或 `discount` adjustment 只在能够精确保持旧应收金额时，使用同一均摊规则转换成逐项优惠。因自动均摊步长与数量条件无法精确转换时，原 Invoice 继续以可见的只读 `legacyOrderDiscountJmd` 保持旧应收并标记待人工重新分摊；受影响逻辑 Invoice 不得生成新的财务生效版本，直至前台逐行人工定价并明确确认调整后的新总额，随后新版本只保存逐项优惠并清除活动 legacy adjustment。既有整数单价原样保留，不因自动均摊的 JMD 50 规则改价。迁移时不得补造审批人、签字时间或笔迹；历史优惠原样保全，迁移后第一次修改优惠时重新计算门槛，仍超线才要求本次操作的新笔迹。

旧 `other_service` 按 canonical `code` 与来源拆分迁移：`towing`、`offsite_service`、`other` 在无优惠且金额可精确计算时转为 `fixed_total.amountJmd = 旧数量 × 旧单价`；存在旧优惠时，只有在净应收严格不变时才把旧净额折叠为固定总额，旧数量、单位、原价和优惠全部留在只读迁移历史，已生效历史 Invoice 始终原样保留。`parking_overtime` 只有在 `parkingCaseId`、对应 `sourceRevision`／`asOf` 和旧行净额都能与停车案件事实核对一致时，才转为只读 `parking_projection`；每个无冲突的旧财务生效停车投影都必须在迁移事务中原子 seed 对应 `activeParkingClaim`。来源缺失或歧义时保留 `legacy_parking_unlinked`，来源存在但版本或金额不一致时保留 `legacy_parking_mismatch`。同一旧 Invoice 版本存在重复 `parkingCaseId`，多个旧财务生效 Invoice 同时占用同一案件，或 seed claim 发生碰撞时，相关重复行保留为 `legacy_parking_duplicate`；迁移不得自动挑选、合并或丢弃其中任何一行。三种异常都只读待核对，绝不自动变成普通其他费用或活动停车投影。

迁移前后每个版本都必须满足 `旧 other_service 实际净额 = fixed_total 合计 + parking_projection 合计 + unresolvedLegacyOtherServiceJmd`；`legacy_parking_unlinked`、`legacy_parking_mismatch` 与 `legacy_parking_duplicate` 的金额都进入 unresolved，只有全部完成核对时最后一项才为 0。只读历史页必须显示 unresolved 小计，但它不得进入新 Quotation 或新财务写入。总额、已付、已退、余额、ID、顺序、时间与审计保持不变；无法精确守恒时保留 legacy 并阻止异常行产生新财务版本或退款，不凭描述猜测。`superadmin` 或 `frontdesk_admin` 可在停车历史核对入口把异常行绑定到可核对一致且未被活动占用的 `parkingCaseId + sourceRevision`，在重复组中明确选择唯一活动投影并让其余行继续只读，或确认某行是无法绑定的历史事实；选择活动投影时必须在同一事务 compare-and-set seed `activeParkingClaim`，碰撞则保持 duplicate 且不部分写。每个结论都只追加操作账号、时间、原始金额、证据引用和备注审计，不改写旧金额。未被选为活动投影或确认无法绑定的行继续作为只读 unresolved 历史，不得伪装成 fixed-total 其他费用。

历史 `amountJmd` 退款按原现金事实只读保留，绝不迁成新的 `receivableReductionJmd` 或新的现金流水。能够通过既有 `itemId` 和 Invoice 版本唯一定位稳定收费行时，同时记录等额的 `legacyLineRefundOccupancyJmd`，只占用该行与该逻辑 Invoice 未来可退额度，不改变历史应收、余额或现金。只有旧记录本身存在明确退款数量，且该数量与金额、原折后单价及原数量相互校验通过时，才记录 `legacyRefundQuantity`；不得仅凭金额可整除就猜数量，否则标记 `quantityUnknown` 并阻止该行新的数量退款，直至人工完成归类。无法唯一定位收费行时保存为 `legacyUnassignedRefundOccupancyJmd`，并阻止该逻辑 Invoice 发起新的行级退款，直到有权限的前台把旧退款归属到一个或多个收费行，或将其确认为只占用 Invoice 总体退款上限的不可归属历史事实；任何归类都只追加审计，不改写旧现金金额。每条旧退款分配到各稳定行的 occupancy 与未归属 occupancy 之和必须严格等于原 `amountJmd`。两类 occupancy 都只参与剩余可退额度校验，不进入应收、余额或现金公式；不得因无法归属就把旧退款忽略，从而让同一金额再次退款。

## 11. 客户档案与车辆档案

### 11.1 客户档案

客户／付款主体拥有：

- 基本资料、联系方式和名下车辆；
- Inspection Report；
- Quotation；
- Business Order；
- Invoice、已付、余额和应收；
- 挂账资格、管理员签名、撤销和重新开通历史；
- 每张挂账 Invoice 的客户签收；
- 联系、通知和跟进记录。

欠款归客户／付款主体，不归车辆。

### 11.2 车辆档案

车辆档案展示：

- 车辆资料、里程和当前客户关系；
- Inspection Report；
- Quotation；
- Business Order；
- 检查、保养和维修项目历史；
- 报告级照片、报价项目和维修历史；不得从可编辑的 IR 编号普通备注推导项目实施情况；
- Invoice 历史关联；
- 停车、通知、计费和取车事实。

车辆档案可以查看 Invoice，但不得把车辆当作债务主体。

两个档案页面引用同一份文件和 ID，不复制业务记录。

## 12. 客户挂账资格与签名

挂账资格属于客户／付款主体，覆盖其名下适用车辆，不按车辆分别开通。

开通流程：

1. 前台在客户档案打开挂账资格表单；
2. 现场把签名框交给管理员；
3. 管理员现场确认并签名；
4. 前台提交，挂账资格生效；
5. 不创建发送给管理员账户的待审批任务。

签名记录绑定客户、管理员身份、前台操作人、时间和当时条款。

前台可以撤销未来挂账资格，但不得删除历史、冲掉已有欠款或失效已有签账。撤销后重新开通必须取得新的管理员现场签名。

每一张实际挂账的 Invoice 仍需客户针对该 Invoice 编号、版本、余额、日期和语言版本签字确认。管理员的客户级资格签名不能替代每张 Invoice 的客户签账。

## 13. 收付款、交车与特殊协商

收付款与交车页面汇总：

- 客户、车辆和 Business Order；
- Invoice 总额、已付和余额；
- 付款状态与结算安排；
- 客户签账；
- 是否允许离店、实际离店和取车；
- 当前需要处理的人和下一步。

前台正式交单前，必须展示该车辆本次离店涉及的全部 Business Order 和财务生效 Invoice，不能只检查当前打开的一张单据；结算总额以财务生效 Invoice 为准，尚未开票的 BO 金额另列为 `unbilled`，不得与其后生成的 Invoice 重复相加。其他费用或停车投影已经包含在 Invoice 收费行时同样只按该 Invoice 快照计一次；只有尚未开票的当前停车费或其他费用才作为 `unbilled` 单独列示。

车辆可以通过以下路径离店：

- Invoice 已付清；
- 客户挂账资格有效，且客户已签当次未付 Invoice；
- 特殊协商放车。

特殊协商放车必须形成不可删除的授权记录，至少包含余额、原因、预计付款日期、前台经办人、授权人、客户确认和时间。设计默认由前台登记、管理员现场确认，防止特殊协商成为绕过挂账资格的无痕入口。

## 14. 停车费

### 14.1 计费日历

- 首次有效通知客户可取车的日期记为 `D`；
- `D+1` 为唯一一天宽限期；
- `D+2` 开始按 JMD 2,500／自然日计费；
- 取车当天不收费；
- 不排除周末或节假日，因为门店每天营业；
- 门店临时不开门时，通过减免处理，不修改统一日历公式；
- 后续提醒不重置首次通知日期。

示例：

```text
8月10日  首次通知
8月11日  宽限期
8月12日  第一个计费日
8月13日  取车，取车日不计
应收停车费：1天 × JMD 2,500 = JMD 2,500
```

### 14.2 减免

前台可以：

- 全额免除；
- 按整数天自定义减免；
- 记录关系维护、门店停业或其他真实原因。

系统必须分别保留：

- 原始计费天数和金额；
- 减免天数和金额；
- 减免原因；
- 经办人和时间；
- 管理员签名（如需要）；
- 最终应付天数和金额。

权限按同一停车费案件的累计实际减免金额判断：

- 累计实际减免金额不超过 JMD 50,000：前台可自行处理；
- 累计实际减免金额超过 JMD 50,000：必须取得管理员现场签名；
- 不得通过拆分多次减免规避 JMD 50,000 权限上限。

例如原停车费为 JMD 60,000，只减免1天 JMD 2,500，前台可自行处理，不需要管理员签名。

停车费模块拥有计算和减免事实。Business Order 可只读显示停车案件当前 `parkingCaseId + sourceRevision/asOf + amountJmd` 投影但不产生财务占用；财务生效 Invoice 保存开票时快照，并通过 `activeParkingClaim` 保证同一案件只能由一个活动 Invoice 计费，新版本只原子转移该占用。停车源事实以后变化不得静默改旧 Invoice，必须走第 10.1 节停车更正事务。Invoice 不重复计算停车天数，也不得把停车投影当作普通其他费用修改、折扣或退款；已开票停车快照与尚未开票停车费按 `parkingCaseId` 去重显示。

## 15. 系统语言与文件语言

- 系统界面提供中文／English 切换；
- 切换入口隐藏在员工头像菜单中，不占用主导航；
- 选择按员工保存；
- 界面语言不改变原始业务数据和已归档文件；
- 正式客户文件始终同时提供中文、English、中英对照三种 PDF。

## 16. 权限与审计

- 有业务查看权限的人直接查看，不增加额外签名步骤；
- 维修工提交自然语言检查结果时记录其身份署名；
- 前台直接编辑并确认 Inspection Report 当前内容；人工审查、补充、校对与生成是连续操作，不设置“待前台审核／已批准”业务状态；
- AI 只整理，不取得发布、改价、批准放车或修改财务事实的权限；
- 正式文件生成、报价修改、客户回复、创建 Business Order 操作、改组、付款、签账、挂账资格、特殊放车、停车减免均记录操作人和时间；创建 BO 的审计不建立 IR↔BO 来源关系；
- 高折扣笔迹不记录审批人身份，只记录本目标单据收费写入的操作账号、原始笔迹和签字时间；Quotation 保存、BO 创建、Invoice 创建／启用分别在自己的事务中完成门槛校验、目标写入、目标审计与一次性笔迹消费。失败不消费，同一幂等重试不重复消费，跨单据绝不复用；
- 每笔退款必须审计逻辑 Invoice、财务生效版本、稳定收费行和类别；工时／配件另记退款数量、原单价、每单位优惠和折后单价，固定总额其他费用另记整行退款与 `amountJmd` 快照；两类都记录应收冲减和实际现金退款，不得脱离收费行任意录入无法核对的退款金额。停车更正不走此入口；
- 停车更正另审计 `parkingCaseId`、旧／新 source revision 与 `amountJmd`、旧／新 Invoice 版本、应收增加或冲减、现金退款、`activeParkingClaim` 转移、操作账号、时间和稳定 `mutationId`；
- 原始检查、旧报价、旧 Invoice、签名、减免前金额和既有欠款不得被静默覆盖或删除。

## 17. 响应式与交互

- 桌面端调度总览按“首次派检胶囊 → 全宽实时负载 → 流程数量”排列；
- 430px 端保持同一顺序纵向排列；
- Business Order 与 Inspection Report 使用各自列表，不混合实体行；
- 表格可在自身容器横向滚动，页面根容器不得横向溢出；
- 弹窗支持键盘焦点圈定、Escape 关闭和关闭后返回触发控件；
- 动效保持轻量，并兼容 `prefers-reduced-motion`；
- PDF 预览在桌面和手机均可翻页、缩放、下载和关闭。

## 18. 验收标准

1. 导航层级与第2节完全一致，Invoice 和 Quotation 不占独立顶级导航。
2. 调度总览的首次派检为单条胶囊，实时负载是下方全宽主区域。
3. Business Order 列表不存在 Inspection Report 行；Inspection Report 列表不存在 Business Order 行。
4. Inspection Report 页面、三段客户闭环和正式文件严格使用 2026-08-20 重做规格；客户 PDF 不泄露维修工原文、AI 处理过程或内部审计。
5. Quotation 始终可编辑；V1、V2……只表示成功生成文件次数，不锁定项目或建立历史报价实体。
6. 从 IR 创建 BO 只复制当下勾选收费行：工时／配件复制当前单位价与逐项优惠，其他费用复制当前固定总额；同时写普通来源备注。双方不建立结构化关系且后续互不反写。
7. 系统不从 IR 编号文本推导项目采纳率、实施率或绩效，不恢复 `SourceProjectLink`。
8. Business Order 详情包含 Invoice，但施工、付款和离店状态可以独立组合。
9. 客户档案和车辆档案均可查看关联 IR、Quotation、Business Order 和 Invoice；欠款只归客户／付款主体。
10. 客户挂账资格由管理员现场一次签名开通；每张实际挂账 Invoice 由客户另行签账。
11. 8月10日通知、8月13日取车的停车费为 JMD 2,500。
12. 同一停车案件累计减免不超过 JMD 50,000 时前台可处理；超过时要求管理员现场签名。
13. 原停车费 JMD 60,000、只减免 JMD 2,500 时不要求管理员签名。
14. PDF 在系统内先预览，并可切换中文、English 和中英对照；预览与下载／发送为同一版本。
15. 系统语言切换位于员工头像菜单，不改变正式文件版本。
16. 桌面与430px均无页面根横向溢出，主要操作可用键盘完成。
17. Quotation 与 Invoice 的中文、English 和中英对照客户文件对工时／配件逐项显示原单价、项目优惠、折后单价和折后小计；存在其他费用时另列 OTHER CHARGES／其他费用及最终一口价，不显示虚构优惠；停车费只在 BO／Invoice 客户文件保持独立分区，IR Quotation 不含停车投影。三种语言、预览、下载、打印与发送的金额一致且不含小数。
18. 整单优惠均摊只写入逐项优惠，自动结果的折后单价为 JMD 50 的倍数；人工逐项优惠允许任意非负 JMD 整数。实际优惠合计严格等于各行优惠之和，不能精确达到自动目标时显示未分摊差额，不生成隐藏整单优惠，也不重复扣减。
19. 一次、连续或并发退款均绑定逻辑 Invoice 的稳定收费行，只能从财务生效版本发起；工时／配件严格按折后单价与退款数量计算，固定总额其他费用只有在该行无任何既往退款／occupancy 且完整 `amountJmd` 可一次冲减时才能整行退款，任何上限不足都拒绝而不静默部分退款；停车投影不进入普通退款入口。V1 已退额度不会因生成 V2 重置，累计冲减不超过该行可退金额。
20. 未付款 Invoice 退款只冲减应收且现金退款为 0；部分付款只退超过冲减后应收的净已付金额；已付清时现金退款等于本次应收冲减。旧整类优惠、`discount` adjustment 和旧退款迁移后历史应收、现金金额与余额不变；旧退款以独立 occupancy 占用未来可退额度而不冒充新冲减，未归属旧退款在完成归类前阻止新的行级退款。
21. 工时优惠严格超过工时原价 20% 或已报价配件优惠严格超过配件原价 12.5% 时，本目标单据收费写入要求一份非空笔迹；两类同时超线只签一次，等于阈值不签。高折扣 Quotation 原样创建 BO、BO 原样创建或启用 Invoice 收费快照时分别重新签，形成各自独立留痕；同 ID 重试不重复建单、建版本或消费。笔迹只记录目标操作账号、原始内容和时间，成功使用一次后失效；客户文件不显示内部笔迹。
22. 固定总额其他费用只有 `amountJmd` 一个权威金额，无数量、待报价或优惠；非零折扣载荷被前后端拒绝，自动均摊、20%／12.5% 门槛和高折扣签字均不受其影响。其金额进入 Quotation、BO、Invoice 和账单总计。
23. 共享 totals 分别返回工时净额、配件净额、其他费用合计和停车投影合计；其他费用与停车费分别显示，Invoice grand total 才合并。停车净额只能来自停车模块；每版同一案件最多一行，`activeParkingClaim` 保证跨活动 Invoice 唯一，新版本原子转移占用，交车汇总不把已开票金额与当前投影重复相加。已收款后停车净额下降时，同一幂等事务生成新版本、冲减应收并按净已付计算现金退款。
24. 旧 `other_service` 按固定总额其他费用、停车投影与 unresolved legacy 三部分守恒拆分；来源缺失、歧义、金额不匹配或重复案件时不冒充活动停车投影或普通其他费用。迁移前后每个版本总额、已付、已退、余额、ID、顺序与审计不变，异常行通过带审计的停车历史核对入口处理，在完成前不产生新财务事实。

## 19. 明确不做

- 不把 Inspection Report、Quotation、Business Order 和 Invoice 合成同一种对象。
- 不把所有单据混成一张表。
- 不自动派单或强制一组、二组绝对 50/50。
- 不在没有结构化来源事实时计算或展示项目采纳率、项目实施率。
- 不把挂账与付款状态做成一个互斥枚举。
- 不维护三份可独立编辑的中文、英文和中英对照文件。
- 不在客户 PDF 中暴露维修工原文、个人署名、AI 草稿或内部审核记录。
- 不让前台通过拆分停车减免绕过 JMD 50,000 权限上限。
- 不因车辆已离店而自动把 Invoice 改成已付清。
