# 开发者每日驾驶舱 v1：执行总览

## 已批准架构

Web 核心数据云端同步；本地 Agent Bridge 保留 API Key 和累积记忆；GitHub 只读手动刷新；日历只导入 `.ics` 快照。详细约束见 [产品规格](../docs/superpowers/specs/2026-08-04-developer-daily-cockpit-product-v1-design.md) 与 ADR。

## 实施顺序

1. Web 核心每日驾驶舱：认证、RLS、项目/任务、每日状态、应用内日程、失败态。
2. 日历与 GitHub 只读集成：在核心 CRUD 稳定后实现。
3. 本地 Agent Bridge 与长期记忆：在 Web 端上下文预览和版本冲突机制稳定后实现。
4. CI、可观测性、部署与发布检查：在每个产品边界可端到端测试后完成。

## 当前可执行计划

- [Web Core Daily Cockpit](../docs/superpowers/plans/2026-08-04-web-core-daily-cockpit.md)

## 依赖与风险

| 风险 | 控制方式 |
|---|---|
| 用户数据越权 | 数据库 RLS + 跨用户 SQL 测试 |
| 静态 Demo 被意外破坏 | 生产应用在 `apps/web`，Demo 原样保留 |
| Agent 复杂度拖慢核心价值 | Bridge 作为第二个独立交付，而非首轮依赖 |
| 外部数据错误 | 后续 `.ics`、GitHub 都以 fixture 与部分失败状态为先 |
