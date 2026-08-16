# 2026-08-17 本地 MVP 缺陷与边界记录

本记录将真实测试发现和刻意延后的产品能力分开。P0/P1 已在本分支修复；P2/P3 不以伪造功能的方式关闭。

## 已修复

| ID | 级别 | 复现与实际结果 | 根因 | 处理与证据 |
| --- | --- | --- | --- | --- |
| BUG-001 | P1 | 完成健身恢复打卡后回到 `/today`，控制台没有显示恢复状态。预期当天排程能看到影响健康的 Signal。 | Today 聚合只读取任务和 Event，遗漏了日程仓库中的 Signal。 | 聚合真实 `RECOVERY` Signal，并在 Today 明示“来自本地打卡，不构成医疗判断”。Core 与 Web 回归测试覆盖。 |
| BUG-002 | P1 | 在 `/memory` 编辑 GENERAL 文本后点击保存，界面显示“请求未能完成”。预期保存后出现版本与 Markdown 投影。 | Next.js BFF 只导出了 GET/POST/PATCH/DELETE，未导出记忆写入使用的 PUT；Core 路由本身正常。 | 显式导出 `PUT` 代理；先新增 PUT 转发 RED 测试，再最小实现，21 个 BFF 测试通过。 |
| BUG-003 | P1（测试可靠性） | Windows 上 `npx playwright test` 显示通过后进程不退出，并遗留 Core/Web 子进程。 | Playwright `webServer` 通过嵌套 npm 启动的子进程树没有可靠回收。 | 增加受管 E2E runner 和 `finally` 清理；完整 E2E 4/4 通过且测试后无监听端口。见 ADR-011。 |
| BUG-004 | P1（测试可靠性） | 多尺寸路由 E2E 多次建立账号会触发真实 setup 限流，导致非产品失败。 | 每个独立浏览器上下文都重新 setup，而系统正确限制频繁创建 Owner。 | 首次认证后复用 storage state；仍为每个尺寸创建独立 context，不跳过登录授权边界。 |
| BUG-005 | P1 | 课程官网或资料链接可保存 `javascript:`、`data:`、`file:` 并被页面作为链接渲染。 | Zod 的通用 URL 校验不限制协议。 | Contracts 只接受 HTTP(S)；课程 API 和 Web 响应都经同一 schema，危险协议被拒绝。 |
| BUG-006 | P1 | 记忆 Markdown 投影写入失败时，SQLite revision 已提交，导致用户看到失败却无法用原版本重试。删除后保留不可恢复的孤立 revisions。 | 数据库事务和文件投影在不同步骤执行，删除语义没有明确。 | 将投影写入放入 SQLite transaction；投影失败回滚数据库，临时文件被清理。删除改为明确的永久删除，同时移除所有 revisions 和投影。 |
| BUG-007 | P1（测试隔离） | 若 4327/3217 已被用户服务占用，E2E runner 可能探测到别的健康服务并读写错误数据目录；与预览共用 `.next` 时还会因开发锁导致测试服务无法启动。 | 固定端口后只探测健康端点，且所有 Next dev 进程默认写同一构建目录。 | 启动前探测两个端口并在被占用时失败；ready 等待期间检测自己启动的子进程是否提前退出；每次 E2E 使用测试数据目录下独立的 `EV_NEXT_DIST_DIR`。 |
| BUG-008 | P1（架构契约） | Provider 配置页展示 DeepSeek 与本地 Codex，但服务只能持有一个 Provider。 | Provider service 用单个可选字段建模。 | 改为按 `ProviderKey` 的 registry 路由；两种 adapter 可以同时 READY，未配置 key 仍保持 503。 |
| BUG-009 | P1 | 记忆页初始异步读取未返回时可编辑；稍后返回的空数据会覆盖输入，令保存按钮重新禁用。 | 初始 load 和用户输入没有建立就绪边界。 | 初始读取完成前禁用 scope 切换、编辑、保存、历史和删除；组件测试和真实 E2E 覆盖。 |
| BUG-010 | P1（测试可靠性） | E2E 使用独立 Next 构建目录后，Next 会把受版本控制的 `next-env.d.ts` 改写为临时相对路径；测试目录也会持续累积。 | Next 在启动时生成类型引用，runner 未将该副作用视为需清理的测试资源。 | runner 记录并在 `finally` 复原原文件；成功时删除唯一的 `managed-run-*` 目录，失败才保留现场。 |

## 已知限制

| ID | 级别 | 现象/风险 | 处理决定 |
| --- | --- | --- | --- |
| LIMIT-001 | P2 | 新工作区 CSS 当前集中在 `dashboard.css`，维护大型模块时可读性会下降。 | 在不改变行为的重构切片中按 workspace 拆分样式；本轮不为样式目录结构冒险改动交互。 |
| LIMIT-002 | P2 | 单 Owner 可以登记自己有读取权限的任意本机目录。快照已有白名单和敏感文件排除，但远程暴露前该入口不应保留。 | 远程部署前改成本机 CLI/受控文件选择授权，并记录授权审计。 |
| LIMIT-003 | P2 | Sentrux 从基线的质量信号 9671 降至 9608，耦合 36.09 升至 40.31；无循环、无 God file。 | 不更新 baseline 掩盖变化。下个结构切片拆分 Core 组合根和 Dashboard 样式边界，并在新模块加入前评估依赖边。 |
| LIMIT-004 | P2 | 长期自动记忆尚未启用 revision 分页、压缩/保留策略；当前只有人工规模的本地文本。 | 在允许后台长期写入前，增加分页、摘要压缩、空间上限和可见保留策略。 |
| LIMIT-005 | P2 | 低置信度课表识别会显示 `REVIEW_REQUIRED` 候选，但页面尚不能逐项修订候选并转成 Proposal。 | 在视觉 Provider 接入切片中补齐“候选编辑 → 重新校验 → 待确认 Proposal”；高置信度 Proposal 的确认边界不受影响。 |
| LIMIT-006 | P3 | 设置页面尚不能安全录入/持久化 API Key，因此真实 DeepSeek/Codex 调用均不可用。 | 先实现 Windows Credential Store adapter、最小连接测试和 context manifest；禁止 `.env`、LocalStorage 或日志保存密钥。 |
| LIMIT-007 | P3 | 课程截图、公开检索、动作 RAG、自然语言食物解析、穿戴设备和外部日历均未实现。 | 依照 PRD 的模块路线逐项独立设计和测试；未配置 Provider 时保持阻断状态。 |

## 验收判定

截至本记录，已发现的有效 P0/P1 均有回归测试，未通过降低断言、更新 baseline 或伪造 UI 文案来掩盖。P2/P3 仍应在后续发布前依据其影响重新分级。
