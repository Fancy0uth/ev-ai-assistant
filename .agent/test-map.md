# v0.7 Sol P1 remediation final matrix (2026-08-31 Asia/Shanghai)

| Layer | Exact command | Exit / count |
| --- | --- | --- |
| Root tests | `npm test` | 0; Legacy 7/7, Core 350/350, Web 246/246, Contracts 85/85, Domain 11/11 |
| Type safety | `npm run typecheck` | 0; Core/Web/Contracts/Domain passed |
| Lint | `npm run lint` | 0; 0 errors, 4 unchanged warnings in `v0.5-recovery-sweeper.test.ts` |
| Build | `npm run build` | 0; Next production build passed, generated `next-env.d.ts` restored |
| Browser | `npm run test:e2e -- e2e/v0.7-health-loops.spec.ts` | 0; 1/1 passed, test 12.3 s / total 15.6 s |
| Execution-range whitespace | `git diff --check 37982d8..HEAD` | 0; no output |
| Lineage-range whitespace | `git diff --check 785b7b6..HEAD` | 0; no output |
| Matrix-end status | `git status --short` | 0; empty before handoff document updates |

First final-root attempt: `npm test` exit 1. Legacy 7/7 passed; Core was 12 failed / 338 passed; Web 246/246, Contracts 85/85, Domain 11/11 passed. The first Core assertion was `database.test.ts` expecting migration count 20 while v21 was current; the product failures were the v21 trigger detecting initial parent rows that carried a not-yet-inserted current revision. Focused repair over `database.test.ts`, `v0.7-fitness-loop.test.ts`, `v0.7-nutrition-loop.test.ts`, and `v0.7-workout-proposal.test.ts` then passed 4 files / 23 tests.

Focused remediation evidence:

- AUTH/FIXTURE: RED 4 failed / 4 passed; GREEN 8/8.
- IDEM: RED 6 failed / 10 passed; GREEN 17/17.
- PROVIDER: RED 4/4 failed; GREEN 3 files / 15 tests.
- DECIMAL: RED Contracts 1 failed / 6 passed, Domain 1 failed / 3 passed, Core 2 failed / 5 passed; GREEN 7/7, 4/4, 7/7.
- MIGRATION: RED 8/8 failed and all 30 cross-Owner probes were accepted by v20; GREEN corrective+legacy migration tests 16/16.
- LINEAGE/EVIDENCE: RED Core 2/2 failed and runner 1/3 failed; GREEN Core composition/evidence 11/11 and runner 4/4.
- REPORT: both baseline diff-checks RED on exactly two trailing-space lines; final range commands GREEN.

# V7 Terra 最终验证状态（pre-Sol-remediation historical section）

| 层级 | 命令/范围 | 真实结果 |
| --- | --- | --- |
| V7 focused | Contracts/Core/Web 每任务指定测试、affected typecheck、focused lint、diff check | V7-01..V7-07 均 PASS；详见执行报告 |
| authorized gate fix | Contracts `providers.test.ts` + Core `learning.test.ts` | RED 各 1 failed；Green 为 15/15 + 12/12，独立提交 `76257a8` |
| V7 browser | `npm run test:e2e -- e2e/v0.7-health-loops.spec.ts` | 1/1 PASS，exit 0（版本末复跑 35.0 s） |
| version-end root test | `npm test` | 受限环境重跑 exit 0：Legacy 5/5、Core 317/317、Web 246/246、Contracts 85/85、Domain 11/11；首次普通沙箱 run 为 `%TEMP%` cleanup EPERM，不是产品断言 |
| version-end remaining | build、two-baseline diff、final status | build exit 0；`37982d8..HEAD` 与 `785b7b6..HEAD` diff check exit 0；status 仅四份交接文档 |
| real-provider smoke | 外部营养/动作数据源、凭据、个人数据 | `NOT RUN — APPROVAL REQUIRED` |

# 测试层级映射

## check_fast

命令：

```powershell
npm test --workspace <受影响 workspace> -- <精确测试文件>
npm run typecheck --workspace <受影响 workspace>
npx eslint <明确列出的改动文件>
git diff --check
```

覆盖范围：当前任务的成功路径、关键边界、主要失败路径和受影响 workspace 类型安全。

预计耗时：通常 10–90 秒。

## check_task

命令：

```powershell
npm test --workspace @ev/contracts -- tests/courses.test.ts
npm test --workspace @ev/core -- tests/course-import.test.ts tests/learning.test.ts tests/provider-credential-service.test.ts tests/migrations.test.ts
npm test --workspace @ev/web -- tests/learning-workspace.test.tsx tests/schedule-workspace.test.tsx
npm run typecheck
npm run build --workspace @ev/web
npm run test:e2e -- e2e/v0.6-learning-loop.spec.ts
```

覆盖范围：v0.6 契约、迁移、课程导入、公开资料、Web 交互和一条关键浏览器闭环。计划冻结后可按真实文件名收窄或修正。

预计耗时：约 2–6 分钟。

## V6-04 已执行证据

```powershell
npm test --workspace @ev/contracts -- tests/courses.test.ts tests/calendar-proposals.test.ts tests/providers.test.ts
npm test --workspace @ev/core -- tests/course-import.test.ts tests/calendar-repository.test.ts tests/learning.test.ts tests/public-resource-fetcher.test.ts tests/proposal-api.test.ts tests/today.test.ts tests/migrations.test.ts tests/v0.5-reliability-storage.test.ts tests/v0.6-capability-gate.test.ts
npm test --workspace @ev/web -- tests/core-client.test.ts tests/core-bff-idempotency.test.ts tests/schedule-workspace.test.tsx tests/learning-workspace.test.tsx tests/course-detail-workspace.test.tsx tests/provider-settings.test.tsx tests/today-dashboard.test.tsx
npm run typecheck
npx eslint [V6-04 focused files and apps/web/e2e/v0.6-learning-loop.spec.ts]
npm run build --workspace @ev/web
npm run test:e2e -- e2e/v0.6-learning-loop.spec.ts
git diff --check
git diff --exit-code -- apps/core/src/storage/migrations.ts
```

已验证：immutable citation hash/refetch、Owner credential metadata→READY disclosure→一次 DeepSeek text adapter、缺失 credential→BLOCKED/零 call、SecretStore/adapter/CredentialNotConfigured 的稳定 503、解密/模型事务外和 key 不入可见 persistence/response、strict Learning Proposal、ACCEPT 原子 Action/TimeRequest、Today course/action lineage、三重 Fake 门、0.6.0 版本一致性，以及同一 Owner 两轮 desktop/iPhone 实际 Core response UUID lineage 的精确集合。最后 capability P1 另证明 production preflight evidence=NONE、仅成功 terminal 按实际 adapterKind 写 REAL_PROVIDER/AUTOMATED_FAKE、Learning 的 credential/unprotect/factory=0 calls 与 generate failure=1、Vision runner-owned artifact read failure=0 与 strict output failure=1。结果：原矩阵 Contracts 25/25、Core 43/43、Web 47/47、E2E 1/1；P1 focused Core 16/16、Contracts 25/25，其余命令 PASS。真实 Provider smoke 不属于自动层，保持 `NOT RUN — APPROVAL REQUIRED`。

## v0.6 Sol P1 修复已完成证据

状态：Terra 第 2（最终允许）轮的 focused 修复已完成，等待主 Agent 执行整版全矩阵并发起 Sol 复审。

```powershell
npm test --workspace @ev/core -- tests/v0.6-capability-gate.test.ts
npm test --workspace @ev/core -- tests/course-import.test.ts
npm test --workspace @ev/core -- tests/learning.test.ts
npm run typecheck --workspace @ev/core
npx eslint apps/core/src/modules/calendar/image-metadata.ts apps/core/src/modules/calendar/import-repository.ts apps/core/src/modules/calendar/import-service.ts apps/core/src/modules/learning/deepseek-learning-advice.ts apps/core/src/modules/learning/public-resource-fetcher.ts apps/core/src/modules/learning/service.ts apps/core/src/modules/providers/capabilities.ts apps/core/src/modules/providers/capability-run-repository.ts apps/core/src/modules/providers/provider-policy.ts apps/core/tests/course-import.test.ts apps/core/tests/learning.test.ts apps/core/tests/v0.6-capability-gate.test.ts
git diff --check
```

最新结果：capability gate 8/8、course import 7/7、learning 11/11、Core typecheck、focused ESLint 和 diff check 均通过。主 Agent 另独立复核 course import 7/7，包含 Vision 第 21 次路由拒绝与 WebP padding guard。跨日配额测试证明 run 可在 2026-08-31 创建并在 2026-09-01 claim；claim 按 `now` 的 Asia/Shanghai 执行日查询与落盘，8 月 31 日用量不阻塞 9 月 1 日，而 9 月 1 日第 21 次在 adapter 前拒绝。迁移保持零差异。

## v0.6 主 Agent 全矩阵集成修复证据

```powershell
npm test --workspace @ev/core -- tests/v0.5-recovery-sweeper.test.ts
npm test --workspace @ev/core -- tests/database.test.ts tests/daily-planning-service.test.ts tests/v0.5-provider-lease.test.ts tests/v0.5-reliability-repository.test.ts tests/v0.5-recovery-sweeper.test.ts
npm test --workspace @ev/core
npm test
npm run typecheck --workspace @ev/core
npx eslint apps/core/src/app.ts apps/core/tests/database.test.ts apps/core/tests/daily-planning-service.test.ts apps/core/tests/v0.5-provider-lease.test.ts apps/core/tests/v0.5-reliability-repository.test.ts
npm test --workspace @ev/web -- tests/daily-plan-workspace.test.tsx tests/v0.4-scheduling-workspaces.test.tsx tests/playwright-config.test.ts
npm test --workspace @ev/web
npm run typecheck --workspace @ev/web
npx eslint apps/web/tests/daily-plan-workspace.test.tsx apps/web/tests/v0.4-scheduling-workspaces.test.tsx apps/web/tests/playwright-config.test.ts
npm test --workspace @ev/web -- tests/tasks-workspace.test.tsx -t "edits a task with its current version and returns focus to the edit control"
npm test --workspace @ev/web -- tests/tasks-workspace.test.tsx -t "edits a task with its current version and returns focus to the edit control|moves focus to the stable Tasks heading when a saved task disappears from the filtered page"
npm test --workspace @ev/web -- tests/tasks-workspace.test.tsx
npx eslint apps/web/tests/tasks-workspace.test.tsx
git diff --check
git diff --exit-code -- apps/core/src/storage/migrations.ts
git diff --exit-code -- docs/reviews/2026-08-23-v0.6-sol-smoke-review.md
```

结果：recovery RED 2/5 failed，composition 修复后 5/5；五文件 focused 24/24；Core full 297/297；Core typecheck 与 focused ESLint PASS。随后 Web 三文件 RED 为 2 failed / 61 passed，首轮简单取样修正仍为 1 failed / 62 passed；使用完整 media block 收集并给三个动态配置测试设置有限单项 timeout 后，三文件 63/63、Web full 239/239、Web typecheck 与 focused ESLint 均 PASS。Tasks 两处 post-save focus act 时序 flaky 均保持精确 `toHaveFocus` 并使用默认 `waitFor`；两个测试一起连续三次各 2/2、Tasks 全文件 43/43 PASS，取消编辑同步断言未改。最终根 `npm test` 为 legacy 5/5、Core 297/297、Web 239/239、Contracts 77/77、Domain 7/7 PASS，真实 exit 0。E2E/build 未运行。

## v0.6 全套 E2E 最小修复证据

```powershell
npm run test:e2e -- e2e/owner-task-dashboard.spec.ts
npm run test:e2e -- e2e/v0.4-ui-origin-scheduling.spec.ts
npm run test:e2e -- e2e/v0.6-learning-loop.spec.ts
npm run test:e2e
```

结果：三个 focused spec 各 1/1 PASS；全套 6/8、真实 exit 1。owner 的真实 Tab 顺序已通过，v0.4/v0.6 的共享 Owner 认证不再 401。剩余失败为 v0.4 在共享 runner dir 读取到前序三条 Fake evidence，以及 v0.6 严格浏览器问题断言捕获 422 console error。按用户停止条件未继续修改，也未运行后续 Web typecheck、focused ESLint、diff-check 或 build。

## v0.6 trace 定点 E2E 修复证据

```powershell
npm run test:e2e -- e2e/v0.4-ui-origin-scheduling.spec.ts
npm run test:e2e -- e2e/v0.6-learning-loop.spec.ts
npm run test:e2e
```

结果：focused v0.4 1/1、focused v0.6 1/1 PASS。完整矩阵中 v0.4 通过，证明完整 baseline 等式、唯一 invocation 追加及 excluded Task versioned CANCELLED cleanup 生效；全套为 7/8、真实 exit 1。新首个失败是 v0.6 desktop `applyDailyPlan` proposal decision POST 返回 422（期望 200），浏览器附件无 console warning/error。按停止条件未检查新 trace，未运行后续 typecheck、ESLint、diff-check 或 build。

## v0.6 固定学习窗口定点修复证据

```powershell
npm run test:e2e -- e2e/v0.6-learning-loop.spec.ts
npm run test:e2e
```

结果：仅将 v0.6 desktop/iPhone 的 60 分钟学习窗口改为 16:00–17:00、18:00–19:00 后，focused v0.6 1/1 PASS、exit 0。完整矩阵中 v0.4 通过，但总计 7/8、真实 exit 1；新首个失败是 v0.6 `applyDailyPlan` 对 Fake 摘要的严格文本 locator 同时解析到两个元素，Playwright 在 decision 前停止。两个浏览器附件均无 console warning/error。按停止条件未修改 locator，未运行后续 Web typecheck、focused ESLint、diff-check、migration/review checks 或 build。真实 Provider/network 仍为 `NOT RUN — APPROVAL REQUIRED`。

## v0.6 pending proposal card locator GREEN 证据

```powershell
npm run test:e2e -- e2e/v0.6-learning-loop.spec.ts
npm run test:e2e
npm run typecheck --workspace @ev/web
npx eslint apps/web/e2e/v0.4-ui-origin-scheduling.spec.ts apps/web/e2e/v0.6-learning-loop.spec.ts
git diff --check
git diff --exit-code -- apps/core/src/storage/migrations.ts
git diff --exit-code -- docs/reviews/2026-08-23-v0.6-sol-smoke-review.md
```

结果：pending `article.daily-plan-review-card` 由 descendant exact `采用安排` 按钮过滤，card count 严格为 1，Fake summary 与 apply button 均在该 card 内 exact 定位；无位置选择器或错误过滤。focused v0.6 1/1、完整 E2E 8/8 均 PASS、真实 exit 0；Web typecheck、两个 E2E focused ESLint、diff-check PASS，migration 与 immutable Sol FAIL review zero-diff。真实 Provider/network 保持 `NOT RUN — APPROVAL REQUIRED`。

## check_full

## v0.6 Sol rereview-2 WebP VP8/VP8L decodability P1 repair

```powershell
npm test --workspace @ev/core -- tests/course-import.test.ts -t "rejects exact-size VP8 and VP8L frame headers before persistence or any Vision call"
npm test --workspace @ev/core -- tests/course-import.test.ts
npm test --workspace @ev/core
npm run typecheck --workspace @ev/core
npx eslint apps/core/src/modules/calendar/image-metadata.ts apps/core/src/modules/calendar/import-service.ts apps/core/tests/course-import.test.ts
npm test
git diff --check
git diff --exit-code -- apps/core/src/storage/migrations.ts docs/reviews/2026-08-23-v0.6-sol-smoke-review.md docs/reviews/2026-08-31-v0.6-sol-rereview.md docs/reviews/2026-08-31-v0.6-sol-rereview-2.md
npm install --package-lock-only --offline --ignore-scripts --workspace @ev/core --dry-run
npm ls sharp --workspace @ev/core --depth=0
```

结果：RED 确认 exact-size header-only VP8 与 VP8L 均错误返回 201；GREEN 后 focused course-import 14/14、Core 45 files/303、Core typecheck、focused ESLint 和 root `npm test` 均 exit 0。负例断言 422、零 artifact rows/files 和零 Vision calls；离线固定 VP8/VP8L 正例先经 `sharp(...).stats()` 完整解码，再验证 201 和 2×3 metadata。主 Agent 另用 Chromium `createImageBitmap()` 独立解码两个正例为 2×3；根测试最终为 legacy 5/5、Core 303/303、Web 242/242、Contracts 77/77、Domain 7/7，全仓 typecheck/build 通过，lint 0 error/4 个既有 warning，完整 E2E 8/8。`git diff --check`、migrations 与三份 immutable FAIL review zero-diff；offline manifest/lockfile/installed tree 一致为 direct exact `sharp@0.35.3`。真实 Provider/network 保持 `NOT RUN — APPROVAL REQUIRED`。

## v0.6 Sol rereview 三个 P1 Terra 修复证据

```powershell
npm test --workspace @ev/core -- tests/course-import.test.ts
npm test --workspace @ev/web -- tests/schedule-workspace.test.tsx
npm run typecheck --workspace @ev/core
npm run typecheck --workspace @ev/web
npx eslint apps/core/src/app.ts apps/core/src/modules/calendar/image-metadata.ts apps/core/src/modules/calendar/artifact-store.ts apps/core/src/modules/calendar/import-repository.ts apps/core/src/modules/calendar/import-service.ts apps/core/tests/course-import.test.ts apps/web/src/components/schedule/course-import-review.tsx apps/web/tests/schedule-workspace.test.tsx
git diff --check
npm test
npm run test:e2e -- e2e/v0.6-learning-loop.spec.ts
```

结果：Core course-import/recovery 12/12、Web schedule workspace 6/6；Core/Web typecheck、focused ESLint、diff check 全部 exit 0。Root `npm test` 为 legacy 5/5、Core 301/301、Web 242/242、Contracts 77/77、Domain 7/7，真实 exit 0。Focused v0.6 E2E 1/1 PASS。migration 与两份不可变 FAIL review 零差异。Full E2E/build 按本轮契约未运行；真实 Provider/network 为 `NOT RUN — APPROVAL REQUIRED`。

### v0.6 主 Agent 最终独立验证（2026-08-31）

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
git diff --check
git diff --exit-code -- apps/core/src/storage/migrations.ts
git diff --exit-code -- docs/reviews/2026-08-23-v0.6-sol-smoke-review.md
```

结果：根测试 Legacy 5/5、Core 301/301、Web 242/242、Contracts 77/77、Domain 7/7；typecheck 与 build exit 0；完整 E2E 8/8、exit 0。lint 为 0 error、4 个未改动 v0.5 recovery 测试的既有 warning。新报告行尾、5 个 tracked package version=0.6.0、生产源码常见凭据字面量和 `next-env.d.ts` 基线均另行检查通过；migration 与两份不可变 FAIL review 均为 zero-diff。真实 Provider/network 保持 `NOT RUN — APPROVAL REQUIRED`。

命令：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
git diff --check
```

覆盖范围：全仓确定性测试、类型、lint、构建和浏览器回归。

预计耗时：约 5–15 分钟；每个里程碑原则上最多运行一次。

## eval_llm_smoke

命令：由获批 Provider 和非敏感测试数据决定，不嵌入普通测试脚本。

允许触发条件：Prompt、模型、Tool/RAG 或上下文逻辑发生变化，并且用户已批准真实凭据、外发内容和可能费用。

## eval_llm_full

命令：发布前单独制定。

允许触发条件：仅 v0.9 发布候选、真实 Provider 已授权、测试数据和费用边界已批准时运行。
