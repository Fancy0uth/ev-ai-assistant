# ADR-005: 采用单所有者、本地优先的 Web + Core 架构

## Status

Accepted — supersedes ADR-001 and ADR-002.

## Date

2026-08-07

## Context

产品方向已经从“云端 Web + 可选本地 Bridge”调整为一台常开 Windows 电脑承载全部业务数据、Agent Loop、模型密钥和累积记忆。iPhone 只需要远程操控同一套 Dashboard，不需要独立数据库或云端同步。

核心约束是：只接入模型 API 即可工作；任务、生活、项目和记忆数据不能上传到产品云端；以后仍要能打包成其他用户可部署的软件。

## Decision

采用两个独立运行单元：Next.js Web 与 Fastify Local Agent Core。Web 负责用户界面和 same-origin BFF；Core 是认证、SQLite、Scheduler、Agent、审批和审计的唯一所有者。二者通过 `/v1` 版本化契约通信，契约位于共享 package。

Web 和 Core 仅绑定 loopback。远程访问通过宿主机的 Tailscale Serve 提供私有 HTTPS，只有 Web 对手机可见。首版不使用 Supabase 或其他云端数据库。

## Alternatives Considered

### 继续使用 Supabase

跨设备同步简单，但会把产品变成云端数据系统，不符合当前明确的本地数据边界，也增加部署账号、RLS 和外部可用性依赖。

### 把全部能力放进 Next.js

初始文件更少，但 UI、调度、数据库和 Codex 执行会紧密耦合，后续 Docker、桌面控制器和独立 Runner 都难以演进。

### 桌面原生应用优先

本机集成自然，但会推迟当前最重要的 Web 与 iPhone 远程访问路径。

## Consequences

- 无模型、无互联网时，核心数据功能仍可使用。
- 需要维护清晰的 Web/Core 契约和两个进程的健康状态。
- 手机离线写入和多设备数据库合并不属于 v1。
- 未来 Docker 化只改变进程包装和数据挂载，不改变领域接口。
