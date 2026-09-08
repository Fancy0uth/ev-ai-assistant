# EV AI Dashboard 阶段开发交接报告

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-09-07（Asia/Shanghai） |
| GitHub 仓库 | `Fancy0uth/ev-ai-assistant`（私有） |
| 推送分支 | `codex/product-prd` |
| 远程基线 | `3dd3da36b70a4d35db65b3235affec93465cae0f` |
| 本阶段冻结提交 | `7789a8ff14c2a9c073d179a4368836e50e8826db` |
| 变更规模 | 160 个提交；258 个文件，54,293 行新增、2,814 行删除 |
| 发布状态 | 阶段性开发分支；未合并 `main`、未打标签、未创建 Release |

## 1. 本阶段目标与范围

本阶段将本地单 Owner Dashboard 从早期演示推进到按领域拆分的 MVP 实现路径：日程与任务、Provider 可靠性、课程学习、健身恢复和营养记录都获得了可验证的本地链路。数据仍以本地 SQLite/本机文件为边界；真实模型调用、真实营养数据源、个人健康数据和公网部署均未启用。

本报告是开发交接记录，不是 v0.7 的发布验收结论。

## 2. 已完成的阶段能力

| 阶段 | 状态 | 已交付能力 |
| --- | --- | --- |
| v0.4 Action Scheduling Foundation | 已关闭 | 兼容日程输入、TimeRequest 生命周期、Task/Calendar 事务协调、手工 Event、详情路由与 UI 来源闭环。 |
| v0.5 Provider Reliability | 已关闭 | Provider 配额、超时、恢复、幂等、DPAPI 本机密钥保护、版本一致性和脱敏运行记录。真实 Provider 仍保持未配置即失败。 |
| v0.6 Learning & Schedule Loop | 已关闭 | 私有课程原始材料、课表候选人工确认、课程资源与学习 Action、学习 Action 到 TimeRequest、响应式学习/日程页面。 |
| v0.7 Fitness & Nutrition Loop | 实现完成，发布门禁未通过 | 恢复打卡、可审阅 Workout、训练完成/反馈、自然语言餐食草稿、带来源的营养匹配、Owner 确认后入账、桌面与 iPhone 视口闭环。 |

v0.7 还额外补强了 Owner 隔离、测试 Fixture 闸门、外部能力幂等、Provider 边界、BigInt 十进制计算、迁移升级和脱敏 E2E 证据。

## 3. 最新验证证据

下表是 v0.7 产品代码冻结后、2026-08-31 记录的本地验证结果。此后到本报告提交之间没有新的产品代码提交，只有审查和交接文档提交。

| 检查 | 记录结果 |
| --- | --- |
| `npm test` | exit 0；Legacy 7/7、Core 448/448、Web 246/246、Contracts 85/85、Domain 11/11。 |
| `npm run typecheck` | exit 0；Core、Web、Contracts、Domain 均通过。 |
| `npm run lint` | exit 0；0 error，保留 4 条既有测试文件 warning。 |
| `npm run build` | exit 0；Next.js 16.3.0 生产构建成功，生成 6/6 静态页面。 |
| `npm run test:e2e -- e2e/v0.7-health-loops.spec.ts` | exit 0；1/1 通过，覆盖桌面与 iPhone 视口的健身/营养确认闭环。 |
| `git diff --check 37982d8..HEAD` | exit 0。 |
| `git diff --check 785b7b6..HEAD` | exit 0。 |

上述测试只使用隔离的本地测试数据、Fake Provider 和合成营养证据；不代表真实 DeepSeek、Codex、外部营养 API、个人健康数据或物理 iPhone 已完成验收。

## 4. 当前发布阻断项

v0.7 的第三次 Sol 整版反方审查结论为 **FAIL（P0=0、P1=1、P2=4）**，因此不得把本分支描述为 v0.7 发布候选，也不得进入 v0.8。

唯一 P1 为 `V07-LINEAGE-015`：当营养来源的 kind/id/version/dataset hash 相同、但许可或证据元数据不同，现有存储可能复用旧来源快照。随后新记录的 hash 与持久化的来源描述不再匹配，仍可能进入已确认 Meal。这会破坏来源与许可的不可变谱系。

完整复现、影响分析和最小修复边界见 [v0.7 第三次 Sol 审查](../reviews/2026-08-31-v0.7-sol-rereview-2.md)。建议只授权一次针对该 P1 的小范围修复：完整比较来源描述符；冲突时在写入 Meal 前原子失败；新增两份合法但元数据不同的来源冲突回归测试。该修复完成并通过新的审查前，v0.7 继续保持未关闭状态。

## 5. 已知非阻断债务与未交付范围

- v0.7 P2：嵌套响应 schema 尚有 `z.unknown()` 占位、浏览器未覆盖所有中间错误态、E2E 证据尚未绑定目标提交摘要。
- v0.6 的六项 P2 债务仍保留，未在 v0.7 越界处理。
- v0.8 尚未开始：只读项目分析、本地实体记忆压缩/恢复、跨模块唯一日程 Proposal。
- v0.9 尚未开始：私有 iPhone HTTPS、Windows 常驻运维、WAL 备份恢复和完整 MVP 门禁。
- 未进行真实 Provider、外网访问、凭据配置、外部数据源导入、个人数据处理、部署、发布标签或 GitHub Release。

## 6. 推送与回滚说明

本次仅推送 `codex/product-prd` 到已存在的 `origin`，不自动合并 `main`，不强制推送，不改写历史，不创建 tag 或 Release。

若需要回到 GitHub 上推送前的状态，可在远程分支页面比较/还原到基线 `3dd3da36b70a4d35db65b3235affec93465cae0f`；由于本次为新增提交，推荐通过明确的 revert 提交回滚，而不是重写共享分支历史。

## 7. 下一步

等待 Owner 决定是否批准 `V07-LINEAGE-015` 的一次受限修复。只有该修复通过独立审查且 v0.7 获得 P0=0/P1=0 的 PASS，才进入 v0.8。
