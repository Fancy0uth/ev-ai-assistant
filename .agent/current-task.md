# TASK-V6-03：课程详情与安全公开 citation（待主 Agent 原子提交）

## 当前目标

V6-03 已完成实现、TDD、审阅与验证；等待主 Agent 创建指定原子提交 `feat(learning): save safe public course citations`。在该提交完成前，不开始 V6-04。

## 执行基线

- 产品比较 BASE：`155b172de91a62feb2762469536555f9a6b2b025`
- 运行时代码 BASE：`d5d4ea5`
- 直接前置：V6-01 `8ee52e1`、V6-02 `4b4e218`。
- 固定计划：`docs/superpowers/plans/2026-08-23-v0.6-learning-schedule-loop.md` 的 V6-03。

## 已实现闭环

- Owner-scoped Course detail 聚合 Rule、官方/用户/公开 source、版本化学习进度和 action counts；外部 Owner 对 Course、context 与 search run 统一 404。
- Provider 缺失时创建 `BLOCKED_PROVIDER` run 且 execute 诚实返回 `SEARCH_PROVIDER_NOT_CONFIGURED`；测试 Fake 仍受三重门控制。
- Search disclosure 后才会调用 capability；所有 provider/DNS/HTTPS 工作均在 SQLite write transaction 外。
- 公开 URL 严格 HTTPS/443、无凭据，DNS 全量公开地址 pinning，逐跳重验、3 次 redirect 上限、5s absolute header/15s total timeout、identity-only、1 MiB/type/charset 限制；IPv6 special-use（含 discard、benchmark、ORCHID、translation、IETF reserved 等）在 transport 前 fail closed，正常公网 IPv6 保留。
- 仅持久化 immutable citation metadata；HTML/text/header 不写 SQLite，提示注入文本仅以未渲染的内存数据处理。
- Web 课程详情可保存 progress、展示三类 source、请求 disclosure、执行 citation search，并将终态失败从 Core 详情恢复到 UI。

## GREEN 命令

```powershell
npm test --workspace @ev/contracts -- tests/courses.test.ts tests/providers.test.ts
# PASS: 2 files / 19 tests
npm test --workspace @ev/core -- tests/learning.test.ts tests/public-resource-fetcher.test.ts
# PASS: 2 files / 11 tests
npm test --workspace @ev/web -- tests/learning-workspace.test.tsx tests/course-detail-workspace.test.tsx
# PASS: 2 files / 4 tests
npm run typecheck --workspace @ev/contracts
npm run typecheck --workspace @ev/core
npm run typecheck --workspace @ev/web
npx eslint [V6-03 focused files]
git diff --check
```

## 交接记录

V6-03：安全复核 P1 已关闭，GREEN 已通过 Contracts 19/19、Core 11/11、Web 4/4；三个 workspace typecheck、聚焦 eslint、`git diff --check` 均通过。Core 的注入 DNS/HTTPS/timer 测试证明 special-use IPv6 在 transport 前拒绝，且 5s absolute header deadline 与 15s total deadline 的清理语义可观察。P0=0、P1=0。完整断言映射见 `.agent/reports/v0.6-v6-03.md`。真实 Vision/Search/DeepSeek 证据仍为 `NOT RUN — APPROVAL REQUIRED`；没有真实 Provider、socket、凭据、依赖安装、用户 `EV_DATA_DIR` 或 Git staging/commit 操作。主 Agent 提交后从 V6-04 继续。
