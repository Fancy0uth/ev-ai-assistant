# EV AI Dashboard 系统架构（ARCHITECTURE）

| 字段 | 内容 |
| --- | --- |
| 版本 | 0.1 |
| 状态 | 技术设计草案，待审核 |
| 日期 | 2026-08-17 |
| 上游依据 | [PRD](../product/PRD.md)、[MVP 范围](../product/MVP-SCOPE.md)、[技术规格](TECH_SPEC.md) |
| 架构风格 | 本地优先的模块化单体 Core + Web BFF；Provider 与数据源采用 Ports/Adapters |

## 1. 架构结论

系统不是“浏览器直接调用 AI 的待办站点”，而是一台用户电脑上的个人控制平面：Web 负责展示和交互，Core 掌握数据、权限、Agent、调度和审计。所有专业能力在 Core 内以模块化边界实现，外部模型/检索/营养数据只是可替换 Adapter。

这样可以满足三项看似冲突的要求：本地长期记忆不上传、iPhone 能远程控制同一 Dashboard、未来仍可替换模型或打包部署。MVP 不拆分微服务，不引入消息队列或云数据库；单进程 SQLite 与持久 Job 表已足以提供可靠的单 Owner 闭环。

## 2. 运行时上下文

```mermaid
flowchart LR
  Desktop["桌面浏览器"] --> Web
  Phone["iPhone 浏览器\n私有 HTTPS（部署阶段）"] --> Web
  Web["Next.js Web\nUI + 同源 BFF"] -->|"loopback /v1"| Core
  Core["Fastify Local Core\n身份·日程·Agent·调度·审计"] --> DB[("SQLite + WAL")]
  Core --> Files["本地 artifacts / memories"]
  Core --> Secret["Windows OS Credential Store"]
  Core --> Model["模型 Provider\nDeepSeek / Vision / Codex"]
  Core --> Search["公开搜索 Provider"]
  Core --> Data["动作/营养 Data Provider"]
  Project["已授权本地项目"] --> Snapshot["只读快照构建器"]
  Snapshot --> Core
```

- Core 始终只监听 `127.0.0.1`；Web 的 `/api/core/*` BFF 代理是浏览器与 Core 的唯一通道。
- iPhone 永远访问 Web，不访问 Core、SQLite、项目路径或本地文件。私有 HTTPS/反向代理是部署阶段工作，不在 MVP 直接配置。
- 外部 Provider 只收到由 Context Builder 生成的最小上下文包；它们没有数据库、文件系统或计划写入权限。

## 3. 仓库与模块边界

现有仓库保留 TypeScript workspace。新增能力应按下列位置扩展，而不是把领域逻辑堆进 `/today` 页面或一个全局 Agent Service。

```text
apps/
  web/                         # Next.js 页面、组件和同源 BFF
  core/
    src/modules/
      auth/                    # Owner、会话与登录限流
      calendar/                # Term、规则、Event、冲突和导入
      actions/                 # Action、ActivitySession、链接
      proposals/               # 变更草稿、确认、版本与审计
      day-planning/            # 07:00 计划、聚合 Today View
      agents/                  # Orchestrator、context、run/artifact、policy
      projects/                # 授权根、快照、Project Brief（只读）
      learning/                # Course profile、资源与学习建议
      fitness/                 # Check-in、Signal、动作与训练 Session
      nutrition/               # 食物候选、目标、已确认摄入
      memory/                  # revision、Markdown 投影与 scope policy
      providers/               # Model/Search/Nutrition/Project adapters
      jobs/                    # 持久 Job、租约、补偿运行
      observability/           # 结构化审计与 health 聚合
    src/storage/               # SQLite、迁移、备份接口
packages/
  contracts/                   # API schema、输入输出和错误 code
  domain/                      # 无 I/O 的时间、冲突、恢复、营养确定性规则
docs/
  product/                     # PRD、MVP
  technical/                   # TECH_SPEC、ARCHITECTURE
  decisions/                   # 长期有效 ADR
```

依赖方向固定为：`web → contracts ← core → domain`。`domain` 不导入 Fastify、SQLite、Provider 或文件系统；`contracts` 不导入业务实现；领域模块通过接口依赖 repository/port，不能直接跨模块查询他人表。跨领域写入一律经过 `proposals` 或显式的用户原始记录服务。

## 4. Core 的分层

```mermaid
flowchart TB
  Route["Fastify Route\n身份验证 + 输入验证"] --> Service["应用服务\n用例和事务边界"]
  Service --> Domain["领域规则\n纯函数"]
  Service --> Repo["Repository\nSQLite"]
  Service --> Ports["Ports\n模型·搜索·营养·项目快照·密钥"]
  Ports --> Adapters["Adapters\n本地/外部实现"]
  Service --> Audit["审计 + Job + Context Manifest"]
```

1. **Route** 只做 HTTP、会话、Zod 验证和统一错误翻译。
2. **Application Service** 拥有用例语义，例如“确认课表导入 Proposal”，并规定事务边界。
3. **Domain** 处理时间/周次展开、冲突、优先级、恢复评分和营养计算，不做 I/O。
4. **Repository** 只映射持久化数据，不含模型决策和 HTTP 语义。
5. **Port** 隔离外部能力；Adapter 的输入输出在到达 Service 前已做大小、类型和 schema 检查。

## 5. 关键数据流

### 5.1 课表导入

```mermaid
sequenceDiagram
  participant U as 用户
  participant W as Web
  participant C as Core
  participant P as Vision Provider
  participant D as SQLite

  U->>W: 上传课表截图
  W->>C: 上传受限图片
  C->>D: 保存 artifact 元数据
  C->>D: 创建 COURSE_IMPORT Run
  C->>P: 图像 + JSON schema + 最小学期上下文
  P-->>C: 非可信候选 JSON
  C->>C: Schema/周次/冲突验证
  C->>D: 创建 PENDING Proposal
  C-->>W: Run/Proposal 状态
  U->>W: 补全学期锚点并确认
  W->>C: proposalId + expectedVersion + idempotencyKey
  C->>D: 事务写 Course/Rule/Event/Audit
  C-->>W: 已确认日程
```

模型从未获得日程写权限。输出无效或 Provider 不可用时，流程终止在 Run 失败/阻塞状态；用户看见可重试或手动补全入口。

### 5.2 多 Agent 协调

```mermaid
flowchart LR
  L["学习 Agent"] --> R["TimeRequest"]
  F["健身 Agent"] --> R
  PJ["项目 Agent"] --> R
  N["饮食/恢复 Signal"] --> R
  R --> C["日程协调服务\n确定性冲突排序"]
  C --> P["单一 DAILY_SCHEDULE Proposal"]
  P --> A{"用户确认"}
  A -->|"确认"| E["事务更新 Event/Action"]
  A -->|"拒绝/编辑"| H["记录决策，不写日程"]
```

Agent 之间只交换受限的 `TimeRequest`、Signal 摘要和引用，不能把整个记忆、项目文件或健康记录广播给其他 Agent。日程协调服务是唯一能把跨模块请求合成为日程 Proposal 的模块。

### 5.3 项目只读分析

```mermaid
flowchart LR
  CLI["本机 evctl 授权项目根"] --> Auth["ProjectSource\ncanonical root"]
  Auth --> Builder["Snapshot Builder\nallowlist + size cap"]
  Builder --> Snapshot["ProjectSnapshot\n已过滤内容"]
  Snapshot --> Provider["Codex/分析 Provider\n无文件写工具"]
  Provider --> Brief["PROJECT_BRIEF artifact"]
  Brief --> Proposal["Action/TimeRequest Proposal"]
```

Core 自身读取项目根，Provider 只能看到快照。禁止 Provider 收到真实路径，禁止 Project Agent 触发 Shell、Git 写操作、分支、提交、推送或合并。

## 6. 日程的时间模型

| 概念 | 表达方式 | 理由 |
| --- | --- | --- |
| 用户时区 | Owner/Term 保存 IANA 名称，例如 `Asia/Shanghai` | 避免把本地 07:00 或课程时间硬编码为服务器时区 |
| 重复规则 | `CalendarRule` 保存周几、当地起止时间、周次范围、单双周模式 | 贴合高校课表而不依赖通用日历复杂语法 |
| 真实事件 | `Event` 保存 UTC instant + local date/time + timezone | 首页查询快速，例外可独立改动 |
| 异常 | `CalendarException` 替换/取消单个生成事件 | 补课/停课不破坏原重复规则 |
| 冲突 | 半开区间 `[start, end)` 在同一 Owner 下比较 | 相邻 10:00–11:00 与 11:00–12:00 不冲突 |

规则展开使用固定 Owner/Term 时区的日历日期，不能以 UTC 日期迭代。Daily Planner 只消费已确认的 Event 实例和已确认/已生效的 Signal。

## 7. 本地文件、数据库和备份

```text
<EV_DATA_DIR>/
  app.sqlite                   # 业务权威数据
  app.sqlite-wal               # WAL，必须随库备份
  app.sqlite-shm
  artifacts/                   # 原始截图和课程资料，非静态目录
  memories/                    # 可读 Markdown 投影
  backups/                     # 一致性快照；保留策略受设置控制
  logs/                        # 脱敏 JSONL 本地事件
```

- SQLite 使用 WAL、foreign keys 与有限 busy timeout；单进程单 Writer 避免多进程竞争。
- Core 在结构迁移前创建一致性备份，关闭时/闲时触发 checkpoint；任何恢复操作恢复数据库和对应 WAL 状态。
- Markdown 投影采用“临时文件 → flush → 原子 rename”更新；SQLite revision 在前，文件失败时标记待重试，绝不静默丢失 revision。
- 原始大文件不塞进 SQLite；数据库只保存内容哈希和访问元数据。

## 8. Agent 与记忆的权限矩阵

| Agent | 可读 | 可写 | 可外发 | 禁止 |
| --- | --- | --- | --- | --- |
| 日程协调 | Event、Action、TimeRequest、最小 Signal | Proposal、日程审计 | 仅必要的计划摘要 | 直接应用安排 |
| 项目 | 一个 ProjectSnapshot、项目记忆 | ProjectBrief、记忆候选 | 已过滤快照 | 原仓库写入、健康/饮食数据 |
| 学习 | 单课程档案、公开资料、课程记忆 | 学习 Proposal、课程摘要 | 该课程最小资料 | 学校登录、其他课程私密资料 |
| 健身 | Fitness profile、check-in、动作目录 | Signal、Workout Proposal、健身记忆 | 用户选定的健康 context packet | 诊断、直接排程 |
| 饮食 | Body goal、饮食记录、必要 Signal | Meal candidate、确认后记录 | 食物描述/数量的最小包 | 以模型猜测写营养事实 |
| Memory worker | 已授权 scope 的 L0/L1 | 版本化 L1/L2 摘要和投影 | 默认不外发 | 将网页/模型推断升级为高影响事实 |

策略在 Core 中强制，不依赖 system prompt。任何未知 Agent、未知工具或越 scope 请求默认拒绝并记审计事件。

## 9. Web 信息架构和远程边界

Web 使用真实 Next.js 路由和共享认证 layout。初始路由为：

```text
/setup                 唯一 Owner 初始化
/login                 登录
/today                 当天控制台
/calendar              日程、课表导入和 Proposal
/projects/:id          项目 Brief 与阶段
/courses/:id           课程档案、预习/复习
/fitness               Check-in、训练 Session、Signal
/nutrition             饮食记录和身体目标
/memory                分域记忆与版本恢复
/agent                 会话、运行和上下文清单
/settings/providers    Provider profile 与测试
```

Web 不保存业务事实的第二份状态；页面读取 Day View 或相应模块 API，提交 command 后根据服务器返回的版本刷新。所有页面应有未配置、运行中、失败、无数据和 409 冲突状态；移动端底部导航只能链接到真实路由，刷新/后退必须保持语义一致。

## 10. 安全与隐私架构

| 层 | 控制 |
| --- | --- |
| 浏览器 | HttpOnly 会话 Cookie、无 API key、React 默认转义、CSRF/Origin 校验、同源 BFF |
| Web BFF | 固定 Core base URL、路径 allowlist、不得转发任意主机/Authorization、限制上传流 |
| Core | 仅 loopback、Owner guard、速率限制、Zod、统一错误、审计、私有 artifact 目录 |
| Provider | Credential Store SecretRef、ContextManifest、超时/额度/能力白名单、响应 schema 验证 |
| 数据 | SQLite 权限、WAL 成组备份、scope policy、脱敏日志、文件哈希/规范化路径 |
| 远程访问 | 后续私有 HTTPS 仅暴露 Web；Core 端口和数据目录无公网入口 |

特别处理三类 AI 风险：公开资料/项目注释中的提示词注入只能作为数据；模型 JSON 通过 schema 与领域规则后才可显示/提出建议；任何有副作用的动作必须有独立的代码级 capability 和用户确认，不能由模型文字授权。

## 11. 演进与部署路径

### MVP 开发与本机运行

开发时运行两个本机进程：Next.js Web 与 Fastify Core。Core 数据目录由 `EV_DATA_DIR` 指定；开发/E2E 使用独立临时目录。Windows 优先交付以可审计的原生进程运行，Docker 不作为 MVP 前置条件。

### 第 ⑧ 步部署生产环境

生产阶段把两个进程包装为受控 Windows 服务/任务，并把 `EV_DATA_DIR` 放入用户权限受限的持久目录。随后评估私有 HTTPS 入口，使 iPhone 能访问 Web；该入口必须保留 loopback Core 边界。Docker 包装只在原生本机流程稳定后提供，数据卷映射不改变 Core/Contracts 接口。

### 第 ⑨ 步可观测性

先使用本地 JSONL/audit 与 health；远程日志、指标、告警、崩溃收集或遥测必须作为独立数据外发决策，默认关闭且需用户选择。

## 12. 现有原型审查证据与架构处置

Code Intel lite 于 2026-08-17 在隔离 worktree 完成，工件目录为：

```text
C:\Users\asus\AppData\Local\code-intel\artifacts\product-prd\1786905497646-3624-core
```

运行 outcome 为 `completed`；本地原生证据报告 129 个文件、303 个符号、312 条 import。该版本的 artifact manifest 只提供 content-addressed JSON，没有生成工具规范中预期的 `summary.md`、`hospital.md`、`understanding.md` 或 `report.json`，因此不存在可报告的“首个 hospital 失败分类”。代码证据使用 line-heuristic parser，关系精度为 heuristic；本架构不把它误称为完整调用图。

证据确认现有入口为 `apps/web`、`apps/core`、`packages/contracts`、`packages/domain`，并已有 `auth/tasks/agent/today` 技术原型。处置是保留分层、重构领域，而不是在 `tasks` 或现有聊天服务上继续累加产品功能。

## 13. 架构验收标准

在进入第 ⑤ 步任务拆解前，本架构必须被用于检查：

1. 任一日程写入都能画出 Proposal、确认、事务和审计路径；
2. 课程截图、模型输出、网页内容和本地项目文件都有输入验证与不可信边界；
3. 各 Agent 的可读 scope、可写对象、外发包和禁止操作明确；
4. Core 是唯一业务写入者，Web/iPhone 不直连 SQLite/Provider；
5. 迁移可保留已有 Owner、任务和会话；
6. 每项 MVP 功能能对应至少一类 Contracts、Domain、Core、Web 或 E2E 测试；
7. 当前 v0.2 基线测试失败已列为实现前阻断项，不能被架构文档忽略。
