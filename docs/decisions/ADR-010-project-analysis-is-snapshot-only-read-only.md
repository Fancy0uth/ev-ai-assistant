# ADR-010: 项目 Agent 只分析过滤快照，永不执行项目写入

## Status

Accepted — supersedes the Project Runner implementation/write capability in ADR-006.

## Date

2026-08-17

## Context

产品的当前目标是让 Project Agent 读取用户授权的本地项目、识别 PRD/技术设计/任务/测试进度、提供下一步和时间安排。用户明确不希望该 Agent 修改项目。把完整项目路径或 Codex CLI 工具直接交给模型，即使提示它“只读”，也无法构成可验证的安全边界。

## Decision

项目根仅能由本机 `evctl project authorize` 明确授权。Core 对授权根建立规范化、大小受限、文件 allowlist 的 `ProjectSnapshot`；它排除密钥、环境文件、依赖、二进制和授权根外路径。ProjectAnalysisProvider 只接收该快照与精确分析请求，没有 Shell、Git 写入或文件系统写工具。

Project Agent 的产物限于 Project Brief、风险、阶段建议、Action Draft 和 TimeRequest。用户确认项目里程碑只更新本应用的项目记录/记忆，绝不修改被分析仓库。任何未来“实现代码”能力必须通过新的 ADR、新的产品范围和显式用户授权重新设计。

## Alternatives Considered

### 保留 ADR-006 的隔离 Implement Runner

虽然可在 worktree 中降低风险，但仍是项目写入能力，超出当前产品边界，也会使远程 Dashboard 触发本机代码改动。

### 仅以 prompt 约束 Codex 不要写文件

提示词不是权限系统，无法抵御提示词注入、模型错误或工具误用。

### 不读取任何本地项目

最安全，但失去“依据真实项目进度建议今天怎么做”的核心价值。

## Consequences

- 需要实现 ProjectSnapshotBuilder、路径规范化、符号链接防逃逸、文件/总量上限及零写入测试。
- Codex 接入若不能运行在无原仓库写权限的模式，必须保持未配置状态。
- ADR-006 中 Provider 分域路由和 schema 校验原则仍有效；其 Project Runner 写入部分不再有效。
