# EV AI Assistant

本地优先、单 Owner 的个人每日控制台：Today 汇总日程、具体行动、恢复与待确认建议。Next.js Web + Fastify Core + SQLite/WAL；技术预览，不是生产发布声明。

2026-09-16 范围调整：不再内置代码项目分析、项目对话或 Codex 接入。普通工作待办、日程、学习、健身、饮食与记忆保留；历史项目数据不清除。无需为 EV 登录 Codex 或启动专属 Docker 网关。实际修改及验证状态见 [TASKS](plans/TASKS.md)。

## 权威入口

| 内容 | 唯一正文 |
| --- | --- |
| 项目定位与阅读顺序 | [PROJECT_BRIEF](docs/PROJECT_BRIEF.md) |
| Agent 工作边界 | [AGENTS](AGENTS.md) |
| 产品需求与批准记录 | [PRD](docs/PRD.md) |
| 独立 MVP 范围 | [MVP-SCOPE](docs/product/MVP-SCOPE.md) |
| 技术规格 / 架构 | [TECH_SPEC](docs/TECH_SPEC.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) |
| 数据 / 实际接口 | [DATABASE](docs/DATABASE.md) · [API](docs/API.md) |
| Windows 启动、数据与未完成运维 | [DEPLOYMENT](docs/DEPLOYMENT.md) |
| 路线 / 唯一进度及 V8/V9 小契约 | [ROADMAP](plans/ROADMAP.md) · [TASKS](plans/TASKS.md) |
| v0.9 本地验收与未验证边界 | [验收交接](docs/releases/2026-09-08-v0.9-local-acceptance.md) |

Frontend = `apps/web`，backend = `apps/core`；共享契约 `packages/contracts`，纯领域规则 `packages/domain`。没有另建 frontend/backend 空壳或 compose。

Windows / Node24；受管脚本另需PowerShell7，已有依赖无需重装。启动方式只维护在DEPLOYMENT，Core/Web默认分别为loopback 4311/3000；无默认账号。V9补充网页安全、启动脚本、SQLite-only备份及脱敏日志，实际验收状态见TASKS；真实私有HTTPS、物理iPhone、自启动与完整恢复仍须另授权验证，不是已部署服务。

当前门禁与修复证据只见 TASKS。历史 [阶段交接](docs/releases/2026-09-07-development-phase-handoff.md)、[v0.7 独立审查](docs/reviews/2026-08-31-v0.7-sol-rereview-2.md) 保留原结论，不以旧测试结果冒充本轮验证。
