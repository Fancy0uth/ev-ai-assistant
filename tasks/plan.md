# EV AI Dashboard：v0.4–v0.9 完整 MVP 实施总览

| 字段 | 内容 |
| --- | --- |
| 状态 | Active — v0.4、v0.5 已关闭；V6-01 已完成验证，等待 Git 原子提交后继续。 |
| 当前实现基线 | `155b172de91a62feb2762469536555f9a6b2b025`；v0.5 工程 PASS，真实 DeepSeek 仍为独立证据债。 |
| 权威设计 | [v0.4–v0.9 绑定设计](../docs/superpowers/specs/2026-08-23-v0.4-v0.9-mvp-design.md) |
| 执行路线 | [v0.4–v0.9 总路线](../docs/superpowers/plans/2026-08-23-v0.4-v0.9-mvp-roadmap.md) |
| 版本语义 | v0.9 是完整 MVP 的实现版本，不是对外稳定 1.0、公开发布或兼容性承诺。 |

## 严格实施顺序

| 顺序 | 版本 | 状态 | 退出结果 | 独立计划 | Sol review |
| --- | --- | --- | --- | --- | --- |
| 1 | v0.4 | 已关闭 | 兼容排程输入、ACTIVE/CLOSED TimeRequest、Task/Calendar Unit of Work、事务外 preflight Provider、手工 Event、详情路由与 UI-origin 闭环 | [计划](../docs/superpowers/plans/2026-08-23-v0.4-action-scheduling-foundation.md) | `docs/reviews/2026-08-23-v0.4-sol-smoke-review.md` |
| 2 | v0.5 | 已关闭于 `155b172` | DeepSeek/DPAPI 通路、幂等、Run 恢复、超时/配额、脱敏日志、版本一致；真实调用未运行证据债保留 | [计划](../docs/superpowers/plans/2026-08-23-v0.5-provider-reliability.md) | `docs/reviews/2026-08-24-v0.5-sol-final-review.md` |
| 3 | v0.6 | V6-01 已验证，等待 atomic commit | 私有 raw artifact、Provider 外发披露、可编辑 revision、Course/Rule/SCHEDULE Proposal、课程详情、安全公开 citation、Learning Action→TimeRequest、响应式闭环 | [计划](../docs/superpowers/plans/2026-08-23-v0.6-learning-schedule-loop.md) | `docs/reviews/2026-08-23-v0.6-sol-smoke-review.md` |
| 4 | v0.7 | 待开始 | 健身/恢复与权威营养数据闭环，无医疗诊断 | [计划](../docs/superpowers/plans/2026-08-23-v0.7-fitness-nutrition-loop.md) | `docs/reviews/2026-08-23-v0.7-sol-smoke-review.md` |
| 5 | v0.8 | 待开始 | 只读项目分析、本地长期记忆、跨模块唯一排程 Proposal | [计划](../docs/superpowers/plans/2026-08-23-v0.8-project-memory-coordination.md) | `docs/reviews/2026-08-23-v0.8-sol-smoke-review.md` |
| 6 | v0.9 | 待开始 | 私有 iPhone、Windows 运维、WAL 备份恢复与最终完整门禁 | [计划](../docs/superpowers/plans/2026-08-23-v0.9-private-iphone-operations.md) | `docs/reviews/2026-08-23-v0.9-sol-smoke-review.md` |

严格依赖为 `v0.4 → v0.5 → v0.6 → v0.7 → v0.8 → v0.9`。每版只有在对应 Sol review 为 PASS、P0/P1 为零且目标 commit 冻结后，才作为下版入口。

## Terra 执行协议

1. v0.6 由同一个 `gpt-5.6-terra`、`xhigh` reasoning/priority 连续执行四个垂直任务，不派生 Agent，不在任务间询问用户；后续版本继续按其冻结计划执行。
2. 每个 Vx-xx Task 只能写其 `文件` 范围；迁移/生成文件按任务单列。
3. 先提交可观察失败的 RED 测试，再写最小 GREEN；随后重构、运行聚焦验证并做原子提交。
4. 加法迁移必须从冻结旧库升级，核对 Owner/Task/Run ID 与计数；禁止破坏性迁移。
5. 每版只跑该版聚焦测试、必要 typecheck/build/startup 和一条关键浏览器路径；v0.9 再额外执行完整集成门禁。
6. 每版 review 记录基线/目标提交、命令与原始结果摘要、浏览器证据、P0/P1/P2/P3、结论和下版入口。
7. 同一根因最多两轮 Terra 修复；第三次复发、依赖/Provider 选择、外部调用、迁移重构或任务文件越界必须升级 Sol。

## 始终有效的边界

- 单 Owner 隔离；用户数据、记忆、日志和备份均在本地；API Key 不提交，使用 DPAPI/等价本机保护。
- Core 默认且最终仅 `127.0.0.1`；iPhone 只通过认证私有 HTTPS Web 网关/隧道，绝不裸露公网 Core。
- 外部写入和高影响动作必须 Proposal+Confirm；项目集成只读，绝不写代码/Git。
- 真实 Provider 未配置时 fail closed；Fake 只在测试环境且证据明确标注。
- Prompt、网页、OCR、项目仓库和 RAG 内容都是不可信数据，不是指令。
- 安装/配置 Tailscale、系统服务/Task Scheduler、端口/防火墙、真实恢复、物理设备、push/发布都需要执行时主 Agent 单独审批。

## 当前冻结里程碑：v0.6

- BASE：`155b172`。
- 垂直任务数：4；顺序为安全 artifact/披露 → Vision revision/课程日程 → 课程详情/安全 citation → 学习 Action/TimeRequest/响应式证据/0.6.0。
- Vision 与公开搜索没有获批供应商或真实 Key，生产必须 `BLOCKED_PROVIDER`；DeepSeek 仅承担已支持的文本分析，绝不推断其支持图片。
- 自动验收只使用三重门控的 Fake，真实 Vision/Search/DeepSeek 成功均保留为 `NOT RUN — APPROVAL REQUIRED`；这不阻止 P0/P1 为零时的工程 PASS。
- v19 只增不改；原始图片进入本地私有 artifact，citation 不保存整页正文，所有网络位于 SQLite 写事务之外。
- 最终只做一次 v0.6 Sol 里程碑审查；P0/P1 为零才可 PASS。

## 历史完成基线：v0.4–v0.5

v0.4 Action Scheduling Foundation 与 v0.5 Provider Reliability 的工程实现和审查历史继续有效。v0.5 关版 commit 为 `155b172`，P0/P1 为零；`P2-EVIDENCE-001` 与真实 DeepSeek 未运行证据保留，不扩大成 v0.6 Daily Plan 重构。

---

## 历史完成基线：v0.3 Daily AI Control Loop

v0.3 已完成的工程工作保留为后续实施底座：

1. **安全 Provider：** DPAPI SecretStore、DeepSeek adapter、连接测试与错误状态。
2. **可确认计划：** 最小 Context Manifest、Daily Plan Run、结构化 Proposal、确定性校验与部分确认。
3. **首页产品化：** 日程优先 Today、计划审阅、桌面/iPhone 响应式。
4. **调度与验收：** Shanghai 07:00 幂等触发、首访补偿、独立 E2E 与发布记录；旧通用调度保留兼容但不再由生产启动。

历史质量门仍有效：每个切片测试先行、目标测试和原子提交；E2E 使用独立端口与 `EV_DATA_DIR`；不以模拟 Provider 伪造真实连接。v0.3 不曾交付 OCR、公开检索、真实项目 Agent、完整健身/饮食链、远程私有 iPhone 或运维闭环，因此这些能力由 v0.4–v0.9 补齐，而不是从 MVP 删除。

历史来源：[v0.3 规格](../docs/superpowers/specs/2026-08-17-v0.3-daily-ai-control-loop.md)、[v0.3 计划](../docs/superpowers/plans/2026-08-17-v0.3-daily-ai-control-loop.md)、[ADR-012](../docs/decisions/ADR-012-dpapi-secrets-and-proposal-only-daily-ai.md)、[v0.3 Sol 审查](../docs/reviews/2026-08-23-v0.3-sol-minimum-viability-review.md)。
