# TASK-V6-04：引用学习建议、排程与 0.6.0（待主 Agent 原子提交）

## 当前目标

V6-04 已完成实现、TDD、Sol 身份修复与冻结验证矩阵；等待主 Agent 创建指定原子提交 `feat(learning): schedule cited study actions`。不得在此工作树执行 `git add` 或 `git commit`。

## 执行基线

- 产品比较 BASE：`155b172de91a62feb2762469536555f9a6b2b025`
- 运行时代码 BASE：`d5d4ea5`
- 直接前置：V6-01 `8ee52e1`、V6-02 `4b4e218`、V6-03 `b99fdce`。
- 固定计划：`docs/superpowers/plans/2026-08-23-v0.6-learning-schedule-loop.md` 的 V6-04。

## 已实现闭环

- Citation 在生成 LearningAdvice 前重新 fetch 并校验 immutable hash；变更或无法校验时 fail closed。Search 未配置时保持 `BLOCKED_PROVIDER`；DeepSeek 文本建议仅在该 Owner 的非敏感凭据 metadata 已配置后进入 disclosure，测试不打开真实 socket。
- 生产默认使用现有 `providerCredentialService.withApiKey` 在 claim transaction 提交后临时创建 text-only DeepSeek adapter；key 不进入 payload、SQLite、response 或 observer，SecretStore/adapter/CredentialNotConfigured 均稳定映射 503。显式 `learningAdviceCapability` TEST_FAKE 仍优先且受三重门控制。
- capability evidence 仅由实际 terminal success 产生：production Vision/Search/Learning 的 preflight 为 `NONE`，真实 adapter 成功才 `REAL_PROVIDER`，TEST_FAKE 成功为 `AUTOMATED_FAKE`；失败不升级证据。Learning 的 CredentialNotConfigured/SecretStore/factory.create 为 0 calls，进入 generate 后失败为 1；Vision 前置读取失败为 0、strict provider output failure 为 1。
- 严格 `CITED_LEARNING_ADVICE_V1` 仅创建 LEARNING Proposal；ACCEPT 单一 SQLite transaction 创建 course-linked Learning Action、citation lineage 与 ACTIVE TimeRequest，REJECT、重放、并发、跨 Owner 和失败回滚均不产生部分事实。
- 既有 Daily Plan 消费 TimeRequest，Today 以既有 Action/TimeRequest lineage 只读聚合 `courseId`；未改 `events` schema 或 migration v19。
- Course detail、Provider settings 与 Today Web 显示正确的 BLOCKED/Fake 状态和 course/action lineage；E2E 使用 runner-owned 临时目录并保持三重 Fake 门。
- Sol 返回 Terra 后，V6 E2E 从 Core response 捕获并校验 `courseId → actionId → timeRequestId → scheduledEventId` UUID lineage：desktop 后同名 Action/Event 各 1，iPhone 后各 2，实际 ID 集合与两轮 response 捕获集合完全一致。
- 所有 workspace package、锁文件、`APP_VERSION`、health/run metadata 与 CHANGELOG 对齐 `0.6.0`；旧 migration 历史 app_version 不重写。

## GREEN 命令

```powershell
npm test --workspace @ev/contracts -- tests/courses.test.ts tests/calendar-proposals.test.ts tests/providers.test.ts
# PASS: 3 files / 25 tests
npm test --workspace @ev/core -- tests/course-import.test.ts tests/calendar-repository.test.ts tests/learning.test.ts tests/public-resource-fetcher.test.ts tests/proposal-api.test.ts tests/today.test.ts tests/migrations.test.ts tests/v0.5-reliability-storage.test.ts tests/v0.6-capability-gate.test.ts
# PASS: 9 files / 43 tests
npm test --workspace @ev/web -- tests/core-client.test.ts tests/core-bff-idempotency.test.ts tests/schedule-workspace.test.tsx tests/learning-workspace.test.tsx tests/course-detail-workspace.test.tsx tests/provider-settings.test.tsx tests/today-dashboard.test.tsx
# PASS: 7 files / 47 tests
npm run typecheck
# PASS: 4 workspaces
npx eslint [V6-04 focused files and apps/web/e2e/v0.6-learning-loop.spec.ts]
# PASS
npm run build --workspace @ev/web
# PASS
npm run test:e2e -- e2e/v0.6-learning-loop.spec.ts
# PASS: 1/1
git diff --check
git diff --exit-code -- apps/core/src/storage/migrations.ts
# PASS (v19 and migrations.ts unchanged)
```

## 交接记录

P0=0、P1=0。完整逐项断言映射见 `.agent/reports/v0.6-v6-04.md`；Sol 升级包与返回决策保留在 `.agent/reports/v0.6-v6-04-sol-upgrade.md`、`.agent/reports/v0.6-v6-04-sol-escalation-decision.md`。真实 Vision/Search/DeepSeek 成功 smoke 仍为 `NOT RUN — APPROVAL REQUIRED`。没有真实 Provider、socket、真实凭据、依赖安装、用户 `EV_DATA_DIR`、Git staging 或提交操作。主 Agent 提交 V6-04 后，仍需按冻结流程进行一次整版 Sol 里程碑审查。
