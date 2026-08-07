# ADR-008: 先交付 Windows 原生个人版，再提供 Docker 包

## Status

Accepted.

## Date

2026-08-07

## Context

当前电脑将长期作为服务器，并需要访问该 Windows 用户的 Codex CLI、Git 凭据、本地仓库、Tailscale 和系统凭据。项目以后又需要变成其他用户可以部署的自托管软件。

## Decision

首先以 Windows 当前用户进程运行 Web、Core 和 Scheduler，并在登录后自动启动。程序与用户数据目录分离，远程访问由宿主机 Tailscale Serve 提供。

个人稳定版通过连续运行、备份恢复和安全验收后，再提供 Docker Compose。容器保存 Web/Core，SQLite 使用持久卷，Secret 使用文件挂载；Windows Codex Runner 和 Tailscale 可继续运行在宿主机。

## Alternatives Considered

### 从第一天全部运行在 Docker

打包统一，但 Windows 仓库路径、Git/Codex 凭据和宿主机工具调用会成为首个迭代的主要问题，而不是产品功能。

### 永远只支持原生 Windows

当前开发最快，但不利于未来开源、自托管和 Linux 用户部署。

## Consequences

- 核心接口和数据目录从第一天按可容器化方式设计。
- Docker 不是功能完成的前置条件，也不能成为绕过备份和恢复测试的交付捷径。
- Project Runner 保持可拆分，以适应宿主机或 Linux 容器两种部署。
