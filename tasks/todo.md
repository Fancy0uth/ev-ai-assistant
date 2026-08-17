# EV AI Dashboard MVP 任务清单

详细 RED/GREEN、接口、文件与提交规则见 [实施计划](../docs/superpowers/plans/2026-08-17-local-ai-dashboard-mvp.md)。

## Phase 0：基线

- [x] T01：修复 npm workspace 安装边界和 Web Vitest 启动。
- [x] T02：定位并修复 Core Auth/Agent/Task 契约运行时回归。

## Phase 1：日程核心

- [x] T03：定义 Event、Action、ActivitySession、Signal、Proposal 的共享契约与纯领域规则。
- [x] T04：以加法 SQLite 迁移和 Repository 建立日程/Proposal 数据层，并证明旧数据保留。
- [x] T05：实现 Proposal 版本确认、冲突检测与 Today Day View 聚合。
- [x] T06：实现 Course Import Run、周次到日期展开与 07:00 持久 Job。

## Phase 2：Agent 与专业模块

- [x] T07：实现 Provider Profile、Context Manifest、Agent Run 和未配置的诚实状态。
- [x] T08：实现本地分域记忆 revision/Markdown 投影与恢复。
- [x] T09：实现授权项目快照与只读 Project Brief。
- [ ] T10：课程档案、资料引用和预习 Action Proposal。（本轮已交付课程档案/资料引用；公开检索与预习 Proposal 延后）
- [ ] T11：Check-in、恢复 Signal、动作目录和 Workout Proposal。（本轮已交付 Check-in/恢复 Signal；动作目录/RAG/Proposal 延后）
- [ ] T12：食物候选、可替换数据 Provider、确认后的饮食记录。（本轮已交付人工确认餐食；自然语言候选/Provider 延后）

## Phase 3：Web 控制台

- [x] T13：重建真实路由 Shell、Today 控制台、日程/Proposal 页面。
- [x] T14：实现项目、课程、健身、饮食的不同详情工作区。
- [x] T15：实现 Agent/记忆/Provider 设置页，并完成桌面与 iPhone 响应式。

## Phase 4：验证与交付

- [x] T16：补齐 Core/Contracts/Domain 集成回归测试与迁移测试。
- [x] T17：执行最小桌面/iPhone E2E，记录并修复 P0/P1 bug。
- [x] T18：完成变更记录、测试报告、已知限制、验收文档和独立本地预览。

---

## v0.3：Daily AI Control Loop（实施中）

详细边界与每项验收条件见 [v0.3 规格](../docs/superpowers/specs/2026-08-17-v0.3-daily-ai-control-loop.md) 和 [v0.3 实施计划](../docs/superpowers/plans/2026-08-17-v0.3-daily-ai-control-loop.md)。

- [x] V3-01：冻结 Provider 密钥、状态、错误码和 Owner 授权契约。
- [ ] V3-02：实现 `SecretStorePort` 与 Windows DPAPI 密钥 adapter。
- [ ] V3-03：实现 DeepSeek adapter、Provider 设置和主动连接测试。
- [ ] V3-04：冻结 Daily Plan、Proposal Item 与 Context Manifest 契约。
- [ ] V3-05：完成加法迁移与最小每日计划 Context Builder。
- [ ] V3-06：实现生成、确定性校验和保存 Daily Plan Proposal。
- [ ] V3-07：实现草案编辑、部分确认、拒绝与日程版本冲突处理。
- [ ] V3-08：重构 Today 为日程优先的 Daily Control Console。
- [ ] V3-09：实现可见 Context、Plan Review 与确认 UI。
- [ ] V3-10：实现 07:00 幂等触发/首访补偿、端到端验收与发布文档。
