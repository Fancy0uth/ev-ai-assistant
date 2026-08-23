# EV AI Dashboard MVP 任务清单

执行边界、依赖和命令以 [总路线](../docs/superpowers/plans/2026-08-23-v0.4-v0.9-mvp-roadmap.md) 与各版独立计划为准。以下 ID 与计划一一对应；版本之间不得跳序。

## v0.4：Action Scheduling Foundation

- [x] V4-01：冻结 optional 排程、origin、ACTIVE/CLOSED、preflight 契约及无损 migration v17。
- [x] V4-02：实现可审计 TimeRequest 生命周期，并让新 Daily Plan context 只读取 ACTIVE。
- [x] V4-03：以本地 Unit of Work 原子同步 Task↔TimeRequest，并提供 Task 详情 API。
- [x] V4-04：拆分持久 preflight 与事务外 Provider 调用，明确 `service.ts` 和 `app.ts` 装配。
- [x] V4-05：暴露 preflight/07:00 fail-closed、手工 Event Proposal 与 Event 详情 API。
- [x] V4-06：提取 focused preflight component/hook，完成 Task/Event/Project Web 详情路由。
- [x] V4-07：修正可聚焦 E2E runner，并证明无业务数据 SQLite 注入的 UI-origin 闭环。

## v0.5：Provider Reliability

- [x] V5-01：冻结运行包络契约并完成无损 migration v18。
- [x] V5-02：端到端实现 `Idempotency-Key` 与 BFF 白名单转发。
- [x] V5-03：实现陈旧 Run 恢复、超时、配额和有界重试。
- [x] V5-04：持久化脱敏 Provider 调用日志与分层 health 元数据。
- [x] V5-05：建立单一版本事实并同步 0.5.0 package/health/run 元数据。
- [x] V5-R1：按 Sol FAIL review 集中关闭 atomic UoW、STALE、quota、recovery、migration 五个 P1，并通过最小验证矩阵。
- [ ] V5-06：test-only Fake、DPAPI port 与脱敏自动证据已完成；真实 DeepSeek 人工验收仍为 `NOT RUN — APPROVAL REQUIRED`。

## v0.6：Learning and Schedule Loop

- [ ] V6-01：冻结 artifact/import revision/citation 契约并完成无损 migration v19。
- [ ] V6-02：实现私有 artifact store 与真实 Vision Provider adapter。
- [ ] V6-03：完成低置信候选编辑确认到 Course/Rule/Event Proposal。
- [ ] V6-04：公开检索带来源地生成 Learning Action→TimeRequest Proposal。
- [ ] V6-05：交付课程 UI、聚焦 E2E、真实截图/检索证据并同步 0.6.0 元数据。

## v0.7：Fitness and Nutrition Loop

- [ ] V7-01：冻结健身/饮食契约并完成无损 migration v20。
- [ ] V7-02：建立有来源、版本和许可记录的动作知识库与受限 RAG。
- [ ] V7-03：完成 Check-in→Signal→Workout Proposal→TimeRequest→反馈。
- [ ] V7-04：完成自然语言餐食→权威营养数据→Owner 确认链。
- [ ] V7-05：交付健身/饮食 UI、聚焦 E2E、真实数据源证据并同步 0.7.0 元数据；不做医疗诊断。

## v0.8：Project, Memory and Coordination

- [ ] V8-01：把项目路径授权移到本机 CLI，并封闭 Web/BFF local-admin 路径。
- [ ] V8-02：实现有界零写 snapshot 与真实只读项目分析/Action→TimeRequest。
- [ ] V8-03：增加实体级本地记忆 v2 并完成无损 migration v21。
- [ ] V8-04：实现可审查、自动有界的记忆压缩与 append-only 恢复。
- [ ] V8-05：跨模块只生成一个 Owner/日期活跃排程 Proposal，完成浏览器证据并同步 0.8.0 元数据。

## v0.9：Private iPhone Operations and Final MVP

- [ ] V9-01：固化 Web-only 私有 HTTPS、应用认证、Origin/CSRF 和 Core loopback 边界。
- [ ] V9-02：建立 Windows 受管启动、自启动、卸载与 dry-run 测试。
- [ ] V9-03：实现 SQLite WAL 一致备份、manifest 校验与可回滚恢复。
- [ ] V9-04：增加本地脱敏运行日志、轮转与匿名/Owner 分层 health。
- [ ] V9-05：完成聚焦浏览器矩阵和经审批物理 iPhone Safari 验收。
- [ ] V9-06：对齐 0.9.0 版本并执行全仓 test/typecheck/lint/build/E2E/audit、迁移/恢复与浏览器矩阵。

---

## 历史任务：基础 MVP（保留）

详细 RED/GREEN、接口、文件与提交规则见 [历史实施计划](../docs/superpowers/plans/2026-08-17-local-ai-dashboard-mvp.md)。

### Phase 0：基线

- [x] T01：修复 npm workspace 安装边界和 Web Vitest 启动。
- [x] T02：定位并修复 Core Auth/Agent/Task 契约运行时回归。

### Phase 1：日程核心

- [x] T03：定义 Event、Action、ActivitySession、Signal、Proposal 的共享契约与纯领域规则。
- [x] T04：以加法 SQLite 迁移和 Repository 建立日程/Proposal 数据层，并证明旧数据保留。
- [x] T05：实现 Proposal 版本确认、冲突检测与 Today Day View 聚合。
- [x] T06：实现 Course Import Run、周次到日期展开与 07:00 持久 Job。

### Phase 2：Agent 与专业模块

- [x] T07：实现 Provider Profile、Context Manifest、Agent Run 和未配置的诚实状态。
- [x] T08：实现本地分域记忆 revision/Markdown 投影与恢复。
- [x] T09：实现授权项目快照与只读 Project Brief。
- [ ] T10：课程档案、资料引用和预习 Action Proposal。（已交付课程档案/用户 URL；公开检索、视觉确认和预习 Proposal 由 v0.6 完成）
- [ ] T11：Check-in、恢复 Signal、动作目录和 Workout Proposal。（已交付 Check-in/恢复 Signal；动作目录/RAG/Proposal 由 v0.7 完成）
- [ ] T12：食物候选、可替换数据 Provider、确认后的饮食记录。（已交付人工确认餐食；自然语言候选/权威 Provider 由 v0.7 完成）

### Phase 3：Web 控制台

- [x] T13：重建真实路由 Shell、Today 控制台、日程/Proposal 页面。
- [x] T14：实现项目、课程、健身、饮食的不同详情工作区。
- [x] T15：实现 Agent/记忆/Provider 设置页，并完成桌面与 iPhone 响应式。

### Phase 4：验证与交付

- [x] T16：补齐 Core/Contracts/Domain 集成回归测试与迁移测试。
- [x] T17：执行最小桌面/iPhone E2E，记录并修复 P0/P1 bug。
- [x] T18：完成变更记录、测试报告、已知限制、验收文档和独立本地预览。

## 历史任务：v0.3 Daily AI Control Loop（已完成）

详细边界与验收条件见 [v0.3 规格](../docs/superpowers/specs/2026-08-17-v0.3-daily-ai-control-loop.md) 和 [v0.3 实施计划](../docs/superpowers/plans/2026-08-17-v0.3-daily-ai-control-loop.md)。完成表示工程切片完成，不改变 [v0.3 Sol 审查](../docs/reviews/2026-08-23-v0.3-sol-minimum-viability-review.md) 对完整产品 MVP 的 FAIL 结论。

- [x] V3-01：冻结 Provider 密钥、状态、错误码和 Owner 授权契约。
- [x] V3-02：实现 `SecretStorePort` 与 Windows DPAPI 密钥 adapter。
- [x] V3-03a：实现 DeepSeek 连接测试 Core 与结果持久化。
- [x] V3-03b：实现 Owner Provider API、设置页和主动连接测试入口。
- [x] V3-04：冻结 Daily Plan、Proposal Item 与 Context Manifest 契约。
- [x] V3-05：完成加法迁移与最小每日计划 Context Builder。
- [x] V3-06：实现生成、确定性校验和保存 Daily Plan Proposal。
- [x] V3-07：实现草案编辑、部分确认、拒绝与日程版本冲突处理。
- [x] V3-08：重构 Today 为日程优先的 Daily Control Console。
- [x] V3-09：实现可见 Context、Plan Review 与确认 UI。
- [x] V3-10：实现 07:00 幂等触发/首访补偿、端到端验收与发布文档。
