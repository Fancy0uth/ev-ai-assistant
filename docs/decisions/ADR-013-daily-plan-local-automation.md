# ADR-013: 每日计划使用本地 07:00 调度与首次访问补偿

## Status

Accepted

## Date

2026-08-23

## Context

v0.2 的 `daily_plan_jobs` 定时器会以主机本地时间每分钟扫描，并写入旧的通用 `Proposal` 表。它无法表达真实 Daily Plan Run、Provider 失败、上下文审阅或当前日程版本，也会与 v0.3 的结构化每日计划产生两条自动排程路径。

v0.3 需要在用户通常开始一天时准备建议，但不能让模型自动写入 Event，也不能因为重启或错过 07:00 而在不透明的后台重复生成。

## Decision

1. Core 只启用 `DailyPlanAutomationService` 作为生产自动触发入口，时区固定为 `Asia/Shanghai`；它用一次性 timer 安排下一个 07:00，而不是每分钟轮询。
2. 若机器错过 07:00，当 Owner 首次请求与上海当天相同的 `/v1/today?date=` 时，服务只补做一次 `FIRST_VISIT_RECOVERY`；历史日期和 07:00 前的访问不触发调用。
3. 自动运行以 `SCHEDULED_0700` 或 `FIRST_VISIT_RECOVERY` 写入现有 `daily_plan_runs`；第 16 个 SQLite 加法迁移限制同一 Owner/日期最多一个自动运行。手动 `MANUAL` 草案保持可用，便于用户在失败后主动重试。
4. 内存中的 generation、持久化中的 `GENERATING`/`FAILED` 与审核草案均映射到 Today 的真实状态。结构化日志只记录固定事件名、触发来源与失败分类，绝不记录密钥、请求正文、健康原文或 Owner 标识。
5. 旧 `daily_plan_jobs` 表、模块和既有 API 作为兼容历史保留，但应用和 `server.ts` 不再启动旧定时器；在确认没有外部消费者前不做删除。
6. 自动化只调用既有 Proposal-only Daily Planning Service。没有配置 Provider、生成失败或模型输出无效时不创建 Event；只有 Owner 审核采用后才写入时间轴。

## Alternatives Considered

### 保留旧的每分钟通用 Proposal Job

它绕开了 v0.3 Context、Provider 与审阅状态，且使用主机时区。拒绝。

### 使用外部云 Cron 或 Windows Task Scheduler

会引入部署凭据、安装步骤和另一套可用性边界。本地单机 MVP 先用 Core 内部一次性 timer，后续部署再抽象调度器。拒绝。

### 自动生成后直接写入日程

违背 ADR-009 与 ADR-012 的确认边界，也无法安全处理模型错误和临时变更。拒绝。

## Consequences

- 07:00 自动化在进程持续运行时触发；停机期间依赖当天首访恢复，不承诺离线时段的多次补跑。
- 同日自动失败不自动重试，避免无界 API 消耗；用户可进入每日计划页手动生成新的 `MANUAL` 草案。
- 未来移除旧通用调度前需要先验证零生产消费者，并单独完成删除迁移。

## References

- [ADR-009](ADR-009-proposal-gated-schedule-materialization.md)
- [ADR-012](ADR-012-dpapi-secrets-and-proposal-only-daily-ai.md)
