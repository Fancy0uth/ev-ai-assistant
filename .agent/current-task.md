# TASK-V0.6-SOL-REREVIEW-P1-REPAIR：主 Agent 全矩阵 PASS，等待 Sol 复审

## 当前目标

Sol rereview 指定的三个 P1 已在未提交工作树中按 TDD 定点实现：WebP 必须含真实 image-bearing payload；`DELETE_PENDING` artifact 可在启动时 Owner-safe 恢复；browser extract/confirm 在不确定写入结果下分别复用语义幂等键和完全相同 body。主 Agent 已独立完成代码复核、根测试、全仓 typecheck/lint/build、完整 E2E 8/8 与静态完整性检查，全部达到准入门槛。当前只等待原子提交和全新 Sol 整版复审。

## 本轮边界

- 未实现 rereview 的六个 P2，未扩大 API/contracts/schema。
- migrations 与两份不可变 FAIL review 零差异。
- 未运行真实 Vision/Search/DeepSeek/network：`NOT RUN — APPROVAL REQUIRED`。
- 主 Agent 已运行 full E2E/build；真实 Provider 成功链路仍保留为明确证据债，不用 Fake 代替。

## 本轮根因与最小修复

- `buildApp` 的 `providerReliabilityNow` 已用于 execution/idempotency/daily planning service，但没有传给 preflight service，导致测试 preflight 使用真实 2026-08-31 时间，而 recovery sweep 使用固定 2026-08-24 时间。仅在 option 存在时把同一 `now` 注入 `createDailyPlanPreflightService`；生产默认仍使用真实 `new Date()`。
- `database.test.ts` 的当前迁移数和两个 frozen ordered list 停在 v18；精确更新到 v19 `add_v06_learning_schedule_loop`，未弱化顺序断言。
- 三个 v0.5 测试把当前 app version 硬编码为 0.5.0；改为从 `@ev/contracts` 引用当前 `APP_VERSION`。
- 两个 Web CSS 测试原先只截取最后一个 42rem media block；改为在测试内收集全部完整 42rem block，selectors/断言和产品 CSS 不变。
- 三个 Playwright config 动态 import 测试各使用有限的 15 秒单项 timeout；断言和生产 Playwright config 不变。
- Tasks 编辑保存测试原先仅等待第三次 fetch，早于 reload 后 focus effect 稳定提交；保留精确 `toHaveFocus`，仅用默认 `waitFor` 等待该真实行为。
- 保存后任务离开筛选页的 heading fallback 测试具有相同时序；同样只等待精确 heading focus，取消编辑的同步 focus 断言保持不变。
- 未修改 recovery service、v17 trigger、迁移 SQL、Provider adapter、产品合同、Web 产品 CSS/组件或 Playwright 生产配置。

## RED / GREEN

```powershell
npm test --workspace @ev/core -- tests/v0.5-recovery-sweeper.test.ts
# RED: 2 failed / 3 passed
# GREEN: 5 passed / 5

npm test --workspace @ev/core -- tests/database.test.ts tests/daily-planning-service.test.ts tests/v0.5-provider-lease.test.ts tests/v0.5-reliability-repository.test.ts tests/v0.5-recovery-sweeper.test.ts
# PASS: 5 files / 24 tests

npm test --workspace @ev/core
# PASS: 45 files / 297 tests

npm run typecheck --workspace @ev/core
npx eslint apps/core/src/app.ts apps/core/tests/database.test.ts apps/core/tests/daily-planning-service.test.ts apps/core/tests/v0.5-provider-lease.test.ts apps/core/tests/v0.5-reliability-repository.test.ts
# PASS

npm test --workspace @ev/web -- tests/daily-plan-workspace.test.tsx tests/v0.4-scheduling-workspaces.test.tsx tests/playwright-config.test.ts
# RED: 2 failed / 61 passed；首轮取样修正 1 failed / 62 passed
# GREEN: 3 files / 63 tests

npm test --workspace @ev/web
# PASS: 21 files / 239 tests

npm run typecheck --workspace @ev/web
npx eslint apps/web/tests/daily-plan-workspace.test.tsx apps/web/tests/v0.4-scheduling-workspaces.test.tsx apps/web/tests/playwright-config.test.ts
# PASS

npm test --workspace @ev/web -- tests/tasks-workspace.test.tsx -t "edits a task with its current version and returns focus to the edit control"
# PASS: 连续三次，每次 1/1

npm test --workspace @ev/web -- tests/tasks-workspace.test.tsx
# PASS: 43/43

npm test --workspace @ev/web -- tests/tasks-workspace.test.tsx -t "edits a task with its current version and returns focus to the edit control|moves focus to the stable Tasks heading when a saved task disappears from the filtered page"
# PASS: 连续三次，每次 2/2

npx eslint apps/web/tests/tasks-workspace.test.tsx
# PASS
```

## 主 Agent 最终独立矩阵

`npm test` 中 legacy 5/5、Core 301/301、Web 242/242、Contracts 77/77、Domain 7/7 全部通过；`npm run typecheck`、`npm run build`、完整 `npm run test:e2e` 8/8 均真实 exit 0。`npm run lint` 为 0 error、4 个未改动 v0.5 测试的既有 warning。`git diff --check`、新报告行尾检查、migration/immutable review zero-diff、5 个 tracked package version=0.6.0、生产源码常见凭据字面量扫描和 `next-env.d.ts` 基线检查全部通过。Git 未暂存、未提交；真实 Provider/network 未运行。
