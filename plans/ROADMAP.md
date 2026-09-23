# 实施路线（顺序权威，进度不在此维护）

项目定义见 [PRD](../docs/PRD.md)，规格见 [TECH_SPEC](../docs/TECH_SPEC.md)。唯一状态、证据和小契约在 [TASKS](TASKS.md)。

## 当前范围调整（2026-09-16）

本轮最新调整：手机端退出MVP，只保留服务器与电脑浏览器Web交付，依据[PRD](../docs/PRD.md)最新修订。下方V9私有iPhone相关步骤保留历史，不再驱动本轮手机适配、实机或专用远程访问部署；其他服务器运行与业务闭环继续按TASKS推进。

用户取消项目分析与专属 Codex 集成。下方 V8-01/02、历史 PC-01～05 与 C1/C2 不是继续开发清单；不再开展项目对话、07:00 项目分析、Codex 登录/网络适配或 Brief 分页优化。V8-03～05 的共享记忆/协调能力及普通工作待办继续保留。下一步顺序以 TASKS 的当前小契约为准；退役完成后回到未完成的健身动作库与 DeepSeek 详细计划工作，不自动启动新范围。

真实反馈：用户认为独立 Codex 已能原生处理项目分析，希望 EV 聚焦个人生活学习控制台；不据此声称其他模块效果已验证。

顺序固定：v0.4 Action Scheduling → v0.5 Provider Reliability → v0.6 Learning → v0.7 Fitness/Nutrition → v0.8 Project/Memory/Coordination → v0.9 Private Operations。不得越过前版独立复核门禁。

## V8：保留 01～05 映射

1. V8-01：CLI 直连 EV 数据库授权唯一 Owner 的项目，关闭 Web 路径登记。
2. V8-02：有界 snapshot → 显式 LOCAL_RULES 静态 Brief / 可选受限 Provider → 确认 Action → TimeRequest。
3. V8-03：实体 memory owner/scopeType/scopeId 与旧四域兼容。
4. V8-04：规则去重压缩 draft、手动/阈值触发、确认拒绝与追加恢复，永久删除不得复活。
5. V8-05：复用 daily-plan 事务版本，仅一个 owner/date 活跃协调 proposal；不限制其他类型。

## V9：沿用批准设计的小契约顺序

保留旧 V9-01～06：私有 HTTPS Web-only → Windows 受管启动 → WAL 一致备份恢复 → 本地脱敏日志 → iPhone 证据 → 版本与集成收口。[旧 V9 设计计划](../docs/superpowers/plans/2026-08-23-v0.9-private-iphone-operations.md) 仅为历史设计来源，其全量矩阵/安装/网络命令不是当前执行授权；届时先按用户约束缩小契约，不能直接执行旧全量门禁。

V9 最新授权与 01～06 小契约只见 [TASKS](TASKS.md#v9-当前执行契约2026-09-08)，技术正文为 [TECH_SPEC §13](../docs/TECH_SPEC.md#13-v9-私有运维增量设计冻结)。01 后接 02、03，04 消费 01/03 的安全与状态边界，05 记录唯一本地主路径及待执行实机步骤，06 同步实际版本元数据并分别裁定本地实现/物理部署。沿用 Terra Max 实现与 Astra medium 少量聚焦审查，不重开旧全矩阵或自动提交。远程、生产和发布单独授权；本地成功不替代物理 Safari、真实 Provider 和生产证据。

## 后续事项与反馈

- 健身外部动作库的检索与自动计划候选是不同能力：当前审核范围中的适用人群为自由文本，不能据此自动认定适合某个Owner。未来若要启用真实外部动作计划，须明确可验证的适用性规则/依据与来源资格；不让通用模型自行批准，不将本轮内置starter闭环外推为整库已可训练。
- 本轮健身真实数据下载、真实目录导入与付费DeepSeek效果验证仍需单独授权；Fake只验证程序链路。初版反馈记忆采用新来源的一次性写入与显式降级，不自动补偿旧来源；若将来增加重试，必须先定义删除代际与防复活边界。

- V9 P2-E2E-LOG-ENV：历史selector的E2E runner未覆盖父环境EV_LOG_DIR，可能把合成日志写入继承目录。2026-09-19新增精确fitness分支显式使用本次managed-run/logs，其他selector未顺带改动，仍需确认环境。没有实际污染证据，也不以fitness分支声明全环境已修复。

- V9 P2-LOCK-REPORT：启动器清理失败时，锁记录持久化/验证失败仍可能报告“lock retained”（私有launcher helper的失败保留分支）。应区分句柄关闭和锁真实存在；当前清理仍返回失败，用户不得凭此提示手动删除锁或认定Core已停止。本轮保留，不扩修复；未验证真实进程/系统任务故障。

- 保留 v0.7 的 V07-CONTRACT-010、V07-BROWSER-011、V07-EVIDENCE-014 及继承的 v0.6 P2；具体原始证据见历史审查，本轮不顺手扩大修复。
- 真实 Compaction/健身 Provider 与个人数据调用仍需明确授权；本地规则闭环不能代替真实依赖验证。Project Provider 已退出范围。
- `frontend/`、`backend/` 的物理目录重排单独立项，先评估 workspace、锁文件、构建、脚本和部署引用；当前保持 apps/web、apps/core。
- 持久化一致备份、远程边界与 Windows 常驻脚本按 V9 小契约实现；真实部署仍须另授权。Linux 容器可移植性不纳入此次实现。
- 本轮没有新的真实用户体验反馈；待用户验收后收集，不编造效率或效果提升。
- 历史 V8 Brief 列表分页 P2 随模块退役取消后续实施，历史审查原结论保留。
- V8页面项目目标日期及DAILY记忆默认日期使用UTC日期截取；非UTC时区凌晨可能默认前一天。独立审查列P2，本轮不顺修，用户验收前需注意手动核对日期。
- V8单browser场景的预期空记忆404诊断按精确路径/文案与GET404总数上界核对，未做逐请求配对；P2后续完善，不影响当前限定验收且未豁免其他warning/error。

## 历史来源定位

旧总路线原文可从本地 Git 对象读取：`50b533804be24f8963492679127f72e39ff4f7dd:docs/superpowers/plans/2026-08-23-v0.4-v0.9-mvp-roadmap.md`；旧 V8 原文为同提交的 `docs/superpowers/plans/2026-08-23-v0.8-project-memory-coordination.md`。原迁移 v21/local-admin HTTP/全矩阵要求已由新小契约取代，不复制旧进度。
