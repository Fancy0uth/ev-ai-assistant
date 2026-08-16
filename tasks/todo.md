# EV AI Dashboard MVP 任务清单

详细 RED/GREEN、接口、文件与提交规则见 [实施计划](../docs/superpowers/plans/2026-08-17-local-ai-dashboard-mvp.md)。

## Phase 0：基线

- [x] T01：修复 npm workspace 安装边界和 Web Vitest 启动。
- [x] T02：定位并修复 Core Auth/Agent/Task 契约运行时回归。

## Phase 1：日程核心

- [x] T03：定义 Event、Action、ActivitySession、Signal、Proposal 的共享契约与纯领域规则。
- [ ] T04：以加法 SQLite 迁移和 Repository 建立日程/Proposal 数据层，并证明旧数据保留。
- [ ] T05：实现 Proposal 版本确认、冲突检测与 Today Day View 聚合。
- [ ] T06：实现 Course Import Run、周次到日期展开与 07:00 持久 Job。

## Phase 2：Agent 与专业模块

- [ ] T07：实现 Provider Profile、Context Manifest、Agent Run 和未配置的诚实状态。
- [ ] T08：实现本地分域记忆 revision/Markdown 投影与恢复。
- [ ] T09：实现授权项目快照与只读 Project Brief。
- [ ] T10：实现课程档案、资料引用和预习 Action Proposal。
- [ ] T11：实现 Check-in、恢复 Signal、动作目录和 Workout Proposal。
- [ ] T12：实现食物候选、可替换数据 Provider、确认后的饮食记录。

## Phase 3：Web 控制台

- [ ] T13：重建真实路由 Shell、Today 控制台、日程/Proposal 页面。
- [ ] T14：实现项目、课程、健身、饮食的不同详情工作区。
- [ ] T15：实现 Agent/记忆/Provider 设置页，并完成桌面与 iPhone 响应式。

## Phase 4：验证与交付

- [ ] T16：补齐 Core/Contracts/Domain 集成回归测试与迁移测试。
- [ ] T17：执行最小桌面/iPhone E2E，记录并修复 P0/P1 bug。
- [ ] T18：完成变更记录、测试报告、已知限制、验收文档和独立本地预览。
