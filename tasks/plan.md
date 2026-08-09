# EV AI Dashboard：v0.2.0 Dashboard 稳定化执行总览

## 权威文档

- [产品总规格](../docs/superpowers/specs/2026-08-07-local-first-personal-ai-dashboard-v2-design.md)
- [v0.2.0 改进设计](../docs/superpowers/specs/2026-08-10-v0.2.0-improvement-design.md)
- [v0.2.0 TDD 实施计划](../docs/superpowers/plans/2026-08-10-v0.2.0-dashboard-stabilization.md)
- ADR-005 至 ADR-008：本地 Core、Agent 路由、外部集成延期、Windows 先于 Docker。

旧 Supabase、`.ics` 与可选 Bridge 规格仅作历史记录。本文件中的 `v0.2.0` 指 Dashboard 稳定化版本，不是 Event/Scheduler 产品 Milestone 0.2。

## 当前真实状态

- [x] 从干净提交 `83f4b37` 发布私有 GitHub 技术预览 `v0.1.0`。
- [x] 完成 v0.1 基线自动化、Code Intel lite 与桌面/移动浏览器审计。
- [x] 由主 Agent 复核并冻结 v0.2.0 改进设计与实施计划。
- [ ] 实现、复审并集成全部 v0.2.0 P0/P1 切片。
- [ ] 通过全仓、迁移、安全、依赖、Code Intel 和四视口浏览器门禁。
- [ ] 完成验收文档、推送分支、创建 ready-for-review PR，并启动独立预览。

## 阶段顺序

1. 契约：Agent 资源、Task 查询与 409 最新实体。
2. 数据：SQLite migration 002 与 001→002 保留数据证明。
3. Core：Agent Repository/Service/API、Today 101+、Task 冲突语义。
4. 安全与认证：BFF loopback/Cookie 最小化、根路由与单 Owner 启动解析。
5. Dashboard：共享真实路由 Shell、独立 Tasks、Today 恢复与响应式修复、独立 Agent UI。
6. 质量：隔离 E2E、四视口矩阵、版本与 CHANGELOG。
7. 发布候选：全套门禁、Sol 最终审查、验收文档、PR 和独立预览。

## 角色与提交规则

- Terra：每次只实现一个 TDD 切片，使用独立 fork 和原子提交。
- Sol：每个切片后在新上下文做契约、质量、安全和最小边界复审。
- 主 Agent：冻结契约、集成、分类审查意见、运行最终门禁和编写验收文档。
- 当前没有 v0.2.0 实现任务被标记为完成；不得用文档存在代替实现和验证证据。

## 停止边界

涉及真实 Provider/Key、长期记忆、外部服务、Docker/Tailscale、原生 App、多用户、破坏性迁移或范围外产品功能时停止并重新请求批准。有效 P0/P1、迁移数据丢失、Agent 503 后写入、BFF 非 loopback 凭据暴露或高危/严重运行时漏洞都会阻止 PR。
