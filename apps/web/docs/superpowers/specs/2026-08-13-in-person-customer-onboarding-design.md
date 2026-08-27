# 现场新建客户：手机号查重、OTP 与驾驶证辅助提取设计

> 状态：产品负责人已于 2026-08-13 确认业务顺序与页面方向。本文修订
> `2026-08-12-customer-profile-evidence-business-history-design.md` 中“验证可在创建后补”及“任意新上传图片不做辅助提取”的旧规定；冲突时以本文的新建客户流程为准。
>
> 2026-08-14 修订：删除浏览器本机 Tesseract、固定驾驶证模板和 ROI 解析路线，改为供应商中立的
> `LicenseExtractionClient`。当前纯 Mock 演示只返回明确标注的模拟 AI 结果；未来真实能力必须由本系统
> 同源 API 代理外部 AI，浏览器不得持有供应商密钥或直接调用供应商接口。
>
> 2026-08-14 企业联系人修订：企业唯一主要联系人同样提供驾驶证留存与现场核对流程，但资料缺失不阻止建档。驾驶证主体、
> 四项快照、历史兼容和详情页补录规则以
> `2026-08-14-organization-primary-contact-license-design.md` 为准；企业地址不得被联系人证件地址覆盖。
>
> 2026-08-14 非阻断与唯一性修订：本系统不以业务资料完整度阻止操作。手机号可空；一旦填写则必须跨客户唯一。
> OTP 未验证、驾驶证或四项资料待补时均允许建档，并如实形成缺口、提醒和审计。冲突时以
> `../decisions/2026-08-14-record-remind-never-block-business.md` 为准。

## 1. 目标与确认结论

新建客户不是先建立空档案，再去补 OTP 和驾驶证。前台现场登记的固定顺序是：

```text
输入主要号码（可留空）
  → 已填写时查询该号码是否已被其他客户使用
  → 冲突时打开现有客户或修改／清空号码
  → 发送并尝试完成 OTP
  → 上传或拍摄驾驶证正面
  → 选择 AI 辅助提取四字段，或由员工对照原件手动填写四字段
  → 员工核对到场本人、驾驶证原件和四项资料
  → 确认姓名对应音译及其他相似候选
  → 保存当前客户事实，并同时记录已完成验证、待补项、提醒和审计
```

以上是推荐的现场顺序，不是资料完整度闸门。员工可在手机号为空、OTP 未通过、驾驶证或四项资料待补时继续建档；系统必须显示缺项摘要，并把当前状态如实记录为待验证／待补。已填写手机号若属于另一客户则必须修改或清空，不能制造第二个号码所有者。

页面采用产品负责人确认的大幅“新建客户”工作区方向，但按业务先后重排为清晰步骤。页面不包含客户标签，也不在创建客户时建立首辆车关系。

## 2. 范围与路线

### 2.1 本轮包含

- 个人和企业客户的主要号码均可留空；已填写时先检查跨客户唯一性，通过后才可发送 OTP；
- 个人客户及企业主要联系人均可选择“驾驶证 AI 辅助提取”或“驾驶证资料手动填写”；两种方式都必须保留驾驶证证据并由员工现场核对；
- 当前纯 Mock 演示通过供应商中立接口返回四项模拟 AI 结果，并在界面清楚标注“模拟 AI 辅助结果（仅演示）”；
- 设计上为未来真实提取预留本系统同源 API 代理边界，浏览器不接触供应商密钥；
- 员工现场明确确认本人、原件和资料后，KYC 在创建时即为已核验，不进入“待人工核验”；
- 企业本身不作为驾驶证主体；唯一主要联系人使用同一驾驶证留存与现场核对流程，缺失时记录待补而不阻止建档；
- 最终一次原子写入客户、已有验证证据、验证缺口、提醒、审计和幂等回执；
- 原客户详情页保留创建后重新 OTP、重新 KYC 和调取证据的能力。

### 2.2 本轮不包含

- 真实短信网关、真实后端、数据库、对象存储或真实外部 AI／视觉服务接入；
- 驾驶证 PDF、HEIC、WebP 或背面辅助提取；
- 从驾驶证提取 TRN、类别、号码、签发／到期日、签发地点、签名或头像特征；
- 客户标签、首车关系、多联系人、自动创建车辆；
- 刷新页面后恢复未完成的登记草稿；
- 把 AI 辅助提取成功当作“已核验本人”。

“纯 Mock”继续有效：当前证件辅助提取不得发送图片到外部服务，也不发送到本系统服务端，只通过 Mock
adapter 返回确定性的模拟四字段结果。未来接入真实 AI 时，浏览器只调用本系统同源 API，由服务端代理供应商；
浏览器不得保存供应商密钥、供应商 endpoint 或供应商原始响应。OTP 使用现有固定演示验证码，接口形态保持可替换为真实服务。

## 3. 页面与员工操作

### 3.1 页面结构

新建按钮打开大尺寸工作区，桌面为宽对话框，430 px 为单列全屏式可滚动工作区：

1. 页头：`新建客户`、当前步骤、关闭按钮；
2. 客户类型：个人／企业；
3. 第一步卡片：主要号码查重与 OTP；
4. 第二步卡片：个人显示客户驾驶证，企业显示主要联系人驾驶证；两者均可 AI 辅助或手动登记；
5. 第三步卡片：正式资料和姓名音译确认；
6. 底部固定操作区：取消、创建客户档案。

后续步骤始终可见。未完成前一步时用人话显示提醒，但不以业务缺项永久禁用主要操作。最终保存前展示缺项摘要并允许员工继续。不向普通员工显示 token、revision、AI confidence、供应商信息、API 路由或内部状态名。

### 3.2 手机号唯一性与 OTP

- 主要号码不是创建必填项；留空时跳过 OTP，并记录“手机号待补／OTP 不适用”；
- 已填写号码先规范为 E.164；点击“查询号码”后，精确比较所有现有客户的主要电话、备用电话和 WhatsApp；
- 活跃、停用和黑名单客户都参与查重；
- 命中其他客户时显示已有客户的姓名、客户编号、号码所在字段及“打开客户档案”，不签发可创建 token；员工必须修改、清空或打开现有档案；
- 同一客户内部的主要号码、备用号码和 WhatsApp 可以复用同一号码；唯一性只禁止号码跨客户拥有；
- 号码未被其他客户占用时可发送 OTP；员工也可暂不验证并继续保存；
- OTP 通过后显示“已验证”。更换号码会使旧 OTP 和依赖该号码的确认变为失效／待重新验证，但不会阻止保存当前档案；
- 最终 preview 和 create 前 store 都再次检查主要／备用／WhatsApp；若出现跨客户冲突，返回稳定冲突并保留输入，不能写入第二个所有者。

姓名、Email 和企业名称相似只进入候选提醒。员工可以打开已有档案核对，也可以明确继续创建；手机号精确占用属于唯一性冲突，不是可绕过的相似候选。

### 3.3 驾驶证 AI 辅助提取

- 个人客户与企业主要联系人均显示；企业文案必须明确证件主体为“主要联系人”；
- 接受相机拍摄或 JPEG／PNG 正面照片；初版明确不支持 PDF；
- 选择图片后先显示预览、旋转和裁卡校正；
- 辅助提取只预填：姓名、出生日期、性别、地址；当前 Mock 结果必须清楚显示为“模拟 AI 辅助结果（仅演示）”；
- 四项均可由员工校正，不可靠字段留空并标记“请人工填写”，不得显示猜测文本；
- 员工必须勾选“已核对到场本人及驾驶证原件，以上四项与原件一致”；
- 图片或四项任一内容改变，旧人工确认、姓名音译确认和最终预览立即失效；
- 员工完成确认后，KYC 在最终客户记录中直接保存为已核验，并保留驾驶证证据；不再显示“待人工核验”。

### 3.4 手动登记

手动登记与 OTP 状态分别记录。OTP 待验证时仍可继续填写或保存，系统显示后续补验证提醒。

- 企业联系人使用手动登记时建议上传驾驶证并现场核对；未提供时仍可创建并标记“主要联系人驾驶证待补”；
- 企业客户创建后，详情页显示“主要联系人驾驶证”；缺少有效证据时计入“验证待补”并提供补录操作；
- “手动”是不用 AI 辅助提取、由员工对照驾驶证原件填写四项，不是无证件创建客户；
- 个人客户未上传驾驶证或尚未现场核对时仍可创建，状态为“驾驶证待补／待核验”；
- 辅助提取失败时，员工可对照同一张驾驶证证据人工填写四项并完成核对；提取失败本身不阻止登记；
- 个人客户无法提供驾驶证时允许先建档并生成补件提醒；其他身份证件暂不进入驾驶证提取流程，但可以作为备注事实留存。

### 3.5 姓名

页面始终只有一个可编辑的姓名来源栏。驾驶证辅助提取出的英文姓名进入该栏；下方显示只读的中文对应音译，并要求员工明确确认。

- 中文输入继续使用离线拼音；
- 英文命中完整姓名词典时显示规范中文音译；
- 英文未命中安全词典时显示“已提取英文姓名，但当前离线音译库不支持”，不得猜中文，也不得静默创建；
- 本轮不增加可任意编辑、互相独立的第二姓名栏。

### 3.6 其他正式资料

保留主要号码、备用号码、WhatsApp、Email、首选联系渠道、语言、TRN 和客户状态等现有有意义字段。驾驶证只负责四项预填，绝不从其他区域推断这些字段。

页面不出现 `loyal`、`morning-pickup` 等标签，也不出现“首辆车身份关系”。车辆应在客户创建后从车辆流程独立登记和关联。

## 4. 驾驶证辅助提取技术设计

### 4.1 技术选型原则

证件提取不是客户领域模型的一部分，也不绑定某个 AI 供应商。施工时按以下顺序选择能力：

1. 先复用仓库和运行环境已经具备的能力；现有能力足够时不得新增依赖；
2. 确需引入工具时，优先选择成熟、持续维护、许可证清楚的开源方案；
3. 如果没有合适的现有能力或成熟开源工具，必须先向产品负责人说明缺口、候选方案、数据边界和成本，获得确认后再引入新依赖或外部供应商；
4. UI、状态机和客户存储只能依赖本文的供应商中立接口，不得导入供应商 SDK 类型、模型名称、endpoint 或原始响应结构。

本轮纯 Mock 演示不新增真实 AI 依赖，不调用外部服务，也不把证件图片发送到本系统服务端。旧的浏览器本机
Tesseract、语言模型、固定版式模板和坐标区域解析路线不再属于设计或验收范围。

### 4.2 供应商中立接口

浏览器 UI 只调用下列边界；具体 adapter 可以是当前 Mock，也可以在未来替换为本系统 API adapter：

```ts
export type LicenseExtractionField = "name" | "birthDate" | "sex" | "address";

export type LicenseExtractionProfile = Readonly<Partial<{
  name: string;
  birthDate: string;
  sex: "M" | "F";
  address: string;
}>>;

export interface LicenseExtractionResult {
  readonly profile: LicenseExtractionProfile;
  readonly status: Readonly<Record<
    LicenseExtractionField,
    "extracted" | "manual_required"
  >>;
}

export interface LicenseExtractionClient {
  extract(input: {
    readonly file: File;
    readonly transform: LicenseImageTransform;
    readonly signal: AbortSignal;
    readonly onProgress?: (percent: number) => void;
  }): Promise<LicenseExtractionResult>;
}
```

接口不得返回模板名、供应商名、模型名、confidence、全文、区块、坐标、证件号码或任何第五个业务字段。
`profile` 缺失的字段必须在 `status` 中标记 `manual_required`。边界 adapter 必须拒绝额外 key，之后再执行统一字段校验：

- 姓名保留字母、空格、连字符和撇号，不做猜测或自动补全；
- 出生日期必须严格成为非未来的 `YYYY-MM-DD`；
- 性别只接受精确 `M` 或 `F`；
- 地址保留行序；空值、冲突、超长或非法值一律转为 `manual_required`。

### 4.3 当前 Mock 与未来真实 adapter

当前 `MockLicenseExtractionClient` 使用确定性测试场景返回安全四字段 DTO，不读取供应商 SDK，不发送网络请求。
任何由它预填的字段必须在页面清楚标注“模拟 AI 辅助结果（仅演示）”，不得让员工误以为系统已连接真实 AI，
也不得把模拟提取当作 KYC 核验。

未来真实 adapter 的唯一网络边界是本系统同源接口：

```text
POST /api/customers/onboarding/:token/license-extraction
Content-Type: multipart/form-data
Parts: frontImage, rotation, crop
Response: LicenseExtractionResult
```

该接口由本系统服务端完成 actor/session 鉴权、输入限制、供应商调用、响应白名单映射和错误归一化；浏览器只知道
本系统路径，不持有供应商 API key，不直接请求供应商域名，也不接收供应商原始响应。真实供应商接入不属于当前
Mock 施工；未来启用前仍须按 4.1 的选型原则确认工具、数据保留边界和运营成本。

### 4.4 图片安全边界

- 保留现有上传／拍摄、预览、旋转和裁切能力；只有员工选择辅助提取后，client 才接收当前 `file + transform`；
- 仅接受文件签名与 MIME 同时匹配的 JPEG／PNG；
- 原文件上限 12 MiB，解码像素上限 24 MP，送入提取边界的工作图长边上限 2400 px；
- 完成后另行生成现有不超过 512 KiB 的 KYC 证据副本；工作图和证据副本是不同生命周期；
- HEIC／HEIF、WebP、PDF、伪 MIME、无法解码、严重反光、遮挡或裁边的图片在调用 client 前拒绝或转人工；
- 产品负责人提供的真实驾驶证只作人工业务参考，不进入仓库、fixture、测试、截图、日志或提交历史。

### 4.5 请求生命周期与迟到响应

每次提取都有独立 attempt ID 和 `AbortController`。换图、旋转、裁切、切到手动模式、关闭工作区、身份变化或新请求
都会先使旧 attempt 失效并发出取消。员工在请求期间手填或修改四字段中的任一项时，也立即使该请求失效；该请求
随后成功、失败或取消都不得覆盖员工输入。

应用结果前必须同时确认：attempt 仍是当前请求、会话身份未变、图片与 transform revision 未变、员工没有在请求后
手填字段。任何一项不满足就静默丢弃迟到结果。失败或取消保留员工已经填写的资料，只给出可转人工的稳定提示；
成功也只做预填，绝不自动勾选现场确认、自动生成 KYC verified 或自动创建客户。

### 4.6 安全 DTO 与隐私

供应商原始响应、OCR raw、全文、confidence、blocks、hOCR、TSV、坐标、处理图和供应商 request ID 不得进入 React
state、reducer action、localStorage、sessionStorage、IndexedDB、Mock state、审计、URL、console、错误信息、截图或
测试快照。未来服务端代理必须在边界内把原始响应映射成 `LicenseExtractionResult` 后立即丢弃；浏览器只接收安全 DTO。

浏览器内原始 `File`、object URL、ImageBitmap、canvas 和工作图只服务于当前上传／预览／提取 attempt，完成、失败、
取消、换图或关闭后立即释放。允许持久化的只有员工最终确认后的四项正式资料和压缩后的驾驶证 KYC 证据。

当前 Mock 证据以 data URL 保存在浏览器，未达到真实客户证件的生产级加密、访问控制和删除要求。演示界面必须继续
标注“纯 Mock 演示，请勿上传真实客户证件”。

### 4.7 稳定错误

- `LICENSE_EXTRACTION_INPUT_UNSUPPORTED`：格式、签名或解码不支持；
- `LICENSE_EXTRACTION_IMAGE_TOO_LARGE`：字节或像素超限；
- `LICENSE_EXTRACTION_UNAVAILABLE`：当前 adapter 或未来系统代理不可用；
- `LICENSE_EXTRACTION_RESPONSE_INVALID`：返回结构或字段校验失败；
- `LICENSE_EXTRACTION_TIMEOUT`：请求超时并取消当前 attempt；
- `LICENSE_EXTRACTION_CANCELLED`：取消、换图、手填、关闭或会话变化，无副作用。

任何失败都不得显示“提取成功”，不得自动 KYC verified，也不得清除用户已手工填写的资料。

## 5. 预创建状态与接口

### 5.1 不建立临时客户

store 内新增不持久化的 `CustomerOnboardingSession` registry。它绑定当前 actor、规范手机号、查重时的 `sourceRevision`、OTP challenge、驾驶证证据草稿、四项辅助提取值、四项人工确认值及各阶段幂等 ID。

不把未完成登记写进 `CustomerVehicleStateV3`，因此不升级 schema，也不迁移历史数据。刷新会丢失未完成流程，但不会留下半个客户；页面应提示“刷新后需要重新登记”。

每个 session 在关闭新建工作区、身份变化或连续 30 分钟无操作后立即销毁；销毁时取消活动的提取 attempt、撤销 object URL，并释放图片和临时对象。每个 actor 同时只保留一个 onboarding session，新启动会先安全销毁旧 session，避免证件图片长期滞留内存。

状态机：

```text
phone_entry
  → phone_missing / phone_available / phone_conflict
  → otp_requested / otp_verified（可选，未完成则保留 gap）
  → kyc_submitted / kyc_confirmed（可选，未完成则保留 gap）
  → customer_previewed（包含缺项摘要与员工继续选择）
  → creating
  → created
```

`phone_missing` 与 `phone_available` 可以签发 actor-bound onboarding token；`phone_conflict` 只返回现有所有者，不签发可创建 token。个人客户及企业主要联系人完成驾驶证流程时经过 `kyc_submitted/kyc_confirmed` 两个阶段；未完成时可直接保存客户，并在 verification gap 中保留待补／待核验状态。企业证据记录一旦写入，必须明确主体为主要联系人。

### 5.2 Mock API

新增：

```text
POST /api/customers/onboarding/phone-preview
POST /api/customers/onboarding/:token/otp/request
POST /api/customers/onboarding/:token/otp/verify
POST /api/customers/onboarding/:token/kyc/submit
POST /api/customers/onboarding/:token/kyc/verify
POST /api/customers/onboarding/:token/preview
POST /api/customers/onboarding/:token/create
DELETE /api/customers/onboarding/:token
```

`DELETE` 只清理当前 actor 的内存登记；token 不存在或属于其他 actor 时也统一返回 `{ closed: true }`，不得泄露 token 是否存在。关闭弹窗、改变主要号码、会话身份变化或明确取消时都调用该接口；清理失败不阻止界面关闭，30 分钟失效机制负责兜底。

这是新建客户的唯一入口。旧 `POST /api/customers` 不再允许直接建客，必须返回稳定的 `400 CUSTOMER_ONBOARDING_REQUIRED` 且零写入；客户详情页的正式资料编辑以及已有客户的重新 OTP／KYC 接口保持不变。

号码为空或未被其他客户占用时返回 actor-bound `onboardingToken`。号码已被其他客户占用时只返回冲突所有者，不返回可用于创建的 token。KYC submit 由 Mock store 使用当前 actor 和权威 clock 补齐 EvidenceAsset 的 `createdAt/createdBy`；前端不能自报历史时间。所有请求在解析 body 前绑定 session 权限，身份切换使整个 onboarding token 失效。

现有 `requestCustomerOtp`、`verifyCustomerOtp`、`submitCustomerKyc`、`verifyCustomerKyc` 只处理已存在客户，不能直接用于预创建流程，因为它们每一步都会持久化客户。

## 6. 最终一次原子创建

最终 store 操作只调用一次 `persist()`：

1. 按 `actorId + clientMutationId + customer.create` 查询已完成幂等回执；
2. 验证 onboarding session、actor 和 token；阶段缺失只形成提醒，不作为业务拒绝；
3. 保存可空的最终主要号码及其当前 OTP 状态；号码为空时记录缺口，号码存在但 OTP 未验证时记录待验证；
4. 驾驶证已确认时保存四项快照；未上传、未完成或资料不齐时保存对应 gap。企业联系人证件地址不得写入企业地址；
5. 验证姓名音译 receipt 和最终 customer preview；
6. 读取最新 state，再次计算主要／备用／WhatsApp 的跨客户所有权；任一已填写号码属于其他客户时稳定拒绝且零写入；同一新客户草稿内复用同号不算冲突；
7. 重新计算姓名、Email 和企业名称等相似候选并保存提醒；sourceRevision 冲突提示刷新预览，证据 ID 仍须保持技术唯一；
8. 在一个 `nextState` 中创建 revision 1 客户；
9. 第一版档案按实际情况保存已验证记录或 verification gaps；企业 KYC 如已提供，主体必须是唯一主要联系人；
10. 同时写入 compact audit 和 `customer.create` mutation receipt；
11. `sourceRevision` 只增加一次，`persist()` 只调用一次；
12. 持久化成功后才消费 onboarding、preview 和姓名 token。

写入失败时 customers、audit、receipts 和 sourceRevision 全部不变，当前内存登记仍可用同一 `clientMutationId` 重试。响应丢失后再次提交必须返回同一客户，绝不能创建第二条记录。

## 7. 失效与恢复规则

- 手机号变化：清空 OTP、KYC、姓名确认和最终 preview；
- 图片变化：取消并失效旧提取 attempt，清空辅助提取值、KYC 确认、姓名确认和最终 preview；
- 旋转或裁切变化：取消并失效旧提取 attempt，清空辅助提取值、KYC 确认、姓名确认和最终 preview；
- 四项资料变化：清空 KYC 人工确认、姓名确认和最终 preview；
- 员工手填任一四字段：取消并失效活动提取 attempt；任何迟到结果不得覆盖手填值；
- 姓名变化：清空姓名音译和最终 preview；
- sourceRevision 变化：最终 preview 刷新；重新 preview 时再次检查手机号跨客户所有权及其他相似候选；
- 身份变化：取消活动提取 attempt 并使整个 onboarding token 失效，不接受旧异步响应；
- AI 辅助提取失败：保留已经填写的表单并转人工，不创建伪造提取结果；
- OTP 失败：保留号码输入并显示待验证，可重试，也可继续保存客户；
- 最终持久化失败：保留全部确认状态并允许原路径重试。

## 8. 验收标准

### 8.1 单元与 API

- 手机唯一性覆盖 `phone`、`secondaryPhone`、`whatsapp`；留空可取得 onboarding token，命中其他客户时返回现有所有者且不签发可创建 token；
- 号码变化使后续全部 receipt 失效；
- 未验证 OTP、未提交 KYC 或未确认四项都可 preview/create，并生成准确的待验证／待补提醒；
- 最终并发重查发现手机号已被其他客户占用时返回 `CUSTOMER_PHONE_DUPLICATE`、保留输入且零写入；修改或清空号码后可继续；
- 同一客户内部三个电话字段可复用同号；姓名、Email 和企业名称相似候选允许员工继续并保留提醒；
- 现有车辆车牌唯一性规则继续保持：已填写规范车牌不得属于第二辆车；
- persist 故障零部分写入，原 token 可重试；相同 create mutation ID 返回同一客户；
- 成功客户 revision 1，验证 archive 和 gaps 从创建起如实反映 OTP／KYC 当前状态；
- 一次最终提交只执行一次持久化；现有 schema v3 无迁移；
- `LicenseExtractionClient` 的返回值只可能包含四项安全 profile 和四项 status；额外 key、非法日期或非法性别被拒绝；
- 当前 Mock adapter 返回确定性模拟结果且零外部请求；UI 和客户领域代码不依赖供应商 SDK、模型或响应类型；
- 换图、旋转、裁切、手填、关闭和身份变化都会取消并失效活动 attempt；迟到成功不得覆盖员工输入；
- 失败或取消保留员工已填字段，辅助提取成功也不能自动完成人工确认或 KYC；
- 供应商原始响应、OCR raw、confidence 和禁用字段不进入任何前端状态、持久化、审计、console 或网络 DTO；
- 当前 Mock 交付不新增真实 AI 依赖、供应商 key、供应商 endpoint 或真实提取路由实现。

### 8.2 浏览器与视觉

- 用带“合成演示资料”水印的虚构牙买加驾驶证做回归，绝不使用产品负责人提供的真实样本；
- 页面把当前 adapter 的预填明确标注为“模拟 AI 辅助结果（仅演示）”，不得出现已连接真实 AI 的误导；
- 常规 E2E 注入确定性的 `LicenseExtractionClient`，覆盖完整结果、部分 `manual_required`、失败、取消和迟到响应；
- 覆盖空号码建档、已有号码显示所有者且不能重复创建、修改／清空后继续、OTP 待验证建档、模拟提取成功、部分人工填写、提取不可用后的人工填写、无驾驶证建档并提醒、会话切换、并发手机号冲突、写入失败和响应丢失；
- 上传、拍摄、预览、旋转、裁切、四字段编辑和人工确认保持可用，提取能力不可用时完整手动路径仍可完成；
- 最终客户详情可查看 OTP 号码和驾驶证证据，KYC 显示已核验而非待核验；
- 桌面与 430 px 无横向溢出，上传、旋转、裁卡、OTP、四项确认和最终创建均可用键盘完成；
- 页面不出现客户标签或首车关系。

## 9. 成功定义

员工可以在一个可理解的现场流程里查看手机号占用情况、相似候选、OTP 状态和驾驶证缺项，再借助可替换的 AI 辅助提取减少四项资料的手工录入；当前 Mock 结果被如实标注为模拟，未来真实能力只能经本系统 API 代理。系统允许员工在资料不完整时继续建档，同时把待补、待验证和操作人如实记录；已填写手机号则保持跨客户唯一。失败、取消、换图和迟到响应不会覆盖手填资料，也不会伪造 KYC 或无法解释的机器字段。
