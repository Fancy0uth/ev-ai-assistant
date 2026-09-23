# 数据库：实际底座与 V8 增量边界

## 营养数据凭据：migration 31

`add_nutrition_provider_credentials` 在既有最大版本30之后追加，原迁移不改写。`nutrition_provider_credentials` 按Owner主键保存固定来源`USDA_FDC`、`protected_value`和更新时间；明文key不入库。沿用Windows当前运行用户的DPAPI保护，读取配置状态不解密，只有明确匹配请求才解密调用。Owner删除时级联删除，主动移除仅清除该营养来源凭据，不删除已确认食物快照/餐食。

首次启动会依既有迁移机制追加该表；真实用户库的升级/备份权限不由合成测试替代。实际进度见[TASKS](../plans/TASKS.md)。

## 2026-09-16 项目功能退役的数据保留边界

项目分析运行代码退出后，`project_scopes`、`project_briefs`、`project_conversations`、`project_conversation_messages` 等历史表及原迁移保持不变，不删表、不重编号、不清空 Owner 数据。下面对项目仓储/CLI 的说明仅解释历史设计，不代表仍有这些运行入口。PROJECT 类型与已有实体记忆、Action/TimeRequest/Event 引用保留兼容；数据库中存在这些表不代表项目分析可用。

本次退役不运行用户库升级或回滚；既有 openDatabase 的常规追加迁移行为不变。若未来需要清理历史数据，必须另立有备份与明确授权的任务，不能靠删除 migration 让现有数据库失配。

## 项目会话增量：migration 27（2026-09-16）

`add_project_conversation_storage` 追加两张表，不改通用 agent_sessions/agent_messages 或已有任务。

- `project_conversations`：id、owner_id、project_scope_id、created_at；Owner/project唯一，复合外键关联已授权项目，触发器禁止把会话改绑其他Owner或项目。
- `project_conversation_messages`：自增sequence、唯一id、session_id、client_message_id、USER角色、content、created_at；会话内client_message_id唯一。文本保存与未来模型调用分离；同编号同内容重放，不同内容报冲突。
- 当前仓储只有用户消息；模型回复/运行记录和07:00任务尚不能由此表的存在推定已完成。只读消息列表不隐式创建会话。

只追加第27版，实际实施/测试和修复证据统一见 [TASKS](../plans/TASKS.md) 与其链接；合成内存库验证不代表已迁移用户日常数据库。未来首次启动会依现有 openDatabase 机制应用待执行迁移，真实数据启用前仍需按部署流程确认备份/权限。

## 实际底座（只读代码核对）

[database.ts](../apps/core/src/storage/database.ts) 的 `openDatabase` 开启 WAL、foreign_keys、5000ms busy_timeout、synchronous NORMAL，并调用迁移。数据目录与启动见 [DEPLOYMENT](DEPLOYMENT.md)。

[migrations.ts](../apps/core/src/storage/migrations.ts) 初始实际最大版本为 **22**（不是旧 V8 计划的 21）。后续每次实施先重读实际 max，仅在其后追加；未有并发新增时首个候选为 23，本文不预占编号、不改旧 migration、不运行迁移。

| 已存在数据/服务 | 复用边界 |
| --- | --- |
| owners / sessions | CLI 读取唯一 Owner；零个或多个时拒绝，不创建账号或凭据 |
| project_scopes / scope-service | 保存授权根；CLI 写 EV 数据库，不写被分析项目 |
| memory_documents / memory_revisions | 现有 GENERAL、FITNESS、LEARNING、PROJECT 四域，版本与 Markdown 投影 |
| daily_plan_runs / daily_plan_proposals / proposal_decisions | 复用 daily-planning repository 的生成、审核事务和版本检查 |
| time_requests / events / actions | 复用活跃请求生命周期与确认后排程，不建立另一套排程数据库 |

现有记忆删除会删除当前文本、全部 revisions 和投影；恢复只读取仍存在的 revision。V8 不得使永久删除的内容从旧 draft、投影或恢复入口复活。

## V8 数据设计（设计待核验）

### 已落盘增量：migration 23

`add_bounded_project_briefs` 新增 project_briefs；保存Owner、授权project_scope、规则/外部模式、不可变快照依据与hash、分析、Proposal关联、状态与版本，以及确认后的Action/TimeRequest引用。Owner归属与对应项目来源通过触发器约束，原1～22号迁移不改写。只在EV数据库持久化，不写被分析目录。新库合成场景已覆盖，v22旧库升级样本在V8-03验收；真实用户库未迁移。具体命令、结果和状态只见 TASKS。

### 已落盘增量：migration 24

`add_entity_memory_documents` 增加 entity_memory_documents（唯一Owner/scopeType/scopeId）与 entity_memory_revisions（唯一document/version）；document具有独立ID，删除后重建不沿用历史代际。revision记录parentRevisionId、sourceRevisionId、WRITE/RESTORE、expectedVersion与contentBytes，归属/不可变身份及同文档来源由触发器校验。DOMAIN通过服务适配旧表，不把旧PROJECT迁入某个实体。

实体投影为 `memory/entities/sha256(ownerId)/<scopeType>/sha256(scopeId)/MEMORY.md`；hash路径防止客户端scopeId成为任意文件路径。当前已有v22合成库升级样本通过，完整命令和限制只见TASKS。旧1～23迁移未重编号。

### 已落盘增量：migration 25

`add_memory_compaction_drafts` 新增 memory_compaction_baselines、memory_compaction_drafts、memory_compaction_revision_links。仅同Owner/scope/baseVersion的PENDING草案唯一；草案记录实际当前输入revision、预算/字节数、规则diff与决策，确认/恢复关系追加记录。计数和累计bytes在数据库聚合，不加载全部历史正文生成草案。

legacy与entity文档删除触发器会使相关草案INVALIDATED，清除content/diff/来源载荷并重置baseline；保留无正文的审计标识，不让旧草案恢复已删内容。记忆与压缩的限定验证及历史回归记录见TASKS，不据此宣称全迁移矩阵或真实用户数据库已验证。

### 已落盘增量：migration 26（限定验证完成）

`add_daily_plan_coordination_uniqueness` 为 daily_plan_proposals 追加mode（LOCAL_RULES / EXTERNAL），已有记录默认EXTERNAL。升级如遇同Owner/日期多个活跃候选，仅保留按updated_at与id确定的一份，其余追加版本并标STALE，保留条目、审核记录和已确认Event，不删除历史。

部分唯一索引 `daily_plan_proposals_owner_date_active_coordination_uidx` 仅约束专用daily_plan_proposals表的Owner/localDate及PENDING_REVIEW、PARTIALLY_APPLIED状态，不约束通用proposals。生成事务使旧候选STALE后插入新候选；拒绝或确认复用原审核事务。该迁移已落盘不代表验证完成，实际最小检查与限制只见TASKS；未运行真实用户库升级。

所有新持久化复用当前 SQLite 与服务，不建第二库、不迁业务目录。增量升级仅做任务内一个成功升级样本及必要一个阻断样本，不跑全历史迁移矩阵。真实数据迁移/备份恢复不由本文授权。

## 外部健身动作目录（2026-09-18 增量）

追加迁移28提供 `fitness_catalog_snapshots`、`fitness_catalog_items` 和 `fitness_catalog_reviews`。固定来源版本与内容hash绑定，同版本同内容可重放，不同内容返回冲突且整次导入不落库；动作事实和后续资格记录分别不可变、追加保存，不把上游未审核数据改写成已审核事实。查询按文本、器械、肌群参数化分页，计划候选在完整资格与范围过滤后最多读取5项。审核记录包含依据、适用范围和参数限制，撤销通过后续记录生效；资格不是医学认证。

内部starter、旧训练及其引用保持原格式。目录导入/资格测试使用合成数据，不代表真实第三方目录已经下载、全库已获得资格，或用户日常数据库已升级。实际限定结果见 [TASKS](../plans/TASKS.md)；后续详细计划迁移以最后落盘版本为准，不在此预占编号。

追加迁移29在事务内重建 `v07_capability_runs`，保留旧30列数据、索引及Owner关联触发器，扩展 `WORKOUT_DETAILED_PLANNING` 和 `HEALTH_DISCLOSURE_V2`。旧三能力接口及V1记录兼容；运行仓储按Owner/日期合并新旧训练调用额度。此迁移不包含详细训练revision或健康画像存储，不能据此宣称整条新训练链路完成。

追加迁移30为既有 `workout_revisions_v2` 增加 `revision_schema`，旧行默认 `WORKOUT_PLAN_V1`，新详细修订为 `WORKOUT_PLAN_V2`。增加 `fitness_planning_profiles`（Owner唯一、CAS版本、有界JSON）、`fitness_planning_previews`（Owner/hash、有界选择与引用记录，服务层十分钟有效、每Owner最多二十份）及 `workout_planning_citations`（不可变技术候选快照、Owner/revision关联）。预览不复制完整健康、反馈或记忆正文；候选历史快照包含技术值、名称、说明和来源，不因当前资格变化抹去历史。

记忆预览绑定当前revision UUID、版本与scope，删除后同版本重建也不沿用旧授权。新外发需要重新预览；既有草稿的本地接受校验独立于预览TTL，仍复核当前画像、风险与候选。旧V1引用表及既有revision/Owner/父版本约束保留。迁移30只在隔离29→30样本中验证，运行与限定复核结论见TASKS；日常库尚未执行升级。

## V9 备份与恢复增量边界

V9起点实际max为26；上文22是V8初始历史值。V9无schema需求不加migration，必要追加前重新核对实际max，不改1～26，不制造升级矩阵。

备份使用SQLite backup API生成一致独立快照，manifest计数/schema/hash/quick_check从该快照取得。范围固定SQLite-only：库内业务事实和DPAPI密文包含，artifacts本体、memory侧车投影、日志、外部项目和DPAPI用户环境不包含，不能称完整应用备份或跨机可解密。manifest具体字段与失败语义仅见[TECH_SPEC §13.3](TECH_SPEC.md#133-v9-03sqlite-only-一致备份与隔离恢复)。hash不提供来源真实性签名。

现有V9实现先用readonly/fileMustExist连接验证独立DELETE-journal快照，不调用会mkdir/migrate的openDatabase或buildApp。只复制到新隔离目标再验证，不自动升级恢复副本；拒绝活动目录、已有目标与链接逃逸。未进行真实日常库备份/恢复，真实替换与侧车/DPAPI完整恢复保留另授权门禁。新增private-directory工具只在新目标设置当前Windows用户受限DACL，已存在目录只核验；mode0600不是ACL证据，不修改真实Owner目录权限。V9没有新增迁移SQL，latestSchemaVersion只读取现有迁移列表。

## DeepSeek 营养来源本地缓存（迁移32）

`nutrition_web_cache_v32`保存按Owner、规范化食物查询、单位及适配器版本区分的营养记录，以及公开来源URL、抓取时间、原文hash和逐项引用。只缓存有完整来源依据且recordHash一致的正向结果；有效期30天，每Owner最多100条、总记录与引用不超过800000字节。命中不联网、不解密密钥、不占外部调用额度；过期或未命中才请求来源。历史确认餐食保留自己的不可变快照，不随缓存更新。迁移只新增缓存表、索引与约束，保留原有凭据、Owner和餐食。
