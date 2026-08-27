# WorkBuddy 迁移校验

迁移时间：2026-08-08
基线提交：`f7d3843e074a6d5938937410dad05f6da499231a`

## 校验项

- [x] `/Volumes/公司文件` 已挂载且可写
- [x] 共享仓库目录结构已创建：main/、workbuddy/、codex/、snapshots/、.cache/npm/
- [x] WorkBuddy 工作区已切换为 `agent/workbuddy` 分支
- [x] 原入口 `/Users/lijianfu/WorkBuddy/2026-08-08-15-08-53/whole-hearted` 已替换为指向外置卷的软链接
- [x] 依赖（node_modules）和本地环境变量（.env.local）已恢复
- [x] `npm run build` 通过
- [x] dev server 可从共享仓库启动并正常服务 http://localhost:3000
- [x] 进程工作目录确认位于 `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/workbuddy/whole-hearted`

## 端口约定

- WorkBuddy：3000
- Codex：3001
- 集成检查：3002
