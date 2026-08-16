# EV AI Dashboard 技术基线审查

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-08-17 |
| 审查范围 | 现有 v0.2 原型、已批准 PRD/MVP 与本次技术设计 |
| 结论 | **Request changes：不得在该测试基线上直接扩展产品功能** |

## 1. 审查证据

### 静态结构

- Code Intel lite：`completed`。
- 工件目录：`C:\\Users\\asus\\AppData\\Local\\code-intel\\artifacts\\product-prd\\1786905497646-3624-core`。
- 原生证据：129 个文件、303 个符号、312 条 import。
- 限制：本次 Code Intel 版本未生成 `summary.md`、`hospital.md`、`understanding.md` 或 `report.json`，只有 content-addressed JSON；关系精度标记为 `heuristic`，因此不能把它当作完整调用图或 hospital 结论。

### 自动测试复测

执行命令：`npm test`

| 测试区域 | 结果 | 证据 |
| --- | --- | --- |
| legacy dashboard | 3/3 通过 | Node test 退出成功 |
| contracts | 23/23 通过 | Vitest 通过 |
| domain | 3/3 通过 | Vitest 通过 |
| core | 45/59 通过，14 失败 | auth、agent API、task 409 路径失败 |
| web | 无法启动 | `ERR_MODULE_NOT_FOUND: @vitejs/plugin-react` |

`apps/web/package.json` 与 `package-lock.json` 都声明 `@vitejs/plugin-react@6.0.5`，但 `npm ls @vitejs/plugin-react --workspace @ev/web` 返回空树，证明当前安装树与锁文件/manifest 不一致。该现象需要先复现并修复安装边界，不能把缺少插件误判为应用逻辑已通过。

## 2. 发现与处置

### Required — BASELINE-001：Core HTTP 契约回归

**严重级别：P1 / 阻断后续功能测试**

认证端点、Agent 端点和 Task 版本冲突测试出现 500 或响应形状不符。典型证据包括：

- `GET /v1/auth/session` 预期 200，却返回 500；
- setup/login 的响应实际缺少 `authenticated: true`；
- Agent session/capability 的测试出现 `Cannot read properties of undefined (reading 'parse')`，或预期 2xx/4xx 而实际 500；
- Task stale-version 应返回 409，却实际为 500。

源代码中的 `sessionResponseSchema` 与 route 表达的意图看似正确，故不能仅修改断言。必须先确认测试运行时实际解析到了哪个 `@ev/contracts` 模块、导出是否一致、是否存在 workspace 链接/安装树陈旧，以及错误处理器的真实原始异常。修复后必须新增或保留能捕获该运行时解析问题的回归测试。

**处理决定：** 任务拆解中的第一条实现切片；在它全绿前，不合并任何基于 Core 的新领域功能。

### Required — BASELINE-002：Web 测试安装边界不完整

**严重级别：P1 / 阻断 Web 回归测试**

Web Vitest 在加载 `vitest.config.ts` 前即失败，因为运行时找不到 manifest/lockfile 已声明的 `@vitejs/plugin-react`。这使组件、BFF 和移动交互没有可信回归覆盖。

**处理决定：** 确定唯一 npm workspace 安装根，使用与锁文件一致的受控安装流程恢复依赖；修复后验证 `npm ls`、Web Vitest、typecheck 和 E2E 入口。不得手动伪造 `node_modules`、删除测试或修改 lockfile 以制造通过。

### Required — PRODUCT-ARCH-001：原型的 Task/聊天模型不符合已批准产品

**严重级别：P1 / 产品架构阻断**

当前 Core 只有 `tasks`、`agent_sessions/messages`、`today` 聚合。它没有 Event/Action/ActivitySession/Signal、课程规则/日期实例、Proposal、分域记忆、Provider 配置、项目快照或 07:00 Job。因此继续在旧 `tasks` 上叠加字段会违背 PRD 的“日程为骨架、模块拥有详情”原则。

**处理决定：** 采用 [TECH_SPEC](../technical/TECH_SPEC.md) 与 [ARCHITECTURE](../technical/ARCHITECTURE.md) 的模块化扩展和加法迁移；旧 Task 仅迁移为保留来源的 Action。

### Required — SECURITY-001：旧 Project Runner 决策与当前只读承诺冲突

**严重级别：P1 / 安全边界**

ADR-006 曾允许经审批的 Implement Runner。当前 PRD 明确禁止 Agent 修改用户项目；仅提示模型“不要写”不是权限控制。

**处理决定：** [ADR-010](../decisions/ADR-010-project-analysis-is-snapshot-only-read-only.md) 已取代其项目写入部分。新的设计仅允许过滤后的只读快照。

### P2 — TEST-002：E2E 与真实手机验证尚未覆盖新产品流程

现有 E2E 覆盖的是 Owner/Task Dashboard 原型；它无法证明课表导入、Proposal 确认、健身/饮食确认、Provider 未配置或 iPhone 日程流。后续按 MVP 垂直切片增加独立数据目录与浏览器尺寸覆盖。

## 3. 五维审查摘要

| 维度 | 结论 | 说明 |
| --- | --- | --- |
| 正确性 | 不通过 | Core 契约和 Web 测试启动失败 |
| 可读性 | 有可复用基础 | route/service/repository 和 contracts/domain 分层已存在 |
| 架构 | 需重构领域，不需推倒进程边界 | Web/Core/SQLite 可保留；Task/普通聊天中心不符合产品 |
| 安全 | 基础方向可用但必须补完 | loopback、HttpOnly、rate-limit 有基础；Provider/上传/项目快照/Proposal 尚未实现 |
| 性能 | 无 P1 性能发现 | 未来需对大项目快照、RAG、周次展开和 Job 做上限/分页/异步隔离 |

## 4. 进入任务拆解的门槛

1. 明确并修复 BASELINE-001 与 BASELINE-002；
2. 对既有 Owner、Task、Agent 会话的迁移写出数据保持测试；
3. 每个新领域模块按 Contracts → Domain → Core → Web → E2E 的依赖顺序切片；
4. 任何新的 Provider、Secret Store 或外部数据源在实现前单独进行依赖/安全审查；
5. 完成后重新运行完整质量命令和 Code Intel/Sentrux 检查。
