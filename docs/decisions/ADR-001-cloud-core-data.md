# ADR-001: 云端仅同步核心业务数据

## Status

Accepted

## Date

2026-08-04

## Context

产品需要真实账号与跨浏览器同步，但用户明确要求 Agent 记忆和模型 API Key 永不上传到产品云端。任务、项目和日程属于用户可见且需要跨端使用的核心数据。

## Decision

使用 Supabase Auth、Postgres 与 Row Level Security 承载账号和核心业务数据。每张用户数据表、导出路径、对象存储及后台访问都以不可变用户 ID 作为租户边界。云端禁止存储 API Key、Agent 记忆、原始 Agent 对话和检索结果。

## Alternatives Considered

### 全部本地存储

隐私最简单，但无法满足真实账号和可靠的跨浏览器同步。

### 云端保存全部 Agent 上下文

便于跨设备，但违背用户的明确隐私边界，也增加高敏感数据泄露面。

## Consequences

- Web 核心功能可独立于 AI 工作。
- 必须为 RLS、导出与后台路径建立跨用户隔离测试。
- Agent 记忆不跨设备同步，这是有意的 v1 限制。
