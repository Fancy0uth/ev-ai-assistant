# 项目简报

EV AI Assistant 是 Windows 本机运行、单 Owner 的个人每日控制台。以 Event、Action、Session、Signal 连接普通工作待办、课程、训练、饮食与日程；建议经确认再写入，SQLite 是业务事实来源。2026-09-16 用户确认退出项目分析与专属 Codex 集成，历史数据保留；独立 Codex 的使用不由 EV 操控。产品范围和批准记录只维护在 [PRD](PRD.md)，独立范围正文为 [MVP-SCOPE](product/MVP-SCOPE.md)。

## 入口分工

先读 [README](../README.md) 导航和 [AGENTS](../AGENTS.md) 边界，再读 [TECH_SPEC](TECH_SPEC.md)、[ARCHITECTURE](ARCHITECTURE.md)。数据库事实见 [DATABASE](DATABASE.md)，可调用接口见 [API](API.md)，启动及运维缺口见 [DEPLOYMENT](DEPLOYMENT.md)。[ROADMAP](../plans/ROADMAP.md) 管顺序，[TASKS](../plans/TASKS.md) 独占进度、小契约、证据和下一步。

## 基线与边界

[2026-09-07 阶段交接](releases/2026-09-07-development-phase-handoff.md) 是冻结历史，不是发布声明；[v0.7 第三次审查](reviews/2026-08-31-v0.7-sol-rereview-2.md) 的 FAIL 不改写。历史 v0.3 [实施设计](technical/IMPLEMENTED-MVP-DESIGN.md) 只解释当时实现，不代替当前状态。

代码继续使用 `apps/web` / `apps/core`，不物理重排应用。V8 历史项目链路按新决策退役，实体记忆与每日协调继续保留；静态规则模式与外部 Provider 模式明确区分。远程/备份/常驻运维属于 v9，不伪装完成。
