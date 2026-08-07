# 本地优先个人 AI Dashboard：执行总览

## 权威设计

- [产品 v2 规格](../docs/superpowers/specs/2026-08-07-local-first-personal-ai-dashboard-v2-design.md)
- [首个纵向切片计划](../docs/superpowers/plans/2026-08-07-local-foundation-owner-task-dashboard.md)
- ADR-005 至 ADR-008 记录本地 Core、Agent 路由、外部集成延期和 Docker 演进决策。

旧 Supabase、`.ics` 和本地 Bridge 规格仅保留为历史，不再执行。

## 实施顺序

1. Milestone 0.1：本地账号、Web/Core 契约、SQLite、真实任务和 Today Dashboard。
2. Milestone 0.2：Event、TimeBlock、Routine、Reminder、Scheduler 与昨日统计。
3. Milestone 0.3：每日简报、DeepSeek Provider、生活记录草稿与审批。
4. Milestone 0.4：本地项目、Future Work、Codex Brief/Investigate。
5. Milestone 0.5：Codex 隔离 Implement/Verify、审计与恢复。
6. Milestone 0.6：身体、训练、饮食、长期记忆循环和中央审批中心。
7. Milestone 0.7：Tailscale 手机访问、备份恢复、7 天长期运行和安全验收。
8. Milestone 1.0：Windows 稳定版；随后进入 Docker 自托管预览。

## 当前执行边界

只执行 Milestone 0.1。DeepSeek、Codex、Tailscale 和外部集成在该里程碑中保持未配置，界面不得伪造可用状态。
