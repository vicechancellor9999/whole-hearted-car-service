# 正式系统阶段 1：云端基础、登录权限与数据库实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.

**Goal:** 建立可真实持久化、可登录、可授权、可审计、可备份并可部署到单店服务器的正式系统基础。

**Architecture:** 在一个 Next.js 服务端应用内完成页面、身份校验和业务服务，使用 PostgreSQL 18 保存事实数据，Caddy 负责 HTTPS 和反向代理。身份验证使用登录名、Argon2id 密码哈希和数据库会话；所有受保护操作在服务端再次校验角色，不依赖页面隐藏按钮。

**Tech Stack:** Next.js 16.3.2、React 19.2.8、TypeScript、PostgreSQL 18、Drizzle ORM 0.45.2、Drizzle Kit 0.31.10、`postgres` 3.4.9、`argon2` 0.45.1、Zod 4.4.3、Vitest 4.1.11、Playwright 1.62.1、Docker Compose、Caddy。

**Business references:**

- `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/main/docs/formal-backend/2026-08-24-formal-backend-business-rules.md`
- `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/main/docs/formal-backend/2026-08-24-pc-web-acceptance-checklist.md`
- `/Volumes/公司文件/Whole Hearted Car Service 正式系统/docs/architecture/2026-08-24-formal-system-roadmap.md`

---

## 前置约束

- 工作目录固定：`/Volumes/公司文件/Whole Hearted Car Service 正式系统`。
- 不从现有 Mock 项目复制数据服务、localStorage、IndexedDB 或演示记录。
- 可以参考现有页面信息层级，但阶段 1 只建立登录、权限、持久化、审计和部署骨架。
- 没有默认生产密码；第一个超级管理员通过服务器命令创建，并强制首次登录改密。
- 所有数据库变更必须由 `drizzle/` 下的 SQL 迁移文件产生。
- 本机当前具备 Node.js 22.22.2、npm 10.9.7、pnpm 11.19.0；当前未安装 Docker 和 PostgreSQL。单元测试可直接执行，PostgreSQL 集成测试在容器环境或服务器环境执行。

## Task 1：建立正式项目骨架

**Files:**

- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/package.json`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/pnpm-workspace.yaml`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/tsconfig.json`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/next.config.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/eslint.config.mjs`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/vitest.config.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/playwright.config.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/.gitignore`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/layout.tsx`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/page.tsx`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/globals.css`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/not-found.tsx`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/error.tsx`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/page.test.tsx`

**Step 1: 写失败的首页测试**

测试渲染首页并断言存在 `Whole Hearted 正式管理系统` 和 `登录` 链接。此时页面文件尚不存在，测试必须失败。

**Step 2: 初始化正式系统 Git 仓库和隔离开发分支**

Run:

```bash
cd '/Volumes/公司文件/Whole Hearted Car Service 正式系统'
git init -b codex/formal-foundation
```

Expected: 当前目录成为独立 Git 仓库，分支为 `codex/formal-foundation`，现有规划文档保留；不在主分支直接开发。

**Step 3: 初始化依赖**

Run:

```bash
cd '/Volumes/公司文件/Whole Hearted Car Service 正式系统'
pnpm add next@16.3.2 react@19.2.8 react-dom@19.2.8 zod@4.4.3
pnpm add -D typescript @types/node @types/react @types/react-dom eslint eslint-config-next vitest@4.1.11 @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @playwright/test@1.62.1 tsx
```

Expected: 生成 `pnpm-lock.yaml`，安装命令退出码为 0。

**Step 4: 实现最小首页与全局布局**

首页只显示系统名称、正式系统标记和登录入口。`layout.tsx` 设置中文语言、牙买加时区说明和基础页面元数据。

**Step 5: 配置脚本**

`package.json` 至少包含：

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

**Step 6: 运行最小质量门禁**

Run:

```bash
pnpm test src/app/page.test.tsx
pnpm typecheck
pnpm lint
```

Expected: 首页测试通过，TypeScript 和 ESLint 退出码均为 0。

**Step 7: 提交**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json next.config.ts eslint.config.mjs vitest.config.ts playwright.config.ts .gitignore src/app
git commit -m "chore: scaffold formal Whole Hearted system"
```

## Task 2：建立环境配置、请求编号与健康检查

**Files:**

- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/.env.example`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/lib/env.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/lib/time.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/lib/request-id.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/api/health/live/route.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/api/health/ready/route.ts`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/lib/env.test.ts`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/lib/time.test.ts`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/api/health/live/route.test.ts`

**Step 1: 写配置失败测试**

覆盖以下情况：

- 缺少 `DATABASE_URL` 时生产配置解析失败。
- `APP_TIMEZONE` 不是 `America/Jamaica` 时解析失败。
- Cookie 密钥少于 32 字节时解析失败。
- 测试环境允许注入独立测试数据库地址。

**Step 2: 实现单入口配置**

`src/lib/env.ts` 使用 Zod 一次性解析：

```ts
type AppEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  DATABASE_URL: string;
  APP_ORIGIN: string;
  APP_TIMEZONE: 'America/Jamaica';
  SESSION_COOKIE_NAME: 'wh_session';
  SESSION_TOKEN_PEPPER: string;
  UPLOAD_ROOT: string;
};
```

业务模块不得直接读取 `process.env`。

**Step 3: 实现时间工具**

所有写库时间使用数据库 `now()`；展示与报表边界通过 `America/Jamaica` 计算。测试牙买加跨日、跨月边界，不使用浏览器本地时区作为业务月份。

**Step 4: 实现健康检查**

- `/api/health/live`：应用进程可响应即返回 200。
- `/api/health/ready`：执行 `select 1` 成功才返回 200；失败返回 503，不泄露数据库错误或连接串。

**Step 5: 验证**

Run:

```bash
pnpm test src/lib/env.test.ts src/lib/time.test.ts src/app/api/health/live/route.test.ts
pnpm typecheck
```

Expected: 全部通过。

**Step 6: 提交**

```bash
git add .env.example src/lib src/app/api/health
git commit -m "feat: add validated runtime configuration and health checks"
```

## Task 3：建立 PostgreSQL、迁移与核心身份表

**Files:**

- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/drizzle.config.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/db/client.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/db/schema/common.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/db/schema/accounts.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/db/schema/sessions.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/db/schema/audit-events.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/db/schema/index.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/db/migrate.ts`
- Generate: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/drizzle/0000_foundation.sql`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/db/schema/foundation.integration.test.ts`

**Step 1: 添加数据库依赖**

Run:

```bash
pnpm add drizzle-orm@0.45.2 postgres@3.4.9 argon2@0.45.1
pnpm add -D drizzle-kit@0.31.10
```

**Step 2: 写失败的结构集成测试**

测试迁移后存在并约束：

- `staff_accounts.normalized_username` 唯一。
- 角色只允许 `super_admin`、`front_desk`、`owner`、`mechanic`。
- 停用账号不能创建新有效会话。
- `auth_sessions.token_hash` 唯一，保存过期、撤销和最后活动时间。
- `audit_events` 保存 JSON 前后值，应用角色无 `UPDATE` 和 `DELETE` 路径。

**Step 3: 定义身份表**

`staff_accounts`：

```text
id uuid primary key
display_name text not null
normalized_username text unique not null
password_hash text not null
role account_role not null
is_active boolean not null default true
must_change_password boolean not null default true
session_epoch integer not null default 1
created_at timestamptz not null
updated_at timestamptz not null
created_by uuid nullable
version integer not null default 1
```

`auth_sessions`：

```text
id uuid primary key
account_id uuid not null references staff_accounts
token_hash text unique not null
session_epoch integer not null
created_at timestamptz not null
last_seen_at timestamptz not null
expires_at timestamptz not null
revoked_at timestamptz nullable
ip_address inet nullable
user_agent text nullable
```

`audit_events`：

```text
id uuid primary key
occurred_at timestamptz not null
actor_account_id uuid nullable
event_type text not null
object_type text not null
object_id text not null
reason text nullable
before_state jsonb nullable
after_state jsonb nullable
request_id text not null
ip_address inet nullable
user_agent text nullable
```

**Step 4: 生成并审查 SQL 迁移**

Run:

```bash
pnpm drizzle-kit generate --name foundation
```

检查 SQL 只创建预期枚举、表、索引和外键。迁移必须显式启用 `pgcrypto` 以生成 UUID，不能删除已有对象。

**Step 5: 在 PostgreSQL 18 测试库执行迁移**

Run:

```bash
DATABASE_URL="$WH_DATABASE_URL_TEST" pnpm tsx src/db/migrate.ts
pnpm test src/db/schema/foundation.integration.test.ts
```

Expected: 迁移退出码 0；重复执行迁移不重复建表；集成测试通过。

**Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml drizzle.config.ts drizzle src/db
git commit -m "feat: add PostgreSQL foundation schema and migrations"
```

## Task 4：实现密码、数据库会话与登录退出

**Files:**

- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/auth/password.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/auth/session-token.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/auth/session-repository.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/auth/auth-service.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/auth/current-session.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/auth/login-rate-limit.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/login/page.tsx`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/login/actions.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/logout/route.ts`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/auth/password.test.ts`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/auth/session-token.test.ts`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/auth/auth-service.integration.test.ts`

**Step 1: 写认证失败测试**

覆盖：正确密码、错误密码、大小写归一化登录名、停用账号、过期会话、已撤销会话、`session_epoch` 不一致、首次登录改密标记、连续失败限速。

**Step 2: 实现密码规则**

- 使用 Argon2id。
- 密码最少 12 个字符。
- 不记录明文密码、密码长度或密码错误内容到审计详情。
- 修改密码后 `session_epoch + 1`，撤销旧会话。

**Step 3: 实现会话规则**

- 生成 32 字节随机令牌，只将 SHA-256 加 pepper 后的哈希写库。
- Cookie：`HttpOnly`、`Secure`（生产）、`SameSite=Lax`、`Path=/`。
- 普通会话 12 小时；每次受保护请求校验账号仍激活、会话未撤销、未过期、epoch 一致。
- 页面读取身份使用 `currentSession()`；业务写操作必须调用 `requirePermission()`。

**Step 4: 实现登录交互**

登录页字段只有登录名、密码和登录按钮。错误统一显示“登录名或密码不正确”；停用状态不向未登录者泄露。成功后按角色进入工作台。

**Step 5: 验证**

Run:

```bash
pnpm test src/modules/auth
pnpm typecheck
pnpm lint
```

Expected: 所有认证测试通过。

**Step 6: 提交**

```bash
git add src/modules/auth src/app/login src/app/logout
git commit -m "feat: implement secure account sessions and login"
```

## Task 5：实现角色权限与服务端授权

**Files:**

- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/permissions/permissions.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/permissions/require-permission.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/permissions/role-navigation.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/(protected)/layout.tsx`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/(protected)/dashboard/page.tsx`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/(protected)/forbidden/page.tsx`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/permissions/permissions.test.ts`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/permissions/require-permission.integration.test.ts`

**Step 1: 写角色矩阵失败测试**

阶段 1 权限矩阵：

| 权限 | 超级管理员 | 前台 | 老板 | 维修工 |
|---|---:|---:|---:|---:|
| 登录 | 是 | 是 | 是 | 是 |
| PC 工作台 | 是 | 是 | 是 | 否 |
| 读取全部业务 | 是 | 是 | 是 | 否 |
| 修改基础资料 | 是 | 是 | 否 | 否 |
| 管理账号与角色 | 是 | 否 | 否 | 否 |
| 执行敏感操作 | 是 | 后续按授权 | 否 | 否 |
| 进入维修工手机端 | 否 | 否 | 否 | 是 |

**Step 2: 实现显式权限常量**

角色只映射到权限标识。页面导航从权限生成，但业务服务再次调用 `requirePermission()`；直接请求服务端地址时仍然拒绝越权。

**Step 3: 实现受保护布局**

- 未登录跳转 `/login`。
- 维修工访问 PC 工作台返回明确无权限页面，不暴露 PC 业务数据。
- 老板页面显示只读标记，所有写操作服务端返回 403。

**Step 4: 验证**

Run:

```bash
pnpm test src/modules/permissions
pnpm typecheck
```

Expected: 角色矩阵和直接越权请求测试通过。

**Step 5: 提交**

```bash
git add src/modules/permissions 'src/app/(protected)'
git commit -m "feat: enforce formal system role permissions"
```

## Task 6：实现超级管理员初始化、账号管理和会话失效

**Files:**

- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/scripts/create-super-admin.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/accounts/account-service.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/accounts/account-schemas.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/(protected)/settings/accounts/page.tsx`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/(protected)/settings/accounts/actions.ts`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/accounts/account-service.integration.test.ts`

**Step 1: 写账号生命周期失败测试**

覆盖创建账号、重复登录名、修改显示名、修改角色、停用、重置密码、强制全部会话失效、禁止删除最后一个激活超级管理员。

**Step 2: 实现第一个超级管理员命令**

命令从交互式终端读取显示名、登录名和密码；密码输入不回显。仅当数据库没有超级管理员时允许创建；成功后输出账号名，不输出密码或哈希。

Run interface:

```bash
pnpm account:create-super-admin
```

**Step 3: 实现账号管理页面**

超级管理员可新增前台、老板、维修工和另一超级管理员账号；可停用、改角色、重置密码、强制退出。阶段 2 再把维修工账号绑定员工档案。

**Step 4: 验证**

Run:

```bash
pnpm test src/modules/accounts
pnpm typecheck
pnpm lint
```

Expected: 生命周期测试通过；最后一个超级管理员无法停用或降级。

**Step 5: 提交**

```bash
git add scripts src/modules/accounts 'src/app/(protected)/settings/accounts' package.json
git commit -m "feat: add super admin bootstrap and account management"
```

## Task 7：建立统一审计写入与查询

**Files:**

- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/audit/audit-types.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/audit/audit-service.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/audit/redact-sensitive.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/(protected)/settings/audit/page.tsx`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/audit/audit-service.integration.test.ts`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/modules/audit/redact-sensitive.test.ts`

**Step 1: 写不可改写审计测试**

覆盖登录成功/失败摘要、退出、创建账号、改角色、停用、重置密码和强制会话失效。断言审计中不出现明文密码、会话令牌、数据库连接串或上传文件内容。

**Step 2: 实现事务内审计接口**

```ts
type AuditInput = {
  actorAccountId: string | null;
  eventType: string;
  objectType: string;
  objectId: string;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  requestId: string;
};
```

需要改业务状态的服务必须在同一数据库事务中写业务事实和审计事实；任一失败则全部回滚。

**Step 3: 实现只读审计页**

超级管理员和老板可按日期、操作人、事件类型、对象编号查询；前台只读取后续日报授权范围内的敏感记录；维修工无入口。

**Step 4: 验证与提交**

Run:

```bash
pnpm test src/modules/audit
pnpm typecheck
git add src/modules/audit 'src/app/(protected)/settings/audit'
git commit -m "feat: add append-only audited operations"
```

## Task 8：建立生产容器、HTTPS 和持久卷

**Files:**

- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/Dockerfile`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/compose.yaml`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/compose.production.yaml`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/deploy/Caddyfile`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/deploy/env.production.example`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/deploy/README.md`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/src/app/api/version/route.ts`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/scripts/verify-compose.sh`

**Step 1: 实现多阶段 Dockerfile**

- Node 22 镜像安装固定 lockfile 依赖。
- 构建 Next.js standalone 输出。
- 运行镜像使用非 root 用户。
- 镜像内不包含 `.env`、测试附件、Git 历史或数据库备份。

**Step 2: 实现 Compose 服务**

- `web`：只暴露到 Compose 内网，挂载附件持久卷。
- `db`：PostgreSQL 18，挂载数据库持久卷，不映射公网端口。
- `caddy`：唯一公网 80/443，自动 HTTPS，反向代理到 `web`。
- 健康检查以 `/api/health/ready` 判断应用就绪。
- 生产覆盖文件设置重启策略、资源限制和日志轮转。

**Step 3: 写服务器目录约定**

```text
/srv/wholehearted/app       发布包
/srv/wholehearted/data      PostgreSQL 数据卷
/srv/wholehearted/uploads   图片、签字、凭证和打印归档
/srv/wholehearted/backups   本机备份暂存
/etc/wholehearted/app.env   生产密钥与连接配置
```

**Step 4: 验证容器定义**

在具有 Docker 的环境运行：

```bash
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose -f compose.yaml -f compose.production.yaml build
docker compose -f compose.yaml -f compose.production.yaml up -d
test -n "$WH_DOMAIN"
curl --fail "https://$WH_DOMAIN/api/health/ready"
```

Expected: Compose 配置和构建通过，只有 80/443 对公网开放，健康检查返回 200。

**Step 5: 提交**

```bash
git add Dockerfile compose.yaml compose.production.yaml deploy src/app/api/version scripts/verify-compose.sh
git commit -m "ops: add production container and HTTPS deployment"
```

## Task 9：建立数据库与附件备份恢复

**Files:**

- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/scripts/backup-database.sh`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/scripts/backup-uploads.sh`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/scripts/restore-database.sh`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/scripts/verify-backup.sh`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/deploy/systemd/wholehearted-backup.service`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/deploy/systemd/wholehearted-backup.timer`
- Test: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/scripts/backup-restore.acceptance.sh`

**Step 1: 写备份脚本安全检查**

- 明确验证目标只能在 `/srv/wholehearted/backups` 下。
- 使用时间戳目录，不覆盖已有备份。
- 数据库使用自定义格式 `pg_dump`；附件使用增量归档。
- 记录校验和，不在日志中输出密码。
- 保留 30 天；删除前验证目标绝对路径。

**Step 2: 写恢复脚本**

恢复必须指定一个明确备份目录和一个空测试数据库。脚本拒绝把恢复目标指向未确认的生产数据库；正式恢复需要显式 `--production-confirmed`。

**Step 3: 运行恢复验收**

```bash
scripts/backup-restore.acceptance.sh
```

Expected:

- 新建一条测试账号事实。
- 生成数据库与附件备份。
- 恢复到空数据库和空附件目录。
- 账号数量、审计数量、附件校验和完全一致。

**Step 4: 提交**

```bash
git add scripts deploy/systemd
git commit -m "ops: add verified database and attachment backups"
```

## Task 10：完成阶段 1 浏览器验收

**Files:**

- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/tests/e2e/login.spec.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/tests/e2e/roles.spec.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/tests/e2e/persistence.spec.ts`
- Create: `/Volumes/公司文件/Whole Hearted Car Service 正式系统/docs/acceptance/phase-1-results.md`

**Step 1: 写端到端验收**

验证：

1. 创建唯一超级管理员并首次改密。
2. 新建前台和老板账号。
3. 前台可以进入 PC 工作台。
4. 老板可以读取但不能提交任何写操作。
5. 维修工账号不能进入 PC 工作台。
6. 停用账号后现有会话立即失效。
7. 重启 Web 容器后账号、会话规则和审计仍存在。
8. 直接调用无权限服务端地址返回 403。
9. 健康检查、版本接口和审计查询可用。

**Step 2: 运行完整门禁**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
scripts/backup-restore.acceptance.sh
```

Expected: 所有命令退出码为 0；无跳过测试；浏览器没有控制台错误。

**Step 3: 人工浏览器验收**

在内置浏览器实际操作登录、建账号、改角色、停用、强制退出和老板越权。记录真实 URL、页面标题、服务器版本、数据库迁移版本和截图到 `phase-1-results.md`。

**Step 4: 阶段提交**

```bash
git add tests/e2e docs/acceptance/phase-1-results.md
git commit -m "test: verify formal platform authentication and persistence"
```

## 阶段 1 完成标准

- 用户能通过正式域名登录。
- 超级管理员、前台、老板和维修工角色边界真实生效。
- 账号和审计数据写入 PostgreSQL，刷新、退出和重启后不丢失。
- 生产数据库不暴露公网；HTTPS 生效。
- 备份可以恢复，不只生成文件。
- 所有自动测试与人工浏览器验收有结果记录。
- 阶段 2 可在此基础上直接增加字典、班组、员工、客户、公司和车辆，而不重写身份与数据库基础。
