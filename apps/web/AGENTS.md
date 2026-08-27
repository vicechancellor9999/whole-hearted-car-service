# apps/web 正式应用边界

## 当前定位

- 本目录保存用户确认的 3210 PC 界面，是 Whole Hearted 唯一 Web 应用源码。
- 页面、菜单、打印样式和交互以当前 3210 为验收基线。
- 正式会话、权限、领域服务、PostgreSQL 和附件能力通过仓库根目录 `src/*` 服务端模块接入同一个 Next.js 进程。

## 开发前读取

开发前按以下顺序读取根目录文件：

1. `../../docs/CONTINUATION_ENTRYPOINT.md`
2. `../../docs/superpowers/specs/2026-08-27-3210-canonical-single-app-design.md`
3. 根目录 `AGENTS.md` 中的 Next.js 16 规则
4. 根目录 `node_modules/next/dist/docs/` 下与改动相关的版本文档

## 代码边界

- 前端 `@/*` 只指向本目录 `src/*`。
- 正式服务端 `@formal/*` 只指向仓库根目录 `src/*`，不得从客户端组件导入。
- `/api/formal/*` 是同应用兼容接口，直接调用正式 handler/service，不得通过 HTTP 请求本机其他端口。
- PostgreSQL 是正式业务事实来源；localStorage 只保存主题、语言、折叠状态等界面偏好。
- 正式身份、角色、权限和业务记录不得回落到 Mock。
- 所有写入入口继续执行服务端会话、权限、审计和事务校验。
