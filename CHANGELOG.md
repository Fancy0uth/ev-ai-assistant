# Changelog

## [0.5.0] — Unreleased（待合并）

此版本仍待合并，尚未发布。真实 DeepSeek 人工验收为 `NOT RUN — APPROVAL REQUIRED`；自动测试只使用显式注入的 Fake Provider。

### Changed

- Core 的 live health 响应报告版本 `0.5.0`。
- README 说明了本地单 Owner Dashboard 技术预览的启动方式与能力边界。
- Today 从“任务摘要”扩展为日程、行动、恢复 Signal 和 Proposal 的本地控制台入口。
- 每日计划的生产自动触发改为 Shanghai 07:00 一次性 timer 与当天首次访问补偿；旧通用 `daily_plan_jobs` 定时器不再由 Core 启动。

### Added

- Provider Reliability 的统一版本、DeepSeek 模型/finish reason/usage 允许字段契约；后续切片将以此为 SQLite v18、幂等与脱敏日志的唯一边界。

- 日程/课表、学习、健身、饮食、记忆和项目的真实 Dashboard 路由与响应式工作区。
- 学期、课程资料、课表导入请求、日计划 Proposal、恢复 check-in、已确认餐食和只读项目 scope 的本地数据层。
- SQLite revision 与 Markdown 投影结合的分域本地记忆，并支持保存、历史、恢复和删除。
- Provider-neutral Agent/Provider 契约；未配置 Provider 时明确阻断，不伪造 AI 输出。
- DeepSeek Daily Plan 的 DPAPI 凭据存储、最小 Context Manifest、结构化草案、逐项确认和本地解释接口；草案仍不会自动写入日程。
- Daily Plan Run 的 `GENERATING`/`FAILED` 可见状态、同日自动运行唯一约束，以及审阅页按需显示上下文类别、当前日程版本与冲突校验。
- 独立数据目录的桌面/移动浏览器 E2E，以及 Windows 受管 E2E 进程 runner。

### Fixed

- Today 遗漏恢复 Signal 的聚合问题。
- BFF 未转发 `PUT` 导致本地记忆保存失败的问题。
- Windows E2E 完成后遗留 Core/Web 子进程的问题。
- 课程资料链接可接受危险协议、记忆投影失败导致版本失同步、以及 E2E 可能碰到被占用测试端口的问题。
- E2E 不再遗留 Next 自动改写的类型声明或成功测试的构建缓存。
- Provider 架构支持 Owner 配置的 DeepSeek 调用，并为后续受限本地 Codex adapter 保留契约；自动化测试始终使用 Fake Provider。
- 日期切换后旧的每日计划生成错误不再覆盖当前日期页面。

## [0.1.0] — 技术预览

首个本地单 Owner Dashboard 技术预览：提供本地账号、任务和规则驱动的今日状态；不提供真实 AI Provider、长期记忆或外部集成。
