# ADR-006: DeepSeek 与 Codex 分域路由，并隔离项目执行边界

## Status

Accepted.

## Date

2026-08-07

## Context

生活梳理和记录提取成本较低，项目分析和代码修改需要仓库上下文及更强工具能力。让单个模型拥有全部数据和工具既浪费成本，也放大误操作范围。

## Decision

Agent Router 根据领域、工具需求和风险选择执行者：DeepSeek 默认处理日常简报、饮食、训练和简单整理；Codex 默认处理用户明确登记的本地 Git 项目。

Codex Project Runner 是单独的权限边界。默认只读；Implement 必须绑定精确仓库、任务、审批和实体版本，并进入隔离分支或 worktree。Verify 只执行批准的检查。Runner 禁止自动 push、merge、发布和访问授权根目录之外的路径。

模型只产生计划或候选工具调用，Core 的策略引擎决定是否允许执行。模型输出经过 schema 校验，不能自行扩大权限。

## Alternatives Considered

### 所有请求都使用 Codex

实现表面统一，但生活任务成本和延迟更高，同时不必要地让代码工具接触更多个人数据。

### 所有请求都使用 DeepSeek

适合普通对话和结构化提取，但无法可靠承担本地仓库调查、隔离改动和验证闭环。

### 让模型自行选择工具权限

灵活但不可审计，Prompt Injection 或错误规划可能直接扩大副作用。

## Consequences

- 每个 Provider 必须实现统一接口，业务代码不依赖供应商专有消息格式。
- 必须测试路由决策、权限拒绝、路径约束、审批过期和隔离工作区。
- Docker 版本在 Windows 上可以继续使用宿主机 Runner，而不必把全部仓库挂载给容器。
