# ADR-002: 用可选本地 Agent Bridge 保管 Key 与执行 AI 请求

## Status

Superseded by ADR-005.

## Date

2026-08-04

## Context

纯 Web 应用无法安全保存用户自带模型 API Key，也无法可靠保存“永不上传云端”的长期 Agent 记忆。用户需要 Web 优先的核心体验，同时愿意安装本地组件以获得 AI 能力。

## Decision

提供可选安装的本地 Agent Bridge。Bridge 在用户计算机上保存 Key（优先使用操作系统凭据库）和 SQLite 记忆，直接调用用户选择的模型供应商。Web 端只在用户预览并确认精确上下文后，向 Bridge 发起版本化请求。

Bridge 只绑定 loopback，实施来源白名单、安装级身份、短时令牌、防重放、CORS 与 Private Network Access 预检。未安装、离线或版本不兼容时，Web 明确降级为非 AI 模式。

## Alternatives Considered

### 浏览器直接保存并调用 API Key

安装成本低，但 Key 容易暴露给浏览器存储、扩展或 XSS，不能接受。

### 云端代理模型请求

可降低本地安装门槛，但必须让产品云端接触 Key 或记忆，违背隐私边界。

## Consequences

- Bridge 是独立可发布、可升级、需端到端浏览器兼容性测试的产品单元。
- 首版 AI 不具备跨设备连续性，不能假装为无缝云端 Agent。
- 本地服务协议和确认 UX 是安全关键接口。
