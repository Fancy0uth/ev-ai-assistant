# Changelog

## [0.6.0] — Unreleased（待合并）

此版本仍待合并，尚未发布。真实 Vision、公开 Search 与 DeepSeek Learning Provider 验收均为 `NOT RUN — APPROVAL REQUIRED`；自动证据仅来自三重门保护的 `AUTOMATED_FAKE` adapter。

### Added

- 私有课表图片的受限原始上传、可编辑的 Owner revision、Course/Rule lineage 和确认后才展开的排程 Proposal。
- 每门课程的公开 citation metadata、HTTPS/DNS-pinned 安全抓取边界、严格 cited learning advice 与 Course-linked Action/TimeRequest/Today STUDY Event 闭环。
- desktop 与 iPhone 受管 E2E，基于真实 Core UUID lineage 证明同名历史事实不会重复物化。

### Changed

- 新的 health、capability run 与 Daily Plan 写入报告 `0.6.0`；既有持久化的 `0.5.0` app version 不被迁移改写。

## [0.5.0] — Unreleased（待合并）

此版本仍待合并，尚未发布。真实 DeepSeek 人工验收为 `NOT RUN — APPROVAL REQUIRED`；自动测试只使用显式注入的 Fake Provider。

### Changed

- Core 的 live health 响应报告版本 `0.5.0`。
- README 说明了本地单 Owner Dashboard 技术预览的启动方式与能力边界。
- Today 从“任务摘要”扩展为日程、行动、恢复 Signal 和 Proposal 的本地控制台入口。
- 每日计划的生产自动触发改为 Shanghai 07:00 一次性 timer 与当天首次访问补偿；旧通用 `daily_plan_jobs` 定时器不再由 Core 启动。

### Added

- SQLite v18 的 Owner-scoped 幂等记录、Daily Plan Run lease/recovery 元数据与仅允许字段的 Provider 调用日志；既有 Owner、Task、Run、Proposal 与 Provider metadata 保持可读。
- 三个高影响写入口的 `Idempotency-Key` 契约（replay、in-progress、conflict、Owner 隔离）以及 Web BFF 请求/响应 header allowlist。
- DeepSeek Daily Plan 的集中 Provider policy：冻结 endpoint/模型、非流式结构化结果、finish reason/usage allowlist、超时、配额、lease token、一次恢复和晚到响应拒绝。
- Provider Reliability 的隔离浏览器证据：真实 Web prepare → approve → generate 路径、同键 replay、语义冲突、未配置 Provider 和桌面/iPhone 视口。

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
- Web preflight 对 schema-valid 但 action、run、日期、版本或 payload 语义不一致的响应 fail closed；不再只凭 HTTP 成功继续。
- 过时的 Daily Plan E2E 已对齐三步审核门与 v0.5 强制幂等键；Contracts 冲突响应 fixture 已对齐 `scheduling: null` 的规范输出。
- Provider 返回后的业务终态、脱敏调用日志和幂等 HTTP snapshot 现在由同一短事务提交；成功/失败 fault injection 均证明全有或全无。
- schedule drift 的 `STALE/version` 与 409 replay snapshot 同事务持久化，不再因异常传播被外层回滚。
- Owner 日配额按实际调用时的上海自然日原子预留，并在 Key 解密和网络前拒绝超限请求；terminal 使用 allowlisted actual usage 对账。
- 启动和第二次过期请求会用同一恢复 UoW 收敛 Run、preflight、STARTED log 与幂等记录，且不会在启动阶段调用 Provider。
- v18 的 app version 字段允许历史 semver/null，旧 v17 Run 不再虚报当前版本，0.6 写入无需重建 v18 表。
- Manual Event 与 Today Proposal 的不确定重试会在 transport 0、BFF 502 或响应解析失败时复用同一语义幂等键。
- 启动恢复会沿 idempotency resource → Owner preflight → Run/STARTED log 验证完整 correlation；执行已开始但关联损坏时整笔回滚并拒绝启动，不再留下部分终态。
- Today Proposal 只有在 2xx 响应通过 schema、id、递增 version 和 decision terminal status 校验后才释放幂等键；malformed 或语义不一致响应可安全复用原键重试。

## [0.1.0] — 技术预览

首个本地单 Owner Dashboard 技术预览：提供本地账号、任务和规则驱动的今日状态；不提供真实 AI Provider、长期记忆或外部集成。
