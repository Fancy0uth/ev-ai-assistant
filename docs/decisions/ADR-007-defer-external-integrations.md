# ADR-007: v1 延期 Apple 日历及其他外部数据接入

## Status

Accepted — supersedes ADR-004.

## Date

2026-08-07

## Context

早期规格包含 `.ics` 快照和 GitHub API 刷新，但当前目标是先把本地 Dashboard、任务日程、生活链路和 Agent 核心跑通。Apple 日历、小米手环、学校网站和外部 GitHub API 会显著增加授权、同步和错误处理范围。

## Decision

v1 不实现任何 Apple 日历导入，包括 `.ics`；也不实现小米手环、学校网站或通用 GitHub 云端同步。项目功能直接从用户授权的本地 Git 仓库读取。

领域层保留 `CalendarProvider`、`WearableProvider`、`CourseProvider`、`ExerciseCatalogProvider` 和其他 Adapter Port。Port 接收规范化领域对象，第三方字段和认证细节留在 Adapter 内。

## Alternatives Considered

### 保留 `.ics` 快照

看似简单，但仍需正确处理时区、重复、取消、重导入和文件错误，会延迟核心产品验证。

### 同时开发 Apple 日历和小米手环

能提供更丰富数据，但会让首版成功依赖多个不稳定的外部边界。

## Consequences

- v1 的日历和提醒完全由本地系统管理。
- Apple 日历等能力以后可以新增 Adapter，而无需改变 Task、Event 和 Workout 核心模型。
- 产品界面不得展示尚未真实接入的同步状态或伪造数据。
