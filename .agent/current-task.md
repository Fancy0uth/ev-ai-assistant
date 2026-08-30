# TASK-V6-01：安全本地课表 artifact（等待原子提交）

## 当前目标

V6-01 的实现、测试、typecheck、聚焦 lint 和 diff 检查均已完成。Git 在 `git add` 时因无法创建 linked-worktree `index.lock` 被拒绝；按执行约束，等待主 Agent 提交指定原子 commit 后再开始 V6-02。

## 执行基线

- 产品比较 BASE：`155b172de91a62feb2762469536555f9a6b2b025`
- 运行时代码 BASE：`d5d4ea5`
- 直接前置：主 Agent 创建 V6-01 原子提交 `feat(course-import): secure local timetable artifacts`。
- 固定计划：`docs/superpowers/plans/2026-08-23-v0.6-learning-schedule-loop.md` 的 V6-02。

## 已验证 V6-01 边界

- Fake 仍同时要求 `NODE_ENV=test`、显式 v0.6 flag 和 resolved runner-owned data root；生产没有 Vision Provider 时为 `BLOCKED_PROVIDER`。
- v19 只增不改；私有 artifact 不进入 SQLite；BFF/Core raw 上传各有 5 MB 上限。
- 不调用真实 Provider，不触及真实 `EV_DATA_DIR`，不新增依赖。

## GREEN 命令

```powershell
npm test --workspace @ev/contracts -- tests/courses.test.ts tests/calendar-proposals.test.ts
npm test --workspace @ev/core -- tests/course-import.test.ts tests/calendar-repository.test.ts tests/proposal-api.test.ts tests/today.test.ts
npm test --workspace @ev/web -- tests/schedule-workspace.test.tsx tests/today-dashboard.test.tsx
```

## 交接记录

V6-01：GREEN 已通过 Contracts 16/16、Core 13/13、Web 17/17；三个 workspace typecheck 与聚焦 eslint、`git diff --check` 均通过。真实 Provider 证据仍为 `NOT RUN — APPROVAL REQUIRED`。唯一阻断：`git add …` 返回 `fatal: Unable to create .../.git/worktrees/product-prd/index.lock: Permission denied`。
