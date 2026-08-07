# 本地优先个人 AI Dashboard v2 设计规格

## 1. 文档状态

- 状态：已批准，作为后续实施的权威产品规格。
- 日期：2026-08-07。
- 取代：`2026-08-04-developer-daily-cockpit-product-v1-design.md` 中的 Supabase、`.ics` 导入和可选 Bridge 方案。
- 实施原则：先完成 Windows 本机可长期运行的 Web 产品，再提供 Docker 自托管包；Apple 日历、小米手环和学校网站接入均延期，但保留适配器边界。

## 2. 产品定义

这是一个面向有代码工作需求、同时需要管理学习和生活状态的个人 AI 助手系统。它不是一个带聊天框的 Todo 应用，也不是一个可以任意执行命令的通用自治 Agent；它是一个由用户掌控的个人 Dashboard，统一展示“今天发生什么、当前状态如何、下一步该做什么”，并让多个受限 Agent 在同一套任务、日程、项目和长期记忆之上工作。

首要体验是：用户打开首页后，在 30 秒内看清今天的任务与时间安排、昨天的执行情况、工作/学习/生活负荷、系统给出的解释，以及下一件建议执行的事情。AI 只产生分析、草稿和需要确认的操作，不伪造已经完成的外部动作。

## 3. 目标用户与成功标准

### 目标用户

- 独立开发者、计算机行业从业者、计算机或 AI 方向研究生。
- 同时管理 Git 项目、课程学习、健身、饮食和日常事务。
- 愿意让一台通常不关机的个人电脑作为自己的本地服务器。
- 重视本地数据与记忆隐私，同时希望从手机远程访问。

### 成功标准

1. 用户可以在桌面和 iPhone 浏览器中查看同一套实时 Dashboard。
2. 没有任何模型 API 时，账号、任务、日程、项目和生活记录仍可完整使用。
3. 配置 DeepSeek 后，系统能整理生活任务、训练、饮食和每日简报。
4. 配置 Codex CLI 后，系统能基于明确授权的本地 Git 仓库生成项目简报、调查方案，并在审批后执行隔离的代码改动。
5. 所有持久数据、累积记忆、审计记录和模型密钥保留在当前电脑。
6. Agent 建议可以解释、预览、拒绝、撤销或追溯；失败不会显示为成功。
7. 数据可备份、恢复、导出，程序升级不会覆盖用户数据。

## 4. v1 范围

### v1 必做

- 单所有者真实本地账号，桌面和手机使用同一账号。
- Today Dashboard：今日状态、昨日完成度、时间轴、今日重点、风险和下一步建议。
- 独立的 Task、Event、TimeBlock、Routine 和 Reminder 模型。
- 项目模块：登记用户授权的本地 Git 仓库、维护 Future Work、生成每日项目 Brief。
- Codex 项目模式：Brief、Investigate、Implement、Verify；默认只读，写操作必须审批并进入独立分支或 worktree。
- 生活模块：身体指标、训练计划/记录、饮食目标/记录和轻量趋势。
- DeepSeek 生活 Agent 与 Codex 项目 Agent 的统一入口和路由。
- 本地分层累积记忆、来源追踪、容量管理、编辑、固定、删除和导出。
- 中央审批中心、通知分级、操作审计和 Agent 任务状态。
- Windows 本机启动、健康检查、日志轮转、自动备份和恢复。
- Tailscale Serve 私有 HTTPS 远程访问；不开放公网端口。

### v1 明确不做

- Supabase 或任何产品云端数据库。
- Apple 日历导入、同步或写回，包括 `.ics` 快照导入。
- 原生 iOS/Android 应用和手机离线写入。
- 小米手环、学校课表网站、课程平台和邮件的真实接入。
- 团队、多租户、社交、计费和公共 SaaS。
- 医疗诊断、治疗建议或高风险健康决策。
- 无审批的代码写入、自动 push、自动 merge、删除仓库或任意 Shell。

## 5. 信息架构与主要页面

### Today

Today 是默认首页和控制台，信息优先级从高到低为：

1. 当前日期、问候、系统连接和 Agent 状态。
2. 今日状态：分数、等级、相较昨日的变化，以及可解释原因。
3. 当前时间附近的任务、事件和时间块主时间轴。
4. 今日最多三项重点、冲突、逾期和未排程任务。
5. 昨日任务完成率、昨日学习完成率、训练与饮食摘要。
6. 项目进展和下一件建议执行的代码工作。
7. 持久化助手侧栏：当前页面上下文、对话、建议卡和审批入口。

桌面端采用左侧主导航、中间 Today 工作区、右侧助手面板；移动端采用单列内容、底部主导航和可拉起的助手面板。右侧助手不是独立聊天产品，它必须知道当前页面、用户选中的实体和可用工具。

### Tasks & Schedule

- Task 表示要完成的事情；Event 表示固定发生的事情；TimeBlock 表示为任务预留的时间；Routine 表示重复习惯；Reminder 只负责提醒。
- Agent 可以提出排程方案，但必须生成 Proposal，由用户确认后写入。
- 完成、推迟、取消、重新排程和冲突都必须保留历史，供日报与记忆循环使用。
- v1 仅支持应用内日历和提醒。

### Projects

- 用户明确添加一个本地 Git 仓库后，项目才进入系统。
- 每个项目保存目标、状态、Future Work、关联任务、最近活动和允许访问的仓库根目录。
- Codex Runner 必须将所有路径解析并约束在已授权仓库根目录内。
- Brief 和 Investigate 不改文件；Implement 需要审批并在隔离工作区执行；Verify 只运行批准范围内的检查。
- 任何 push、merge、发布和破坏性命令均不在 v1 自动权限内。

### Life

- 身体：体重、围度等用户主动记录的数据，以及增重/减重/维持目标。
- 训练：计划、动作、组次、重量、训练完成记录；动作库以后通过适配器接入开源数据。
- 饮食：每日能量和宏量营养目标、食物或餐次记录、当天差额。
- DeepSeek 可以把自然语言转为记录草稿、提出餐食和训练建议，但用户确认后才落库。
- 输出必须是一般生活管理建议，不冒充医学建议。

### Assistant & Approvals

- 用户从任意页面发起请求；Context Builder 只组装该请求必需的数据。
- Router 根据任务类型将简单生活与整理任务交给 DeepSeek，将代码项目任务交给 Codex Runner。
- 返回内容使用结构化 Result/Proposal Card，包含依据、建议动作、影响对象和风险等级。
- 中央审批中心统一处理 Agent 建议；审批令牌短时有效、单次使用，并绑定精确操作和实体版本。
- 通知分为信息、需要关注和需要批准三级；默认保持平衡主动性，禁止持续打扰。

## 6. 系统架构

```text
iPhone / Desktop Browser
          |
          v
Next.js Web + same-origin BFF (127.0.0.1:3000)
          |
          v
Local Agent Core / Fastify (127.0.0.1:4310)
  |       |          |             |
  |       |          |             +-- Scheduler / Notifications
  |       |          +-- Agent Orchestrator / Approvals / Audit
  |       +-- DeepSeek Provider
  +-- Host Codex Project Runner ---- authorized Git repositories
          |
          v
SQLite + local artifacts + local memory

Tailscale Serve exposes only the Web origin through private HTTPS.
```

### 模块边界

- `apps/web`：展示、交互、响应式布局和 same-origin BFF；不直接打开数据库或调用 Codex。
- `apps/core`：认证、业务 API、SQLite、Scheduler、Agent Loop、记忆、审批和审计。
- `packages/contracts`：版本化 Zod schema、请求/响应和错误契约；Web 与 Core 共同依赖。
- `packages/domain`：不依赖框架和 I/O 的状态计算、排程规则与记忆策略。
- Project Runner：Core 内的受限主机执行边界；以后 Docker 化时可单独部署为宿主机组件。

所有 HTTP 业务接口位于 `/v1`。列表接口分页，更新使用 `PATCH` 和实体 `version` 做乐观并发控制。错误统一返回：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "数据已变化，请确认最新内容后重试",
    "details": {}
  }
}
```

## 7. 本地数据与账号

- Core 是唯一数据库写入者，SQLite 使用 WAL、外键和忙等待配置。
- 数据库、记忆、产物、日志和备份位于源码目录之外的用户数据目录。
- 第一位完成初始化的用户成为唯一 Owner；之后关闭公开初始化入口。
- 密码使用成熟的内存/CPU 成本密码派生方式，永不明文保存。
- 会话令牌随机生成，数据库只保存令牌摘要；Cookie 为 HttpOnly、SameSite=Strict，生产 HTTPS 下启用 Secure。
- API Key 进入 Windows 凭据存储；不进入 SQLite、日志、备份或 Git。
- 手机只是远程 UI，不维护第二套数据库；v1 手机离线时只读失败状态，不排队写入。

## 8. Agent Loop 与长期记忆

每次 Agent 运行遵循固定状态机：

```text
Trigger -> Gather -> Plan -> AwaitApproval? -> Execute -> Verify -> Reflect -> Persist
```

- Trigger：用户请求、每日定时任务或受控系统事件。
- Gather：读取最小必要上下文，并记录数据版本。
- Plan：产生结构化计划，不直接执行副作用。
- AwaitApproval：中高风险操作进入审批队列。
- Execute：只调用允许的 Provider 或 Tool。
- Verify：校验返回 schema、命令退出状态、diff 和目标实体版本。
- Reflect：生成短摘要、失败原因和下一步。
- Persist：写入运行记录、审计事件和符合保留规则的记忆候选。

长期记忆沿用分层生命周期：近期事件缓冲、周期/项目摘要、长期 Memory Card、用户固定卡片。默认不保存完整对话。所有记忆保存来源、置信度、版本、标签和派生关系；20 MB 提醒整理，50 MB 拒绝继续增长的写入。初版使用结构化标签和 SQLite 全文检索，不以前置向量数据库增加复杂度。

模型输出始终是不可信输入，必须经过 schema 验证；模型文本不能绕过审批、路径限制和工具权限。

## 9. Provider 与工具权限

| 能力 | 默认执行者 | 默认权限 |
|---|---|---|
| 每日生活简报、饮食与训练建议、自然语言记录草稿 | DeepSeek | 读取选定本地数据；写入需确认 |
| 项目 Brief 和技术调查 | Codex | 只读已授权仓库 |
| 实现代码 | Codex | 每次批准；隔离分支/worktree；禁止 push/merge |
| 普通任务与日程调整 | Domain/Core | 低风险单项变更可即时确认；批量变更进入审批 |
| 外部集成 | Adapter Port | v1 无真实适配器，不产生外部写入 |

Agent Router 依据领域、所需工具和风险选择执行者，而不是让模型自己声明权限。Provider 可替换，业务层不依赖 DeepSeek 或 Codex 的专有响应格式。

## 10. 扩展边界

预留但不实现以下 Port：

- `CalendarProvider`：以后接 Apple/Google/Outlook 日历。
- `WearableProvider`：以后接小米手环或健康数据导出。
- `CourseProvider`：以后接课表和学校学习网站。
- `ExerciseCatalogProvider`：以后接开源健身动作数据库。
- `ModelProvider`：DeepSeek 之外的 OpenAI-compatible API。

核心领域只接收规范化对象，不识别第三方原始字段。未来新增集成通过 Adapter 实现，不修改 Task、Event、Workout 等核心语义。

## 11. 部署、备份与恢复

### Windows 个人版

- Web 与 Core 原生运行并只绑定 loopback。
- Windows 当前用户登录后自动启动，确保可使用该用户的 Git、Codex 和凭据。
- Tailscale Serve 提供私有 HTTPS；不使用 Funnel，不做路由器端口转发。
- 状态页显示数据库、Scheduler、DeepSeek、Codex、Tailscale、磁盘和最近备份状态。

### 备份

- 自动保留 7 个每日、4 个每周和 3 个每月备份。
- 数据迁移前额外备份；使用 SQLite 在线备份能力，不直接复制活跃数据库文件。
- 备份包含数据库、记忆、配置和产物，不包含密钥、日志和 Git 仓库。
- 恢复前校验版本与校验和，并先备份当前状态；失败自动回滚。
- 支持 JSON 完整导出、CSV 数据导出和 Markdown 摘要导出。

### Docker

个人稳定版之后再提供 Compose 包。Web/Core 进入容器，数据使用持久卷，Secret 使用文件挂载；Tailscale 和 Windows Codex Project Runner 仍可留在宿主机。Linux 自托管用户以后可以选择容器化 Runner。

## 12. 可靠性、安全与发布门槛

- 所有外部输入在边界校验，所有用户内容输出时安全渲染。
- 非 AI 功能不依赖模型可用性；长任务异步执行，支持进度、取消、超时和重试。
- 调度任务幂等，重启后不会重复提醒或重复执行建议。
- 日志结构化、轮转并默认本地保存，不记录密钥和完整敏感上下文。
- 发布前必须通过单元、集成、数据库迁移、浏览器主流程、安全路径和备份恢复测试。
- Dashboard 在 320、768、1024 和 1440 像素宽度下可用，并满足键盘操作和 WCAG 2.1 AA 基础要求。
- 个人稳定版前至少连续运行 7 天，无阻断级问题、数据丢失或重复任务执行。

## 13. 实施顺序

1. 工程底座：monorepo、共享契约、Core 健康链路、真实 Dashboard 外壳。
2. 本地账号、SQLite 迁移、任务/时间块和 Today 纵向闭环。
3. Scheduler、提醒、昨日统计和每日简报。
4. 项目登记、Future Work、Codex Brief/Investigate。
5. Codex 审批写入、隔离执行和 Verify。
6. 身体、训练、饮食与 DeepSeek 生活 Agent。
7. Agent Orchestrator、中央审批、审计和长期记忆循环。
8. 手机/Tailscale、备份恢复、长期运行和安全验收。
9. Docker Compose 与公共自托管文档。

Agent 内部实现细节不要求用户在编码前一次性学习完。每进入一个 Agent 模块，必须同步生成面向用户的实现说明，解释该步的状态机、上下文、Prompt、工具、权限、记忆写入和测试方法。

## 14. 技术基线与权威资料

- Node.js 24.x，当前开发机为 24.18.0。
- Next.js 16.3、React 19.2、Fastify 5.11、Zod 4.4、`better-sqlite3` 13.x。
- Next.js 官方安装与 Node 要求：https://nextjs.org/docs/app/getting-started/installation
- Next.js Node/Docker 部署：https://nextjs.org/docs/app/getting-started/deploying
- Fastify 验证和响应序列化：https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Zod schema 与类型推导：https://zod.dev/basics
- SQLite Node 驱动选择依据：https://github.com/WiseLibs/better-sqlite3
- Playwright 多服务测试：https://playwright.dev/docs/test-webserver
