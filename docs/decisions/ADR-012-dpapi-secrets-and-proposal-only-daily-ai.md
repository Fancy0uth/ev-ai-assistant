# ADR-012: Provider 密钥采用 DPAPI，AI 日计划只产生确认式 Proposal

## Status

Accepted

## Date

2026-08-17

## Context

v0.3 需要让单 Owner 在设置页配置 DeepSeek，并让每日排程真正调用模型。现有 Provider Port 只表达“已配置/未配置”，不能保存密钥；将 Key 放入 `.env`、浏览器 LocalStorage、SQLite 明文或日志会违背本地优先与可审计原则。模型生成的时间安排也不能绕过用户直接改写日程。

## Decision

1. 引入跨平台 `SecretStorePort`；Windows MVP 使用 DPAPI `CurrentUser` 加密 Provider Key，并将密文与非敏感版本元数据保存在本地数据目录。
2. Core 是唯一能解密和调用 Provider 的进程；Web 只能写入、替换、删除 Key 或读取状态，不能读取明文。
3. 每次 DeepSeek 调用都经过 `ContextManifest` 与结构化输出校验；密钥、请求正文和健康原文不进入日志。
4. 日程协调 Agent 只能创建 `DailyPlanProposal`。任何 Event、Action 或时间块写入只由 Owner 在审阅后通过版本校验确认。
5. Windows adapter 的自动化测试使用内存 Fake；真实 DPAPI 仅以人工连接测试验证。Linux/macOS 将来通过同一 Port 接入各自 Secret Store，不在本 ADR 中预设实现。

实现约束：`withApiKey` 只能在 Core 内以 `void` callback 暂时交出明文，不能通过返回值把密钥带回调用链；PowerShell 子进程的输入走 stdin，所有异常、超时或输出超限都 fail-closed。

## Alternatives Considered

### `.env` 或 SQLite 明文

实现最短，但易被 Git、备份、日志或本地读取泄露，拒绝。

### 浏览器 LocalStorage

无法满足服务端调用与 XSS 风险边界，拒绝。

### 每次启动时手工输入 Key

安全边界较小，但不满足本地常开助手的日常可用性，拒绝。

### Agent 直接写日程

体验看似省步骤，却无法处理冲突、模型幻觉和用户承诺，违反 PRD 确认原则，拒绝。

## Consequences

- v0.3 需要一个 Windows 专用实现与清晰的“不支持当前系统”状态；实现复杂度可通过 Port 隔离。
- Key 替换/删除与 Context 外发需要明确 UI 和审计记录。
- 每日计划首次变得真实可用，但仍不会自动执行；这为后续项目、课程、健身和饮食 Agent 提供安全的同一 Proposal 通道。

## References

- [Microsoft ProtectedData / DPAPI](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata?view=windowsdesktop-9.0)
- [Node.js child_process](https://nodejs.org/download/release/latest-v24.x/docs/api/all.html#child-process)
