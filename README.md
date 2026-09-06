# Whole Hearted Car Service

汽车维修业务管理系统，采用 Next.js、React、PostgreSQL 和 Drizzle。当前开发主线位于 `codex/ai-service-wip-20260827`。

## 程序员审查入口

本分支保存截至 2026-09-06 的候选实现与审查材料，处于上线前审查阶段。

1. [本次 GitHub 检查点、验证结果与接手说明](docs/qa/2026-09-06-github-review-checkpoint.md)
2. [程序员审查入口：模块调用链与风险清单](docs/qa/2026-09-05-programmer-review-entrypoint.md)
3. [核心业务路径完成度与剩余问题](docs/qa/2026-09-05-core-paths-closure-audit.md)
4. [上线实施总计划](docs/superpowers/plans/2026-09-05-production-launch-master-plan.md)
5. [跨会话交接与历史验证记录](docs/CONTINUATION_ENTRYPOINT.md)

## 代码导航

- `apps/web`：当前候选应用界面、正式 API 适配与单进程入口。
- `src/modules`：业务服务、权限、金额计算与审计。
- `src/db` 和 `drizzle`：数据结构与数据库迁移。
- `apps/web/tests/components`：真实组件的隔离交互测试。
- `docs/qa`：验收记录、已知缺口及审查顺序。

正式候选代码与历史 Mock 实现仍共存，请按审查入口确认各页面的实际调用链。仓库中的历史业务基线存在未批准条款；业务判断须结合当前已批准要求和已知规则冲突。

## 本地检查

运行环境要求见根 `package.json`；依赖锁定文件为 `pnpm-lock.yaml`。

```sh
git clone --branch codex/ai-service-wip-20260827 https://github.com/vicechancellor9999/whole-hearted-car-service.git
cd whole-hearted-car-service
pnpm install --frozen-lockfile
pnpm --dir apps/web test:workspace --maxWorkers=2
pnpm --dir apps/web exec tsc --noEmit --incremental false
pnpm exec tsc --noEmit --incremental false
```

2026-09-06 的根目录类型检查存在已记录错误，详见检查点说明。运行应用前请先审查 `scripts/dev-unified.ts`、环境变量示例与迁移逻辑，在独立数据库中准备测试账号和样例数据。当前机器的运行数据库、附件及凭据另行保管。
