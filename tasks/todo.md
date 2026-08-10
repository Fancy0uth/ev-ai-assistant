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
- [x] Task 2：扩展 Task 查询与 409 最新实体契约。
- [x] Task 3：新增 migration 002 与 001→002 保留数据测试。
- [x] Task 4：实现 Owner 隔离 Agent Repository 与 Service。
- [x] Task 5：实现四组 Agent API 与可注入 Provider Port。
- [x] Task 6：修复 Today 对第 101 条以后任务的统计截断。
- [x] Task 7：Core 返回并 Web 保留 Task 409 服务端最新版本。

## 安全、路由与页面

- [x] Task 8：BFF 仅允许 loopback 并只转发 `ev_session`。
- [x] Task 9：实现根路由、setup/login/session 启动解析和单 Owner 表单门禁。
- [x] Task 10：建立 `/today`、`/tasks`、`/agent` 共享认证 Shell 与可访问导航。
- [x] Task 11：实现 Tasks 分页、领域/状态/日期筛选与列表状态。
- [x] Task 11A：Core 在分页前执行领域、状态与日期筛选（审查新增 P1）。
- [x] Task 12：实现 Tasks 创建、编辑、完成、延期、取消和 409 恢复。
- [x] Task 12R：修复 Task 12 反方审查确认的 mutation、终态、焦点、lint 与响应式 P1。
- [x] Task 13：修复 Today 201+刷新失败重复创建、长标题与移动表单字号。
- [x] Task 13R：修复 Today 持久化确认时序与移动 200 字符溢出 P1。
- [x] Task 14：实现 `/agent` 会话/消息/上下文/输入 UI 和未配置禁用状态。
- [x] Task 14R：修复 Agent 历史关联、创建/分页一致性与发送后焦点 P1。
- [x] Task 14R2：修复创建后 page 1 投影与分页失败后无效导航 P1。

## E2E 与发布材料

- [x] Task 15：把 Playwright 迁移到独立端口与独立 `EV_DATA_DIR`。
- [x] Task 16：完成 1440×900、1024×768、390×844、320×800 真实浏览器矩阵。
- [x] Task 16R：补齐 Terra 复审确认的三项 E2E 测试门缺口。
- [x] Task 16R2a：把 `GET /v1/auth/session` 固化为显式 authenticated 状态探测，保留 Task/Agent 401 边界。
- [x] Task 16R2b：更新 Web 启动分支并以全套 E2E 回归 P1-27 的零 console 门。
- [ ] Task 16R3（Terra 修复 round 2 待完成）：在认证前覆盖 Task 全生命周期的 console warning/error/pageerror 门；门禁从 `import.meta.url` 解析 spec，分别断言两个 listener 各自唯一注册。诊断持续性检查须先规范化普通空白，再禁止中途解绑或清空数组，避免空白变体绕过；仍只允许一份 E2E spec 与一份 gate test、无生产改动。实现提交 `3a4ce73` 仅改 gate test；审查包四文件范围由前置文档登记 `413eb65` 造成，属噪声而非实现范围外改动；在 logout/401 断言后归零，最终门禁保持未勾选。
- [x] Task 17：原子统一全部 workspace 与内部依赖的 `0.2.0` 版本。
- [x] Task 18：同步运行时健康信息、README 和 `CHANGELOG.md`。

## 最终门禁与交付

- [ ] 通过 `npm test`、typecheck、lint、build、E2E 和 `git diff --check`。
- [ ] 通过 001→002、Owner 隔离、Task 409、Agent 503/no-fake-response 专项测试。
- [ ] 运行依赖审计、Code Intel lite 与 Sentrux `session_end`，不更新 baseline 掩盖回归。
- [ ] Sol 最终审查逐项分类，所有有效 P0/P1 清零。
- [ ] 主 Agent 完成 `docs/releases/2026-08-10-v0.2.0-acceptance.md`。
- [ ] 推送 `codex/v0.2.0` 并创建目标为 `main` 的 ready-for-review PR；不合并、不打 v0.2.0 标签。
- [ ] 使用全新独立预览数据目录启动 3000/4311，并确认 `/setup` 可打开且无预设账号。
