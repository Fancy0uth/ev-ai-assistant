# 本地优先个人 AI Dashboard：实施清单

## Milestone 0.1：Owner Task Dashboard

- [x] Task 1：建立 npm workspaces、共享契约和测试工具。
- [x] Task 2：建立只监听 loopback 的 Core 健康链路。
- [x] Task 3：建立 SQLite 生命周期和原子迁移。
- [x] Task 4：实现单 Owner 初始化、登录、会话和退出。
- [x] Task 5：实现版本化、Owner 隔离的任务 API。
- [x] Task 6：实现规则可解释的 Today 聚合。
- [x] Task 7：实现 Next.js BFF 和账号界面。
- [x] Task 8：实现真实 Today Dashboard、E2E 和运行文档。

Milestone 0.1 验收门已全部通过；证据记录在对应实施计划、自动化测试和 README 中。

### 0.1 可靠性维护

- [x] Today 按完整日期任务集聚合，保留 `/tasks` 的分页上限。
- [x] 保存期间保护任务草稿，后续刷新不清空下一条输入。
- [x] 忽略过期刷新响应，各任务独立维护写入状态。
- [x] 区分写入成功与读取失败，提供不会重复创建的读取重试。
- [x] 按上海日期处理午夜、前台恢复和提交前检查，旧日请求不覆盖新日状态。
- [x] 已知请求格式、类型和大小错误返回脱敏的 4xx；未知异常仍返回 500。
- [x] 平板导航和退出控件保留可访问名称，并覆盖真实断点与键盘操作。

## 后续里程碑

- [ ] 0.2：本地日程、时间块、习惯、提醒、Scheduler 和昨日统计。
- [ ] 0.3：DeepSeek Provider、每日简报和生活草稿审批。
- [ ] 0.4：本地项目、Future Work 和 Codex 只读模式。
- [ ] 0.5：Codex 隔离写入、验证、审计和恢复。
- [ ] 0.6：身体、训练、饮食、长期记忆和审批中心。
- [ ] 0.7：Tailscale、备份恢复、长期运行与安全验收。
- [ ] 1.0：Windows 稳定版与 Docker 自托管预览。
