# 正式客户驾驶证采集、识别与核验设计

状态：用户已批准进入完整设计与实施

日期：2026-08-27
时区：America/Jamaica

## 1. 目标

在 3220 单体候选应用的正式客户建档、客户详情和公司主要联系人流程中提供可实际使用的驾驶证采集能力。员工可以拍摄或上传驾驶证正面，使用系统服务端配置的文档识别能力提取姓名、出生日期、性别和证件地址，核对原件后把资料、证据、核验人、核验时间和历史记录写入 PostgreSQL 与正式附件目录。

客户资料完整度不作为业务闸门。没有驾驶证、识别失败、四项不完整或尚未核验时，员工仍可创建客户；系统如实显示 `待补`、`待核验` 或 `需重新核验`，并记录由谁在何时按当前事实继续办理。

本设计只处理驾驶证正面。护照、TRN 卡、驾驶证背面、签名和头像比对不进入本轮识别范围。

## 2. 业务范围

### 2.1 个人客户

新建个人客户时显示明确的“扫描驾驶证”入口，支持：

1. 拍照或选择 JPEG／PNG；
2. 预览、旋转和裁切；
3. AI 辅助提取姓名、出生日期、性别和证件地址；
4. 员工逐项校正；
5. 勾选“已核对到场本人、驾驶证原件和以上资料”；
6. 创建客户并保存当前有效驾驶证记录。

驾驶证姓名写入个人客户正式姓名；证件地址写入个人客户地址；出生日期和性别写入新增的正式资料字段。员工未完成证件核验时，手工填写的普通客户资料仍可保存，但不会被标记为驾驶证已核验。

手机号和 TRN 都允许暂缺。任一号码一旦填写，执行服务端规范化和跨客户唯一性校验；精确占用冲突必须解决，资料缺失只形成待补状态。同一客户可把同一号码同时用于手机号和 WhatsApp，不同客户不能占用同一个规范化号码。

### 2.2 公司客户与主要联系人

公司客户建档继续以公司为客户主体，同时增加“主要联系人”区域：

- 主要联系人姓名；
- 手机号、WhatsApp 和 TRN；
- 职位；
- 驾驶证采集与四项证件快照。

驾驶证证据属于主要联系人。证件地址不得覆盖公司通讯地址。公司没有主要联系人、主要联系人没有驾驶证或核验未完成时仍可创建，公司详情显示相应待补状态。

主要联系人处理规则：

- 已填写手机号时，先按规范化号码查找个人客户；精确命中时要求员工确认复用该个人客户；
- 没有精确号码命中时，根据姓名显示相似候选，但相似候选只提醒；
- 员工确认创建新联系人时，在同一事务中创建个人客户、创建公司、建立唯一有效主要联系人关系并写入证件记录；
- 联系人手机号和 TRN 都暂缺时也允许创建个人客户，后续补充号码时继续执行唯一性校验；
- 更换公司主要联系人后，旧证据保留在历史中，新联系人状态为待补或待核验。

### 2.3 已有客户

客户详情页增加“驾驶证资料”卡片：

- 显示当前状态、四项证件快照、核验人和核验时间；
- 允许有写权限的员工补充、重新拍摄或重新核验；
- 允许授权读者查看证据图片；
- 每次替换产生新记录，旧记录标记为已被替代并继续可审计；
- 正式姓名或公司主要联系人发生变化时，当前证据自动进入 `需重新核验`，不删除历史。

## 3. 界面设计

### 3.1 新建客户弹窗

沿用当前 `FormalCustomerCreateDialog`，扩展为可滚动的大尺寸正式建档工作区，不切回浏览器本地 Mock 状态机。

页面顺序：

```text
客户类型
→ 个人客户资料 / 公司资料与主要联系人
→ 驾驶证采集
→ 识别结果与人工核对
→ 缺项摘要
→ 创建并使用
```

个人客户入口文案为“扫描客户驾驶证”；公司客户入口文案为“扫描主要联系人驾驶证”。入口始终可见，未选择图片时展示拍照/上传区，已选择图片后展示图片编辑器、识别按钮和四项字段。

状态文案固定为：

- `待补`：没有当前驾驶证证据；
- `待核验`：有证据或资料，但员工尚未确认原件；
- `已核验`：员工已确认本人、原件和四项资料；
- `需重新核验`：正式姓名或主要联系人已变化，旧证据只能作为历史。

AI 识别只是预填。界面不显示置信度、供应商名称、模型名称、原始 OCR 文本或内部错误代码。

### 3.2 缺项摘要

提交前在按钮上方显示当前事实，例如：

```text
驾驶证：待补，将在客户档案中保留提醒
手机号：待补
TRN：待补
```

缺项摘要不禁用“创建并使用”。文件格式错误、无法解码、身份冲突、无权限和数据库写入失败属于技术或数据完整性错误，必须阻止错误写入并显示可操作提示。

### 3.3 客户详情

客户详情中的驾驶证卡片提供：

- 当前证件状态；
- 姓名、出生日期、性别、证件地址；
- 核验员工和 Jamaica 时间；
- “查看证据”“补充驾驶证”“重新核验”；
- 历史记录入口。

公司详情把该卡片放在主要联系人区域，标题固定为“主要联系人驾驶证”。

## 4. 正式数据模型

### 4.1 个人客户字段

向 `personal_customers` 追加：

```text
birth_date date null
gender text null                -- 只允许 M / F
```

移除 `personal_customers_identity_present` 数据库约束，并同步修改 Zod 创建校验。手机号和 TRN 为空时允许保存；填写时继续规范化、格式校验和唯一性校验。

### 4.2 电话身份登记

新增表 `customer_phone_registry`，为个人客户和公司客户提供跨字段、跨客户、并发安全的号码唯一性：

```text
normalized_phone text primary key
owner_kind text not null          -- person / company
owner_id bigint not null
registered_at timestamptz not null
```

创建或修改客户时，服务端收集手机号、WhatsApp 及以后新增的备用号码，规范化后去重，并在同一事务中同步登记表。同一 owner 的多个字段可以复用同一号码；另一个 owner 占用相同号码时返回冲突。数据库迁移先扫描现有个人与公司号码；发现跨客户冲突时停止迁移并输出客户编号，不静默选择所有者。

TRN 继续使用现有 `customer_trn_registry`。电话和 TRN 登记都必须在客户事务内完成，不能只依靠页面查重。

### 4.3 驾驶证记录

新增枚举：

```text
customer_license_subject_type = individual_customer | organization_primary_contact
customer_license_status = pending_verification | verified | needs_reverification
```

新增表 `customer_driver_license_records`：

```text
id bigint identity primary key
subject_type customer_license_subject_type not null
personal_customer_id bigint null references personal_customers(id)
company_account_id bigint null references company_accounts(id)
company_contact_id bigint null references company_contacts(id)
file_id bigint not null references stored_files(id)
document_name text not null
birth_date date not null
sex text not null                 -- M / F
document_address text not null
status customer_license_status not null
verified_by bigint null references staff_accounts(id)
verified_at timestamptz null
superseded_at timestamptz null
superseded_by bigint null references staff_accounts(id)
created_by bigint not null references staff_accounts(id)
created_at timestamptz not null
version integer not null default 1
```

数据库约束：

- `individual_customer` 必须只有 `personal_customer_id`；
- `organization_primary_contact` 必须具备 `company_account_id`，有正式联系人关系时同时记录 `company_contact_id` 和联系人 `personal_customer_id`；
- `verified` 必须同时具备 `verified_by` 和 `verified_at`；其他状态不得伪造核验人和时间；
- `sex` 只允许 `M` 或 `F`，姓名和地址去空后必须非空；
- 每个个人客户最多一条未替代的当前记录；每个公司最多一条未替代的主要联系人当前记录；
- `file_id` 只能关联一条驾驶证记录；
- `version >= 1`。

旧记录不回填证件资料。迁移完成后，没有当前记录的客户在读取模型中自然显示为 `待补`。

### 4.4 附件

复用 `stored_files` 元数据表和正式 `UPLOAD_ROOT`，新增存储键前缀：

```text
customer-license-files/YYYY/MM/<uuid>.jpg|png
```

持久证据使用经过方向校正、裁切和尺寸限制的 JPEG／PNG；单份证据上限 5 MiB，最大 24 MP，长边不超过 2400 px。保存前同时校验 MIME、文件签名和实际解码结果，计算 SHA-256。

文件先以不可覆盖方式写入候选附件目录，再执行数据库事务。数据库事务失败时删除本次新文件；数据库成功后文件成为只读证据，不允许原地覆盖。

## 5. 正式接口

### 5.1 识别

```text
POST /api/formal/customer-driver-license/recognize
Content-Type: multipart/form-data
Parts: image, rotation, crop
```

要求正式会话，且账号角色为 `super_admin` 或 `front_desk`。服务端验证并准备图片后调用当前系统设置中已配置的文档 AI 凭据。

响应只允许：

```ts
type CustomerLicenseRecognition = {
  fields: {
    name: string | null;
    birthDate: string | null;
    sex: "M" | "F" | null;
    address: string | null;
  };
  status: Record<"name" | "birthDate" | "sex" | "address", "extracted" | "manual_required">;
};
```

OpenAI 使用严格 JSON Schema；Google Vision 的 OCR 文本在服务端通过确定性解析器映射。无法可靠得到的字段返回 `manual_required`，不得猜测。

### 5.2 创建客户

现有 `POST /api/formal/customers` 保持 JSON 兼容，并增加可选 multipart 合同：

```text
Parts:
  payload: JSON 字符串
  licenseFront: JPEG/PNG，可选
```

`payload` 包含现有客户字段、可选公司主要联系人字段、四项证件快照、员工核验声明和识别后的图片变换参数。公司主要联系人部分使用明确的二选一合同：`existingPersonalCustomerNo` 表示员工确认复用已有个人客户；`newPrimaryContact` 表示创建新的主要联系人，两者不能同时出现。服务端不信任浏览器的“已识别”标志，只接受经过 schema 校验的四项和明确的员工核验声明。

有证件时，领域服务在一个数据库事务中完成：

1. 权限校验；
2. 手机号跨字段登记和 TRN 唯一性校验；
3. 创建个人客户或公司及主要联系人；
4. 登记 `stored_files`；
5. 写入当前驾驶证记录；
6. 写入正式审计事件。

没有证件时创建客户并写入 `customer.driver_license_missing_acknowledged` 审计事件，记录 actor、时间和客户主体。读取模型根据当前记录缺失显示待补。

### 5.3 已有客户补录与证据读取

```text
POST /api/formal/customers/:customerNo/driver-license
GET  /api/formal/customers/:customerNo/driver-license-history
GET  /api/formal/customer-driver-license-records/:recordId/file
```

补录接口使用 multipart，写入新记录并在同一事务中替代旧记录。证据读取要求正式会话和客户读取权限，响应使用 `Cache-Control: private, no-store` 与下载安全头。

## 6. AI 与隐私边界

- 复用系统设置中现有的 OpenAI／Google 凭据和模型选择，不要求用户再次配置密钥；
- 凭据只在服务器读取，浏览器只调用同源正式接口；
- OpenAI 请求使用 `store: false`；
- 原始 OCR、供应商响应、置信度、坐标、请求 ID、图片 Base64 和证件全文不写入数据库、审计、日志、URL、localStorage、sessionStorage 或错误信息；
- React 状态只保留当前页面所需的安全四字段和本地 object URL；换图、关闭弹窗和保存完成时释放 object URL；
- 识别请求设置 60 秒超时。换图、旋转、裁切、关闭弹窗或再次识别时取消旧请求，迟到结果不得覆盖新输入；
- 识别不可用时保留图片和员工输入，允许转为人工核对。

## 7. 权限与审计

权限沿用正式客户领域：

- `super_admin`、`front_desk`：创建客户、识别、补录、替换和核验；
- `owner`：读取客户资料和证据，无写入权限；
- 其他角色：无客户证件读写权限。

审计事件至少包括：

```text
customer.driver_license_missing_acknowledged
customer.driver_license_recorded
customer.driver_license_verified
customer.driver_license_superseded
customer.driver_license_reverification_required
company.primary_contact_created
company.primary_contact_changed
```

审计只记录记录 ID、状态变化、主体、actor 和时间，不复制图片、证件地址或完整识别结果。

## 8. 错误处理

稳定用户提示：

- 图片格式或签名不符：`仅支持有效的 JPEG 或 PNG 驾驶证图片`；
- 图片过大或无法解码：`图片无法处理，请重新拍摄或选择较小图片`；
- AI 未配置：`证件识别尚未配置，可以改为人工填写`；
- AI 超时或供应商失败：`证件识别暂时不可用，已保留当前图片和输入`；
- 手机号/TRN 冲突：显示已有客户编号和可打开的客户档案；
- 权限不足：`当前账号没有客户证件写入权限`；
- 附件写入或数据库事务失败：客户和证件不得形成半成功状态，并保留表单供重试。

服务端错误响应不返回供应商错误原文、密钥片段、存储绝对路径、SQL 或堆栈。

## 9. 实现边界

复用并正式化以下现有能力：

- `LicenseImageEditor` 的预览、旋转和裁切交互；
- `license-extraction/types.ts` 的四字段安全 DTO 和严格校验；
- 车辆资料识别的图片准备、服务端 AI 调用模式和设置凭据；
- `stored_files`、外置卷附件目录、SHA-256、不可覆盖写入和失败清理模式；
- 客户领域的正式会话、`requireReader`、`requireWriter`、事务和审计。

正式 UI、API 和领域服务不得调用 `mock-customers`、Mock onboarding session 或浏览器本地业务存储。

## 10. 数据迁移与兼容

1. 新增枚举、个人资料字段、电话身份登记表、驾驶证记录表和索引；
2. 删除个人客户必须具备手机号或 TRN 的数据库约束；
3. 保留所有既有客户、公司、联系人、车辆关系、附件和审计；
4. 既有客户不生成虚构出生日期、性别、证据、核验人或核验时间；
5. 现有 JSON 客户创建 API 和当前正式消费者继续工作；
6. 新页面读取不到驾驶证记录时显示待补，不视为数据损坏；
7. 候选迁移只运行于 3220 隔离数据库，当前 3210、3211、正式数据库和冻结备份保持不变。

## 11. 自动化验证

### 11.1 数据库与领域服务

- 迁移前后既有客户数量和主键不变；
- 个人、公司主要联系人、缺证建档、已核验建档和替换证据路径；
- 手机号跨字段/跨客户唯一性、TRN 唯一性、公司唯一有效主要联系人和当前证据唯一性；
- 权限拒绝、事务失败零写入、文件失败清理和审计事件；
- 姓名或主要联系人变化后状态进入需重新核验；
- 旧证据保留且当前记录切换正确。

### 11.2 API 与 AI 边界

- 未登录 401、owner 写入 403、允许角色成功；
- JPEG／PNG 文件签名、字节、像素和解码限制；
- OpenAI 严格响应、Google 确定性解析、缺字段转人工；
- 超时、取消、无配置和非法供应商响应；
- JSON 创建合同回归及 multipart 创建合同；
- 响应、日志和审计中不存在 Base64、密钥、原始 OCR 或供应商响应。

### 11.3 前端与浏览器

- 个人和公司入口文案、上传、相机 capture、旋转、裁切、识别、人工校正、核验和缺项摘要；
- 请求期间换图或改字段不会被迟到结果覆盖；
- 创建后刷新、退出、重新登录仍能读取正式资料和证据状态；
- 客户详情补录、替换、历史和权限只读状态；
- 桌面宽度和 430 px 宽度无横向溢出，键盘焦点、关闭确认和错误提示可用；
- 浏览器控制台无相关 error/warn。

## 12. 验收门槛

本功能只有同时满足以下条件才可标记完成：

1. 根目录正式服务测试、`apps/web` 单元测试、类型检查和生产构建全部通过；
2. 新增数据库迁移在全新数据库和现有候选数据库上均成功；
3. 3220 中实际完成一条个人已核验证件建档并在刷新、重新登录后读回；
4. 实际完成一条公司主要联系人证件建档，证件地址与公司地址保持分离；
5. 实际完成无证件建档并看到待补状态；
6. 实际完成已有客户补录与替换，历史证据仍可读取；
7. owner 账号只能查看，front desk 和 super admin 可写；
8. AI 成功、AI 失败转人工、手机号冲突和附件失败路径均有可操作结果；
9. 数据库、附件目录和审计与页面显示一致；
10. 当前 3210、3211、正式数据库和冻结备份没有被修改。

## 13. 实施顺序

```text
数据库迁移与领域约束
→ 附件存储与驾驶证记录服务
→ 识别 DTO、图片准备和正式 AI 路由
→ 客户创建 multipart 与已有客户补录接口
→ 正式建档 UI 与详情卡片
→ 单元/集成/E2E
→ 3220 隔离数据真实浏览器验收
→ 用户确认后再讨论 3210 切换
```
