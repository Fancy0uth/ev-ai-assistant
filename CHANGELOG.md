# Changelog

## [0.2.0] — Unreleased（待合并）

此版本仍待合并，尚未发布。

### Changed

- Core 的 live health 响应报告版本 `0.2.0`。
- README 说明了本地单 Owner Dashboard 技术预览的启动方式与能力边界。
- Today 从“任务摘要”扩展为日程、行动、恢复 Signal 和 Proposal 的本地控制台入口。

### Added

- 日程/课表、学习、健身、饮食、记忆和项目的真实 Dashboard 路由与响应式工作区。
- 学期、课程资料、课表导入请求、日计划 Proposal、恢复 check-in、已确认餐食和只读项目 scope 的本地数据层。
- SQLite revision 与 Markdown 投影结合的分域本地记忆，并支持保存、历史、恢复和删除。
- Provider-neutral Agent/Provider 契约；未配置 Provider 时明确阻断，不伪造 AI 输出。
- 独立数据目录的桌面/移动浏览器 E2E，以及 Windows 受管 E2E 进程 runner。

### Fixed

- Today 遗漏恢复 Signal 的聚合问题。
- BFF 未转发 `PUT` 导致本地记忆保存失败的问题。
- Windows E2E 完成后遗留 Core/Web 子进程的问题。
- 课程资料链接可接受危险协议、记忆投影失败导致版本失同步、以及 E2E 可能碰到被占用测试端口的问题。
- E2E 不再遗留 Next 自动改写的类型声明或成功测试的构建缓存。
- Provider 架构现在可同时登记 DeepSeek 与本地 Codex adapter，但仍不包含真实凭据或 API 调用。

## [0.1.0] — 技术预览

首个本地单 Owner Dashboard 技术预览：提供本地账号、任务和规则驱动的今日状态；不提供真实 AI Provider、长期记忆或外部集成。
