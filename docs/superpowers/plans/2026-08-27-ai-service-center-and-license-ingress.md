# AI 服务中心与驾驶证识别 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** 在 3220 候选应用中交付统一、服务器保密、可按任务自动切换的 AI 服务中心，并补齐客户驾驶证拖拽、粘贴和更准确的多服务识别。

**Architecture:** 以服务器版本化 JSON 作为 AI 配置真源，由统一任务路由执行器选择服务商并记录无敏感信息的事件。现有文本、客户驾驶证和车辆证件 API 只调用执行器；设置页通过受 `super_admin` 保护的统一接口管理配置。客户驾驶证上传继续使用现有编辑器与校对流程，只扩展输入通道和识别策略。

**Tech Stack:** Next.js 16 Route Handlers、React 19、TypeScript、Vitest、PostgreSQL 正式会话与权限、Sharp、Tailwind CSS。

**Spec:** `docs/superpowers/specs/2026-08-27-ai-service-center-and-license-ingress-design.md`

## Global Constraints

- [ ] 只修改 `/Volumes/公司文件/Whole Hearted Car Service 单体候选/3210-single-runtime`。
- [ ] 改动前生成候选运行快照并校验摘要；不操作 3210、3211 和正式数据库。
- [ ] 任何 API 响应、日志、测试输出和浏览器状态都不得暴露完整 API Key 或客户证件资料。
- [ ] 遵守 Next.js 16 Route Handler、服务器/客户端边界和当前正式会话权限合同。
- [ ] 每项功能先写行为测试并确认失败，再写最小实现使其通过。

## Task 1: 建立统一 AI 配置与迁移

**Files:**

- Create: `apps/web/src/lib/server/ai-service-settings.ts`
- Create: `apps/web/tests/unit/ai-service-settings.spec.ts`
- Modify: `apps/web/src/lib/server/vehicle-document-ai-settings.ts`
- Modify: `apps/web/tests/unit/vehicle-document-ai-settings.spec.ts`

**Steps:**

- [ ] 编写版本 1 证件配置迁移、服务商掩码、保留旧密钥、路线校验和自定义 HTTPS 地址校验测试。
- [ ] 运行目标测试并确认因统一模块缺失而失败。
- [ ] 实现版本 2 配置、默认路线、原子保存、`0600` 权限和兼容适配层。
- [ ] 运行目标测试并确认全部通过。

## Task 2: 建立自动切换执行器与安全事件

**Files:**

- Create: `apps/web/src/lib/server/ai-route-executor.ts`
- Create: `apps/web/src/lib/server/ai-service-events.ts`
- Create: `apps/web/tests/unit/ai-route-executor.spec.ts`
- Create: `apps/web/tests/unit/ai-service-events.spec.ts`

**Steps:**

- [ ] 编写首选成功、429、超时、5xx、认证错误、畸形结果、用户取消、耗尽路线和最佳部分结果测试。
- [ ] 编写事件只保存安全元数据、权限文件和有界读取测试。
- [ ] 运行测试并确认失败。
- [ ] 实现单次有序尝试、失败分类、最佳候选选择和安全事件记录。
- [ ] 运行目标测试并确认通过。

## Task 3: 迁移文本与证件 API

**Files:**

- Modify: `apps/web/src/app/api/ai/chat/route.ts`
- Modify: `apps/web/src/lib/ai/deepseek.ts`
- Modify: `apps/web/src/lib/ai/auto-repair.ts`
- Modify: `apps/web/src/app/api/formal/customer-driver-license/recognize/route.ts`
- Modify: `apps/web/src/lib/server/customer-driver-license-recognizer.ts`
- Modify: `apps/web/src/app/api/ai/vehicle-document/route.ts`
- Modify: `apps/web/src/lib/customers/vehicle-document-ai.ts`
- Create: `apps/web/tests/unit/ai-chat-route.spec.ts`
- Modify: `apps/web/tests/unit/customer-driver-license-recognition.spec.ts`
- Modify: `apps/web/tests/unit/vehicle-document-ai-route.spec.ts`

**Steps:**

- [ ] 编写文本接口拒绝未登录、忽略客户端密钥并走文本路线的测试。
- [ ] 编写驾驶证与车辆证件首选失败后切换、空结果继续尝试和最佳部分结果测试。
- [ ] 运行目标测试并确认失败。
- [ ] 将三个入口接入统一执行器，保持原业务响应字段兼容。
- [ ] 移除浏览器密钥传输和客户端 `aiEnabled` 短路，保留业务降级结果。
- [ ] 运行目标测试并确认通过。

## Task 4: 增强驾驶证图片与上传方式

**Files:**

- Create: `apps/web/src/lib/customers/document-image-selection.ts`
- Modify: `apps/web/src/lib/customers/vehicle-document-camera.ts`
- Modify: `apps/web/src/lib/server/customer-driver-license-image.ts`
- Modify: `apps/web/src/components/customers/formal-customer-license-section.tsx`
- Create: `apps/web/tests/unit/document-image-selection.spec.ts`
- Modify: `apps/web/tests/unit/customer-driver-license-image.spec.ts`
- Modify: `apps/web/tests/unit/formal-customer-license-section.spec.ts`

**Steps:**

- [ ] 编写单图、无支持图片、多图、超限和可编辑目标粘贴保护的纯行为测试。
- [ ] 编写图像方向、裁切、标准化和锐化处理测试。
- [ ] 运行目标测试并确认失败。
- [ ] 实现共享选图策略、拖拽高亮、窗口粘贴监听和准确提示。
- [ ] 增强服务端预处理并保留现有裁切、旋转和大小限制。
- [ ] 运行目标测试并确认通过。

## Task 5: 实现统一设置 API 与页面

**Files:**

- Create: `apps/web/src/app/api/ai/settings/route.ts`
- Create: `apps/web/src/components/settings/ai-service-center.tsx`
- Modify: `apps/web/src/app/settings/page.tsx`
- Modify: `apps/web/src/lib/ai/settings.ts`
- Create: `apps/web/tests/unit/ai-settings-route.spec.ts`
- Modify: `apps/web/tests/unit/ai-settings.spec.ts`
- Modify: `apps/web/tests/e2e/settings.spec.ts`

**Steps:**

- [ ] 编写管理员权限、掩码读取、保留密钥、连接测试和浏览器旧 DeepSeek 安全迁移测试。
- [ ] 编写页面服务商配置、三条任务路线、重新排序、保存刷新和最近事件交互测试。
- [ ] 运行目标测试并确认失败。
- [ ] 实现受保护的统一 GET / PUT / POST 接口和迁移入口。
- [ ] 实现一个 AI 服务中心，沿用现有视觉系统并应用 IBM Carbon 式信息层级。
- [ ] 删除旧页面中的两套分离卡片，保留绩效参数、字典和其他设置。
- [ ] 运行目标测试并确认通过。

## Task 6: 集成、视觉与安全验收

**Files:**

- Modify: `apps/web/tests/e2e/settings.spec.ts`
- Modify: `apps/web/tests/e2e/customers.spec.ts`
- Create: `docs/screenshots/ai-service-center-desktop.png`
- Create: `docs/screenshots/customer-license-upload-desktop.png`

**Steps:**

- [ ] 运行目标单元测试、`pnpm test`、`pnpm test:web:unit` 和协作边界检查。
- [ ] 运行 `pnpm typecheck`、`pnpm typecheck:web`、lint 与生产构建。
- [ ] 通过 3220 实际浏览器验证管理员设置保存刷新、路线调整、连接测试和客户拖拽/粘贴入口。
- [ ] 检查浏览器控制台、网络响应和页面源中不存在完整密钥。
- [ ] 保存桌面和窄屏截图，在最终截图与现有界面之间核对层级、间距、颜色、响应式和交互状态。
- [ ] 记录回滚快照、测试结果、已知外部服务限制和候选 URL；不切换正式端口。
