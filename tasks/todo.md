# EV AI Dashboard v0.2.0 实施清单

详细 RED/GREEN、候选文件、验收和提交消息见 [Dashboard 稳定化实施计划](../docs/superpowers/plans/2026-08-10-v0.2.0-dashboard-stabilization.md)。

## 已完成基线

- [x] 发布私有技术预览 `v0.1.0`（提交 `83f4b37`）。
- [x] 完成 v0.1 自动化、Code Intel lite 与四视口基线审计。

## 规格门

- [x] 主 Agent 复核并冻结 v0.2.0 改进设计、接口与实施边界。
- [x] 在结构性编码前运行 Sentrux `session_start`。

## 契约、迁移与 Core Agent

- [x] Task 1：冻结 provider-neutral Agent 公共契约。
- [ ] Task 2：扩展 Task 查询与 409 最新实体契约。
- [ ] Task 3：新增 migration 002 与 001→002 保留数据测试。
- [ ] Task 4：实现 Owner 隔离 Agent Repository 与 Service。
- [ ] Task 5：实现四组 Agent API 与可注入 Provider Port。
- [ ] Task 6：修复 Today 对第 101 条以后任务的统计截断。
- [ ] Task 7：Core 返回并 Web 保留 Task 409 服务端最新版本。

## 安全、路由与页面

- [ ] Task 8：BFF 仅允许 loopback 并只转发 `ev_session`。
- [ ] Task 9：实现根路由、setup/login/session 启动解析和单 Owner 表单门禁。
- [ ] Task 10：建立 `/today`、`/tasks`、`/agent` 共享认证 Shell 与可访问导航。
- [ ] Task 11：实现 Tasks 分页、领域/状态/日期筛选与列表状态。
- [ ] Task 12：实现 Tasks 创建、编辑、完成、延期、取消和 409 恢复。
- [ ] Task 13：修复 Today 201+刷新失败重复创建、长标题与移动表单字号。
- [ ] Task 14：实现 `/agent` 会话/消息/上下文/输入 UI 和未配置禁用状态。

## E2E 与发布材料

- [ ] Task 15：把 Playwright 迁移到独立端口与独立 `EV_DATA_DIR`。
- [ ] Task 16：完成 1440×900、1024×768、390×844、320×800 真实浏览器矩阵。
- [ ] Task 17：原子统一全部 workspace 与内部依赖的 `0.2.0` 版本。
- [ ] Task 18：同步运行时健康信息、README 和 `CHANGELOG.md`。

## 最终门禁与交付

- [ ] 通过 `npm test`、typecheck、lint、build、E2E 和 `git diff --check`。
- [ ] 通过 001→002、Owner 隔离、Task 409、Agent 503/no-fake-response 专项测试。
- [ ] 运行依赖审计、Code Intel lite 与 Sentrux `session_end`，不更新 baseline 掩盖回归。
- [ ] Sol 最终审查逐项分类，所有有效 P0/P1 清零。
- [ ] 主 Agent 完成 `docs/releases/2026-08-10-v0.2.0-acceptance.md`。
- [ ] 推送 `codex/v0.2.0` 并创建目标为 `main` 的 ready-for-review PR；不合并、不打 v0.2.0 标签。
- [ ] 使用全新独立预览数据目录启动 3000/4311，并确认 `/setup` 可打开且无预设账号。
