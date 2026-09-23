# API：已核对入口与待设计边界

## 服务器MVP：营养数据凭据

`GET /v1/providers/usda/credential` 只返回`providerKey: USDA_FDC`、`state: CONFIGURED | NOT_CONFIGURED`和`updatedAt`，不解密、不联网、不返回密钥。`PUT`接收`{apiKey}`，加密保存，拒绝公共`DEMO_KEY`；保存不等于连接验证。`DELETE`接收`{confirm:true}`移除配置。均要求Owner会话；格式错误422、存储不可用503。Web经现有同源BFF/CSRF访问，不增加跨域直连。

`GET /v1/health-capabilities`按Owner本地配置解析文本及营养能力。现有`meal-drafts`解析和`matches`匹配路径分别使用DeepSeek和营养数据来源，外发确认、版本与幂等约束不变。配置可用不等于真实调用已通过；证据见[TASKS](../plans/TASKS.md)。

## 自然语言事项

`POST /v1/event-language/parse`要求Owner会话、最多30次/分钟；输入`{text,referenceDate,timezone:"Asia/Shanghai",externalProcessingConfirmed:true}`，text最多1000字符。缺明确确认422、无配置或调用不可用503。返回可含null字段的`candidate`、`missingFields`和与已确认Event重叠的`conflicts`，只发送这条描述及参考日期/时区，不把本地日程外发。此端点不创建Event或Proposal；补全候选后仍使用`event-proposals`及原确认接口。冲突说明针对解析时的候选，修改后需重新核对当日日程，不能视作实时无冲突保证。

> 2026-09-16 退役决策：项目列表、快照、Brief、外发预览/授权及本机项目授权入口退出产品；项目独立会话此前未注册 HTTP 接口，也不再继续接线。下文不再提供这些功能的调用说明。具体退役检查与响应证据见 TASKS，不将文档变更当作代码已通过验证。

浏览器经同源 `/api/core/*` 访问固定 loopback Core；下列是 Core 路径，不是浏览器直连地址。现有受保护接口使用 Owner 会话。本文仅列本次核对的三链相关接口，不声称穷尽所有路由。

## DeepSeek 凭据与模块可用性不是同一状态

`GET /v1/providers/deepseek/credential` 只读当前Owner的脱敏配置/最近测试元数据，不解密返回密钥、不发起连接测试。配置存在、最近一次测试成功、某个业务模块已接通分别是不同事实；最近测试成功不保证实时可达。状态读取失败必须显示未知/读取失败，不能沿用旧成功。

当前启动装配将这份凭据交给每日计划与课程文本学习建议。通用对话仍依赖显式注入的 AgentProvider；默认启动未注入，不能因为DeepSeek已配置就宣称可用。项目分析已取消，不再有待连接的项目 Provider。配置页的连接测试是用户主动发起的真实请求，与状态展示所用的GET读取分开。

## 已存在（源码核对；限定运行证据见TASKS）

| 路径 | 当前语义 / 源码 |
| --- | --- |
| POST /v1/proposals/:id/decision | 既有非项目提案继续使用版本/幂等与确认边界；历史 PROJECT 提案不允许继续确认生成 Action/TimeRequest，允许安全拒绝，具体退役响应见下方 |
| GET /v1/memory | 四域记忆列表；[memory/routes.ts](../apps/core/src/modules/memory/routes.ts) |
| PUT /v1/memory/:scope | 写入版本，接受 expectedVersion |
| GET /v1/memory/:scope/revisions | 历史版本 |
| POST /v1/memory/:scope/restore | 恢复存在的 revision，追加新版本 |
| DELETE /v1/memory/:scope | 按版本永久删除，不可恢复已删除内容 |
| GET /v1/memory/entities/:scopeType/:scopeId | V8-03新增：读取当前Owner的实体记忆；DOMAIN适配旧四域，其余类型校验实体归属 |
| PUT /v1/memory/entities/:scopeType/:scopeId | content + expectedVersion（新建null）；201新建、200更新，冲突409 |
| GET /v1/memory/entities/:scopeType/:scopeId/revisions | 返回实体历史与parent/source关系 |
| POST /v1/memory/entities/:scopeType/:scopeId/restore | expectedVersion + revisionVersion，追加恢复版本 |
| DELETE /v1/memory/entities/:scopeType/:scopeId | expectedVersion，204永久删除；缺失/无权404，不恢复已删除历史 |
| POST /v1/memory/compactions | scopeType、scopeId、mode、expectedVersion；201新草案、200复用相同待审草案；EXTERNAL未配置503 MEMORY_COMPACTION_PROVIDER_UNAVAILABLE |
| GET /v1/memory/compactions/:scopeType/:scopeId | 当前Owner/范围的草案列表，data.items |
| GET /v1/memory/compactions/drafts/:draftId | 当前Owner草案详情，data.draft，缺失404 |
| POST /v1/memory/compactions/drafts/:draftId/reject | expectedDraftVersion；只更新草案决策，不改有效正文 |
| POST /v1/memory/compactions/drafts/:draftId/confirm | expectedDraftVersion + expectedVersion；返回草案与追加后的document；失效草案409 |
| POST /v1/memory/compactions/drafts/:draftId/restore | expectedVersion + revisionVersion；仅从草案引用的仍存在来源恢复，追加版本；已失效草案409 |
| POST /v1/daily-plans/coordinate | Owner会话、localDate、显式mode及本地模式Idempotency-Key；LOCAL_RULES返回201，data直接包含Proposal，重复键重放；EXTERNAL未接此入口返回503 DAILY_PLAN_PROVIDER_NOT_CONFIGURED，不调用模型；限定验证见TASKS |

日计划实际路由在 [routes/daily-planning.ts](../apps/core/src/routes/daily-planning.ts)，不是旧计划猜测的 modules/daily-planning/routes.ts。事务和版本语义见 [repository.ts](../apps/core/src/modules/daily-planning/repository.ts) 与 [review-service.ts](../apps/core/src/modules/daily-planning/review-service.ts)。

## 已取消的项目接口与 CLI

`/v1/projects` 及其 snapshot、briefs、external-analysis/status、external-preflights/authorize 子路径不再提供项目功能；本机 `projects:authorize` 脚本移除。没有替代的路径授权接口，也没有新增项目会话 API。不能将旧文档中的命令当作当前运行步骤。历史数据保留规则见 [DATABASE](DATABASE.md)。

退役代码的响应边界：Core 不再注册项目路由，返回 404；BFF 对整个 `/api/core/projects/**` 分支返回 `405 PROJECT_MODULE_RETIRED`，不转发到 Core，也不提示改走 CLI。通用提案对仍待处理的 `PROJECT` 确认返回 `409 PROJECT_PROPOSAL_RETIRED`，不写 Action/TimeRequest 或确认状态；历史拒绝继续沿用版本/幂等路径。新的通用 Agent run 请求不接受 `CODEX_LOCAL` / `PROJECT_ANALYSIS` / `PROJECT` 上下文，按统一输入校验返回 `422 VALIDATION_ERROR`；历史运行读取枚举仍兼容。实际定点检查结果见 TASKS。

## V9 核对起点与目标接口（尚非运行证据）

源码已有匿名`GET /v1/health/live`（status/service/version）与`GET /v1/health/ready`（只读select 1，失败503）。没有旧计划的`/health`；V9-01已接入BFF Origin/CSRF，限定验证和修复状态见TASKS，不能据此宣称生产验收通过。

Web `GET /api/csrf`已落盘：无Owner初始化、返回`{token}`并绑定host-only `ev_csrf` Cookie，no-store；歧义Cookie为400 CSRF_COOKIE_INVALID，非法初始化来源为403 CSRF_ORIGIN_REJECTED。BFF缺失/无效EV_WEB_ORIGIN为500 WEB_ORIGIN_CONFIGURATION_ERROR；mutation非法Origin为403 BFF_ORIGIN_REJECTED，CSRF不匹配为403 BFF_CSRF_REJECTED。setup/login免Owner但不免这两项校验，其余写入由Core验证Owner（含logout），不把cookie存在当认证。CSRF值不转发Core；全部local-admin代理404；项目路由按退役边界禁用，不再提示通过 CLI 授权。详见[TECH_SPEC §13](TECH_SPEC.md#13-v9-私有运维增量设计冻结)。原live/ready保持最小匿名兼容，不输出路径/secret。

Owner `GET /v1/health`已接线，直接返回`{appVersion, schemaVersion, checks}`；checks包含database/migration/backup/provider/scheduler/log，各自使用up/down/degraded/unknown/not_run/unconfigured枚举。无有效Owner为401，health只读会话查询不会清理过期session。未设置日志返回unconfigured；backup仅有已验证快照的注入观察点、当前默认not_run；scheduler未启用not_run、已启用但无独立状态读接口时unknown。Provider仅查询配置和历史连接结果，不代表即时可达，不解密/外探。该接口不触发备份、迁移、修复或调度，真实运行/限定复核结果见TASKS。

备份服务与本机CLI已落盘（非HTTP），运行及限定复核状态见[TASKS](../plans/TASKS.md)：

```powershell
node --import tsx apps/core/src/cli/backup.ts create --data-dir <已有绝对数据目录> --backup-dir <全新绝对备份目录>
node --import tsx apps/core/src/cli/backup.ts verify --backup-dir <已有绝对备份目录>
node --import tsx apps/core/src/cli/backup.ts restore --data-dir <已有绝对活动数据目录> --backup-dir <已有绝对备份目录> --restore-dir <全新绝对隔离目录>
```

create/restore需已有app.sqlite；新目录不能与活动数据目录、源备份重叠，拒绝已存在目标及链接路径。成功输出单一code：SQLITE_ONLY_BACKUP_CREATED / VERIFIED / RESTORED；失败输出受控code并非零退出，不打印路径、密钥或正文。没有force/replace-active开关；只有SQLite快照与manifest，不是全备。命令说明不是对真实日常库的操作授权。
## 兼容性、模式与验证边界

- legacy/entity普通restore在事务内先检查恢复源：缺失返回404 MEMORY_REVISION_NOT_FOUND；恢复源存在但基版本不匹配返回409 MEMORY_VERSION_CONFLICT。删除后不能恢复原内容；本次校验顺序回归的修复与限定验证证据见 [TASKS](../plans/TASKS.md)，不代表整版验收通过。
- 协调Proposal新增可选mode，LOCAL_RULES显式返回；旧外部输出形状保持兼容。实体/压缩页面接线及协调运行结果仍以TASKS为准，不将接口已落盘当作页面交付。
- Today的待审/终态计划摘要可选返回实际Proposal的mode；LOCAL_RULES在今日卡片明示“静态协调（无模型）”。没有为缺失的真实Provider补假结果。
- 显式 LOCAL_RULES 是静态规则建议；外部 Provider 模式未配置必须 503，不能悄悄退为规则成功。行为定义见 [TECH_SPEC](TECH_SPEC.md#12-v8-增量设计冻结)。
- 原 TECH_SPEC 的 API 表为批准目标蓝图，不保证端点存在；只有经源码与实施证据核验后才能收入本节“已存在”。

## 详细健身计划接口（2026-09-19源码核验）

`WORKOUT_PLANNING_V2` / `WORKOUT_PLAN_V2` 的App装配与下方HTTP路由已经实现，并完成一个隔离inject用例及限定复核。网页到Core的完整闭环与真实Provider证据仍以[TASKS](../plans/TASKS.md)为准；接口可调用不等于真实DeepSeek已验证。

外部动作目录目前具备程序内导入、参数化分页检索与限定候选查询。未审核记录保持只读查阅用途；没有浏览器任意本机路径导入或让模型自行批准动作安全性的接口。真实 DeepSeek 适配器实施状态只见 [TASKS](../plans/TASKS.md)，未运行真实外部数据或付费调用。

本机离线 CLI 已实现并用合成文件验证（这不是对日常数据库的操作授权）：

```powershell
node --import tsx apps/core/src/cli/fitness-catalog.ts import --data-dir "<已有绝对数据目录>" --json-file "<已有绝对JSON文件>" --revision "<40位小写commit SHA>"
```

要求已有 `app.sqlite`、迁移28及目录表，不自动创建数据库/Owner或运行迁移；JSON为上游动作数组，最大32MiB，无网络下载/媒体读取。成功输出受控code、版本、数量、hash；同版同内容重放不重复导入，同版不同内容为冲突并非零退出。不会新增动作审核资格。

V2预览使用 `previewReceipt.previewedAt`，没有同意外发语义；用户明确创建后才形成 `consentedAt` 确认记录。预览与发送应绑定实际字段、候选、版本及内容hash，变化要求重新审阅。它与旧 `HEALTH_DISCLOSURE_V1` 动作选择声明分离；旧三能力查询不因新契约存在而自动声明详细训练或饮食可用。

### 已接线的详细计划接口

下表已对照`apps/core/src/modules/fitness/planning-routes.ts`核验。统一前缀 `/v1/fitness/planning`，全部需要Owner会话；命令沿用Idempotency-Key（画像使用expectedVersion CAS、预览仅生成短期引用记录）。单routes用例覆盖鉴权、配置、Fake生成/读取与重放，不声称逐路由完整矩阵。

| 方法与后缀 | 输入/响应约定 |
| --- | --- |
| GET /profile；PUT /profile | GET data.profile可为null；PUT为expectedVersion（首次null）和不含version的profile，服务端递增版本 |
| GET /capability | data为独立WORKOUT_DETAILED_PLANNING descriptor；配置状态不等于真实效果验证 |
| GET /candidates | checkInId、goal；data.items为最多5个有限候选，未审核外部动作不在此自动放行 |
| GET /memory | data.items只含当前有效revision的id/version/scopeType/scopeId/characters，不先读取全部正文 |
| POST /context/preview | PreviewWorkoutContextV2；data为payload/hash/previewReceipt/fieldCounts；不调用模型 |
| POST /workouts | CreateDetailedWorkoutV2；data包含workout/revision/totalDurationSeconds/capabilityRunId，确认后才允许调用 |
| GET /workouts | 有界page/pageSize及可选日期/状态；data.items中每项为workout与revisionSchema，另有pagination |
| GET /workouts/:id | data包含workout/revision/citations/proposal/action/timeRequest/feedback；候选快照提供名称和说明 |
| POST /workouts/:id/revisions | ReviseDetailedWorkoutV2；返回workout/revision，重新校验当前依据 |
| POST /workouts/:id/proposal | expectedVersion/revisionId；返回workout/proposal，不自动确认 |
| POST /workouts/:id/feedback | 沿用WorkoutFeedbackInput；返回事实结果，另有memoryStatus，区分摘要成功、跳过、重放和降级 |

训练Proposal决定仍使用全局 `/v1/proposals/:id/decision`；只创建Action和TimeRequest。Event由日程审核另行确认生成。旧V1接口不假装能解码V2，版本不适用需受控提示；旧手动训练与历史记录兼容。

接线状态码约定（2026-09-19）：GET、画像PUT、上下文预览和全局决定成功为200；训练创建、修订、提案及反馈创建为201，幂等重放保留同一成功状态并返回重放响应头。身体状态沿用已有201。反馈不是200：创建训练反馈记录与其派生事实，和旧训练接口保持一致。测试应使用此明确约定，不因先前草稿中的假设修改服务状态码。

默认App装配现有DeepSeek详细训练适配器，能力查询仅检查Owner凭据配置，不解密、不外探；未配置的创建为503 `HEALTH_TEXT_PROVIDER_NOT_CONFIGURED`。适配器直接调用层还保留其自身未配置错误；不要以设置页面连接测试成功推断每次生成必然成功。无有效会话401，格式/分页校验422，旧入口读取V2为409 `WORKOUT_SCHEMA_MISMATCH`，上下文版本变化409，最新风险状态422。TEST_FIXTURE仅在既有测试环境与隔离目录门禁下允许，不是生产降级分支。

## 历史项目外发设计

M1/PC/Codex 试验的原始设计和失败/成功证据保留在历史计划及 [TASKS](../plans/TASKS.md) 引用的 evidence 中。本页不再将这些端点列为可调用 API；未完成的真实 Codex 接线被取消，而不是验证通过。

## DeepSeek 默认营养查询（2026-09-20 修订）

仅配置DeepSeek即可使用现有营养匹配接口；USDA凭据接口保留为可选来源，已有USDA配置优先。未配置USDA时，Owner的DeepSeek配置装配联网工具与本地缓存；公开来源首版限中/英文Wikipedia，不能保证所有食物匹配。接口形状及选择/确认步骤不变。完整缓存命中的批次不占外部调用额度；未命中批次最多两次DeepSeek请求，来源/数值证据不完整返回未匹配，不编造营养数据。`actualCalls`记录逻辑外部批次，不作为供应商计费明细。
