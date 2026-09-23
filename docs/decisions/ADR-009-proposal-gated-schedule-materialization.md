# ADR-009: 用 Proposal 闸门确认日程，并将课表规则物化为日期事件

## Status

Accepted

## Date

2026-08-17

## Context

课表截图、自然语言事项、课程预习、训练和项目分析都会提出时间安排。直接让各 Agent 写日历会造成冲突、误识别和不可追溯的用户承诺；只保存“每周一第 1–16 周上课”又不能正确处理停课、补课和单日改期，也无法让首页按真实日期快速展示。

## Decision

课程和重复安排保存为 `CalendarRule`，同时按 Term 的当地时区物化为实际日期 `Event`。停课、补课和改期以 `CalendarException`/单个 Event 覆盖，不修改原规则。

所有 Agent 和用户自然语言输入只能创建 `ScheduleRequest` 或 `Proposal`。日程协调服务在确定性冲突排序后生成一个 versioned Proposal；只有 Owner 以 `expectedVersion` 和 `Idempotency-Key` 确认时，Core 才在一个 SQLite 事务中写入规则、事件、行动关联和审计。拒绝/过期 Proposal 不改变日程。

## Alternatives Considered

### 各领域 Agent 直接修改日程

实现很快，但训练、课程和项目建议会互相覆盖，且用户无法在写入前理解冲突与取舍。

### 只保存重复文本规则，在页面即时计算

存储较少，但例外处理、日期查询、冲突检测和历史审计会变得复杂且脆弱。

### 把所有建议只做成普通 Task

会把课程、训练和项目上下文退化成通用 To-do，无法形成产品需要的“日程为骨架”。

## Consequences

- 需要实现周次到真实日期的确定性展开、时区、冲突、版本和迁移测试。
- Proposal 表和确认 API 是核心依赖，所有日程写路径都必须经过它。
- 每日 07:00 计划只创建新的 Proposal，不拥有自动执行权。
