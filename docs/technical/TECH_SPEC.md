# EV AI Dashboard 技术规格（TECH_SPEC）

| 字段 | 内容 |
| --- | --- |
| 版本 | 0.1 |
| 状态 | 已批准的长期目标技术规格；当前仅部分实现 |
| 日期 | 2026-08-17 |
| 上游依据 | [PRD](../product/PRD.md)、[MVP 范围](../product/MVP-SCOPE.md) |
| 范围 | 学院流程第 ④ 步：可实现、可测试的系统规格；不包含任务拆解或代码实现 |

> 实施状态说明（2026-08-17）：本文保留完整目标架构，不能被当作“所有能力已交付”的清单。已实现的模块、真实接口、已知限制和下一步优先级以[本地 MVP 技术设计](IMPLEMENTED-MVP-DESIGN.md)为准。

## 1. 目标、已选取的技术决策与非目标

本规格把已批准的产品要求转成 TypeScript 本地优先系统的契约。Owner 只需在自己的电脑上运行系统并配置 Provider，即可使用本地日程、记忆和 Agent；iPhone 访问同一 Web 界面，但不会拥有第二份数据库或 Agent 状态。

为避免技术设计停留在选择题，以下决策由本阶段固定：

1. 保留现有 monorepo 的 **Next.js Web + Fastify Core + SQLite + Zod Contracts** 分层，Core 是所有业务写入、调度、Agent 和审计的唯一所有者。
2. 所有业务事实以 SQLite 为权威来源；人类可读 `MEMORY.md` 是可版本化的本地投影与人工编辑面，不是模型自行相信的数据库。
3. AI、OCR/视觉、公开检索、营养查询和本地 Codex 都通过 Provider Port 接入；业务模块不得依赖供应商专有响应格式。
4. Agent 只能生成经过 schema 校验的分析、建议、时间请求和记忆候选；**Proposal 是日程及其他高影响计划写入的唯一入口**。
5. Project Agent 严格只读：它只接收受控的项目快照，不能获得原仓库写权限、Shell 权限、Git 写权限或任意文件路径。
6. 首期为单 Owner、本地 Windows 优先、Web 优先。Docker、公开网络暴露、多用户和外部日历/穿戴设备不在本规格的实现范围内。

## 2. 当前工程与实现约束

当前仓库已使用 Node 24、TypeScript 6、Next.js 16、React 19、Fastify 5、better-sqlite3 13 与 Zod 4。现有模块是 `apps/web`、`apps/core`、`packages/contracts` 与 `packages/domain`。

现有 v0.2 的任务、认证和聊天会话仅是技术原型，不能决定新的领域模型。实现可以复用其 Web/Core 边界、认证基础、迁移机制和契约测试方式，但必须以本规格的对象模型替换普通 `Task` 中心设计。

```powershell
npm install
npm run dev:core
npm run dev:web
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

历史基线的 `npm test` 曾因隔离 worktree 依赖边界失败；该问题已恢复并记录在[技术基线审查](../reviews/2026-08-17-technical-baseline-review.md)。后续功能仍不得通过跳过或重写失败测试掩盖回归。

## 3. 领域对象与数据权威性

### 3.1 四个跨模块对象

| 对象 | 核心字段 | 说明 |
| --- | --- | --- |
| `Event` | 时间范围、硬/软属性、来源、关联实体、版本 | 在真实日期发生的课程、会议、约会或已确认时间块 |
| `Action` | 标题、状态、预计时长、所属模块、关联 Event/Session | 可完成、延期、取消的具体行为 |
| `ActivitySession` | 类型、步骤、状态、关联 Actions、时长 | 训练、预习或深度工作等结构化计划；避免与认证 Session 重名 |
| `Signal` | 类型、值、来源、有效期、置信度 | 恢复、疲劳、限制等影响排程但不“完成”的状态 |

所有表都保留 `owner_id`，即使 MVP 只有一位 Owner，以保持 API 授权和未来可部署性的一致性。标识使用 UUID；可被并发编辑的实体使用递增 `version`；时间戳使用 ISO 8601 UTC，日程同时保存 IANA 时区和当地日期/时间，防止把「周一 08:00」错误地转换成跨时区的瞬时事件。

### 3.2 来源与证据

每一个自动生成的事实、建议或外部数据引用都有 `SourceRef`：

```ts
type SourceKind =
  | 'USER_INPUT'
  | 'SYSTEM_OBSERVED'
  | 'LOCAL_FILE'
  | 'EXTERNAL_SOURCE'
  | 'AGENT_INFERENCE';

interface SourceRef {
  id: string;
  kind: SourceKind;
  locator?: string;        // 本地对象 ID 或经验证的公开 URL；不含密钥
  capturedAt: string;
  contentHash?: string;
  confidence?: number;
}
```

`USER_INPUT` 和 `SYSTEM_OBSERVED` 可成为本地事实；`EXTERNAL_SOURCE` 与 `AGENT_INFERENCE` 只能成为引用或候选，不能未经确认变成课程、健康限制、日程或营养数值事实。

### 3.3 SQLite 表族

实现不要求一次写出所有列，但迁移必须按以下表族与关系建立：

| 表族 | 主要表 | 责任 |
| --- | --- | --- |
| 身份与系统 | `owners`、`sessions`、`settings`、`audit_events`、`jobs` | 单 Owner、会话、配置引用、审计和后台任务 |
| 日程 | `terms`、`courses`、`calendar_rules`、`calendar_exceptions`、`events` | 学期锚点、课程、重复规则、例外和实际日期事件 |
| 行动 | `actions`、`activity_sessions`、`activity_session_steps`、`entity_links` | 具体行动及其归属/时间关系 |
| 协调 | `schedule_requests`、`proposals`、`proposal_items`、`proposal_decisions` | 多 Agent 请求、可审计 Proposal 与确认记录 |
| Agent | `agent_runs`、`agent_artifacts`、`agent_conversations`、`context_manifests` | 运行状态、结构化输出、对话和实际外发上下文清单 |
| 记忆 | `memory_scopes`、`memory_revisions`、`memory_documents`、`memory_observations` | 分域版本、Markdown 投影、事实和压缩/过期策略 |
| 项目 | `project_sources`、`project_snapshots`、`project_briefs`、`project_milestones` | 已授权根、只读快照、分析和用户确认的阶段 |
| 健身 | `fitness_profiles`、`recovery_checkins`、`signals`、`exercise_catalogs`、`exercises`、`workout_sessions` | 训练基础资料、恢复和动作目录 |
| 饮食 | `body_goals`、`food_catalogs`、`food_items`、`meal_records`、`meal_items` | 身体目标、带版本的食物数据及确认的摄入记录 |
| 文件与资料 | `local_artifacts`、`course_resources` | 截图、材料和导入清单；文件本体不放 SQLite |

`events` 是首页时间线的权威来源；`calendar_rules` 仅描述生成规律。确认日程导入时，规则、例外和首批 Event Instance 必须在一个 SQLite 事务内写入。SQLite 的 WAL 文件与 `-shm` 文件属于持久状态，备份/迁移/移动时必须与数据库一起处理，不能只复制 `.sqlite` 文件。[SQLite WAL 文档](https://www.sqlite.org/wal.html)

## 4. 课表截图到日程的技术流程

### 4.1 输入、验证与本地保存

`POST /v1/uploads` 接受用户主动选择的课表图片。Core 在写入前检查：登录 Owner、请求大小、允许的图片 MIME/魔数、像素上限、哈希和重复上传。MVP 接受 PNG、JPEG、WebP；无法安全解析或超限的文件返回结构化错误，不交给模型。

文件存入 `<EV_DATA_DIR>/artifacts/<artifact-id>`，随机文件名、不作为静态 Web 目录暴露；SQLite 的 `local_artifacts` 仅保存路径、哈希、媒体类型、字节数、来源和保留状态。用户可从课程导入页面删除原截图；删除应取消未来对该文件的访问，但不删除已经确认的课程/日程事实。

### 4.2 异步提取 Run

上传后，客户端创建 `CourseImportRun`。Core 将图像与最小的提取上下文交给具备 `VISION_EXTRACTION` 能力的 Provider：当地时区、用户已选择的学期、预期 JSON schema；不发送用户健康、项目、记忆或 API 密钥。

Provider 必须返回受限 JSON，Core 用 Zod 解析并再验证：

```ts
interface CourseCandidate {
  title: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startLocalTime: `${number}:${number}`;
  endLocalTime: `${number}:${number}`;
  weekStart?: number;
  weekEnd?: number;
  weekPattern: 'EVERY_WEEK' | 'ODD_WEEKS' | 'EVEN_WEEKS' | 'UNKNOWN';
  location?: string;
  confidence: number;
  evidence: SourceRef[];
}
```

模型返回永远是不可信输入：字段超限、无效时间、重叠自相矛盾、未知周次或无法解析的结果只会生成“需要补全”的候选，不会写入日程。若没有视觉 Provider，Run 进入 `BLOCKED_PROVIDER`，界面说明需要连接视觉能力，不展示虚假识别结果。

### 4.3 从周次到真实日期

用户在 Proposal 中确认或补全 `Term`：`timezone`、第 1 教学周的周一、总周数和当前周。转换服务根据 `(weekday, weekStart..weekEnd, weekPattern)` 生成每个本地日期的 Event Instance；再把当地日期和时间转换为 UTC instant。补课、停课、单次改期使用 `calendar_exceptions` 与单独的 Event Instance 覆盖原规则，绝不篡改整个课程规则。

在生成 Proposal 前，Core 对候选 Event 与现有 Event 做半开区间 `[startsAt, endsAt)` 冲突检测，并标记硬 Event 冲突、软块冲突和不可用时段。优先级由确定性规则计算：硬 Event → 有效健康限制 → 明确截止日期 → 课程预习 → 训练目标 → 习惯偏好。模型可以解释取舍，不能改变排序函数。

### 4.4 Proposal 与确认

导入结果成为 `Proposal { type: COURSE_IMPORT, status: PENDING }`，其中逐项列出新增课程、重复规则、将生成的日期事件、低置信字段、冲突和来源。确认 API 必须携带 `expectedVersion` 和 `idempotencyKey`；Core 在单一事务中核对版本、应用所有项目、写入审计并更新 Proposal 状态。版本冲突返回 `409 VERSION_CONFLICT` 与最新 Proposal，不静默覆盖。

拒绝 Proposal 只关闭 Proposal 和其临时 artifact 引用；确认前没有课程、日程规则或 Event Instance 被创建。

## 5. 日计划与后台调度

后台调度属于 Core 进程，不属于浏览器或 Next.js。`jobs` 以数据库唯一键 `(owner_id, local_date, job_type)` 去重，保存计划时间、尝试次数、锁租约、状态与最后错误。启动时 Core 执行补偿扫描：若 Owner 所在时区当天已过 07:00 且没有成功的 `DAILY_PLAN`，只创建一次补偿 Run；系统时钟回拨不会重复计划。

日计划读取已确认 Event、Action、Signal、截止日期、课程预习/训练时间请求和用户优先级覆盖，产出 `DAILY_SCHEDULE` Proposal。它不直接改动 Event，也不主动发送通知。用户新建事项、完成 Check-in 或显式点击“重新规划”可生成新的 Proposal，但同一日期保留版本和历史决策。

每个 Job 有超时、最大重试、指数退避和可见失败状态；Provider 不可用时保留输入和失败原因，不生成伪造建议。业务写入短事务完成，绝不在 SQLite 写事务期间等待模型或网络。

## 6. Agent 运行、工具与 Provider Port

### 6.1 统一运行模型

Agent 由 Core 的 `AgentOrchestrator` 创建，运行状态为 `QUEUED → RUNNING → SUCCEEDED | FAILED | BLOCKED_PROVIDER | CANCELLED`。每次运行固定写入：领域、触发来源、输入实体版本、`ContextManifest`、Provider profile、输出 artifact、模型/工具耗时和错误分类。审计记录不保存 API 密钥、原始密码或完整敏感提示词。

领域 Agent 的可允许输出是下列辨析联合类型：

```ts
type AgentArtifact =
  | { kind: 'PROJECT_BRIEF'; brief: ProjectBrief; timeRequests: TimeRequest[] }
  | { kind: 'LEARNING_PLAN'; actions: ActionDraft[]; timeRequests: TimeRequest[]; citations: SourceRef[] }
  | { kind: 'WORKOUT_PROPOSAL'; session: WorkoutDraft; signals: SignalDraft[]; timeRequests: TimeRequest[] }
  | { kind: 'MEAL_CANDIDATES'; candidates: MealCandidate[] }
  | { kind: 'SCHEDULE_CANDIDATES'; candidates: EventDraft[] }
  | { kind: 'MEMORY_SUGGESTIONS'; changes: MemoryChangeDraft[] };
```

所有输出先由 Contracts schema 验证，再由领域服务检查实体版本、范围、时段和权限。模型输出不能调用 SQL、Shell、文件路径或 HTML；它不是业务操作的授权凭据。这个限制直接防范 Agent 的提示词注入、输出处理和过度授权风险。[OWASP LLM06: Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)

### 6.2 Provider Port

```ts
interface ModelProvider {
  profileId: string;
  capabilities(): Promise<Set<'TEXT' | 'STRUCTURED_JSON' | 'VISION'>>;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

interface PublicSearchProvider {
  search(query: SafeSearchQuery): Promise<SearchResult[]>;
}

interface NutritionDataProvider {
  search(query: FoodQuery): Promise<FoodCandidate[]>;
}

interface ProjectAnalysisProvider {
  analyse(snapshot: ProjectSnapshot, request: ProjectAnalysisRequest): Promise<ProjectBriefDraft>;
}
```

业务模块只依赖上述 Port。首期配置一套可替换的、OpenAI-compatible 风格的 Model Provider profile；用户可以让 DeepSeek 承担文本/结构化日常任务。截图路径只在该 profile 实际声明并通过测试为 `VISION` 时启用，否则必须配置独立视觉 Provider。不能假设所有文本模型支持图片。

Provider Profile 的非敏感信息（名称、base URL、模型、能力、启用状态）存入 SQLite；密钥只存入 Windows OS Credential Store，通过 `SecretRef` 引用。没有可用 OS Secret Store 时，生产模式拒绝持久化 API key；测试可使用内存 Secret Store。不得以 `.env`、浏览器 LocalStorage、日志或 API 响应保存密钥。

Provider 调用统一设定请求超时、输入/输出 token 上限、每 Run 最大调用数和失败重试上限。连接测试使用无个人数据的最小请求；用户能看到此次 Agent 运行实际会外发的 `ContextManifest`，尤其是健康上下文可在「最小必要」/「完整上下文」间选择和编辑。

### 6.3 项目分析的只读边界

项目根目录只能通过本机 `evctl project authorize <path>` 授权。该本机命令解析真实路径、拒绝非目录/符号链接逃逸，并将允许的根目录写入 `project_sources`；远程 iPhone 页面只能查看、触发对已授权项目的分析，不能授权新的本机路径。

`ProjectSnapshotBuilder` 只读取授权根内、大小和数量受限的允许文件：源码、Git 元数据摘要、PRD/技术文档/任务文档与测试摘要。它排除 `.env*`、密钥/证书、依赖目录、二进制、构建产物和超大文件。传给 Codex 或其他 Provider 的是已筛选快照，而非原项目路径；Provider 无 Shell、Git 或文件写入工具。若不能证明某个本地 Codex 接入满足这一点，则该 Provider 不可用，不能降级为“先执行再相信它只读”。

### 6.4 公开检索与 RAG

学习 Agent 可使用一条 `PublicSearchProvider` 和用户明确提供的公开课程 URL。所有网页/PDF 文本都视为不可信资料：提取内容带 URL、时间、哈希和长度限制；不能执行页面指令、登录学校系统或读取私有网络地址。服务端 URL 抓取必须仅允许 HTTPS、拒绝重定向到 loopback/private/reserved IP、限制大小和内容类型，以避免 SSRF。

RAG 仅为课程材料、动作说明或用户授权资料的相关片段检索服务。向量索引按 `owner_id` 和 scope 隔离；检索到的片段是引用，不是事实写入。营养数值来自 `NutritionDataProvider` 的可版本化数据项与用户确认，不能由 RAG 或语言模型估算后直接落库。

## 7. 本地记忆设计

### 7.1 双层存储与范围

SQLite 保存事实、观察、记忆版本、访问范围、来源、撤销状态和审计；Core 将每个 scope 的当前可读摘要投影为文件：

```text
<EV_DATA_DIR>/memories/
  user/USER.md
  schedule/MEMORY.md
  projects/<project-id>/MEMORY.md
  courses/<course-id>/MEMORY.md
  fitness/MEMORY.md
  nutrition/MEMORY.md
  shared/SCHEDULE-CONTEXT.md
  daily/YYYY-MM-DD.md
```

页面内编辑、删除、恢复都通过 Core 创建 `memory_revisions`，再以原子写入更新 Markdown 投影。文件被用户在操作系统中直接编辑/删除时，Core 只把变化检测为待导入的人工变更；用户在界面确认后才形成新 revision。这样既保留 Hermes 式的可见文件，又不会让任意文件内容绕过版本、来源或提示词安全边界。

### 7.2 生命周期与访问控制

| 层 | 写入策略 | 压缩/过期 |
| --- | --- | --- |
| L0 原始记录 | 用户输入、确认记录、Check-in 自动本地保存 | 不自动改写；按用户保留策略删除 |
| L1 每日工作摘要 | 每天自动生成，可查看 | 可压缩为 L2，短期上下文可过期 |
| L2 长期记忆 | 直接事实或有来源的 Agent 摘要自动版本化 | 旧版保留，可恢复 |
| L3 高敏感记录 | 自动本地保存，限制到 Fitness/Nutrition scope | 不自动进入其他 Agent 或外发包 |

`MemoryPolicy` 对每个 Agent 明确读取 scope、写入种类、是否允许外发。日程协调器只读取健康模块提供的最小 `Signal`，而非完整健康史；Project Agent 不能读取健身、饮食或课程私密记忆。

## 8. HTTP API 与一致错误语义

所有 Web 请求经 Next.js same-origin BFF 到 loopback Core；浏览器绝不直接连接 `4311`。每个受保护端点验证 Owner 会话和资源 `owner_id`。输入和第三方响应在边界由共享 Zod schema 验证；Fastify v5 的路由验证/响应序列化也应使用固定 schema，不能使用用户提供的 schema。[Fastify Validation and Serialization](https://fastify.dev/docs/v5.0.x/Reference/Validation-and-Serialization/)

成功响应统一为 `{ "data": ... }`，错误统一为：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "该建议已被其他操作更新，请刷新后再确认。",
    "details": {}
  }
}
```

| 端点族 | 关键端点 | 语义 |
| --- | --- | --- |
| 日视图 | `GET /v1/days/:localDate` | 返回 Today 控制台聚合，含 Event/Action/Signal/Proposal 摘要 |
| 文件/导入 | `POST /v1/uploads`、`POST /v1/course-imports`、`GET /v1/agent-runs/:id` | 上传、异步截图提取和 Run 轮询 |
| 日程 | `POST /v1/schedule-proposals`、`GET /v1/events` | 创建自然语言日程建议与查询已确认 Event |
| Proposal | `GET /v1/proposals/:id`、`POST /v1/proposals/:id/approve`、`POST /v1/proposals/:id/reject` | 查看依据、按版本确认或拒绝 |
| 课程 | `GET/POST/PATCH /v1/courses`、`POST /v1/courses/:id/learning-runs` | 档案和预习/复习建议 |
| 项目 | `GET /v1/projects`、`POST /v1/projects/:id/analysis-runs` | 已授权项目与只读分析；授权由 `evctl` 完成 |
| 健身 | `POST /v1/recovery-checkins`、`POST /v1/workout-runs`、`GET /v1/workouts/:id` | Check-in、训练建议和执行记录 |
| 饮食 | `POST /v1/meal-parse-runs`、`POST /v1/meals/:id/confirm` | 候选食物解析、数据查询和确认写入 |
| 记忆 | `GET /v1/memories`、`PATCH /v1/memories/:scope`、`POST /v1/memories/:scope/restore` | 查看、修改、删除/恢复 revision |
| 设置 | `GET/PATCH /v1/provider-profiles`、`POST /v1/provider-profiles/:id/test` | 非敏感配置、密钥引用和无数据连接测试 |

状态码约定：`400` 语法错误、`401` 未认证、`403` 越权、`404` 不存在、`409` 实体/Proposal 版本冲突、`413` 上传超限、`422` 语义不合法、`429` 限流、`503` Provider 未配置/不可用、`500` 不泄漏内部错误。所有变更请求支持 `Idempotency-Key`，确认/记录类请求必须有 `expectedVersion`。

## 9. 认证、威胁模型与安全要求

主要资产为 Owner 会话、Provider 密钥、健康/饮食数据、项目快照、日程和记忆。信任边界为浏览器输入、截图/资料上传、外部 Provider 响应、公开网页、本地项目文件、SQLite/Markdown 与远程 iPhone 连接。

| 威胁 | 设计控制 |
| --- | --- |
| 远程冒充或会话窃取 | 单 Owner、强口令 KDF、HttpOnly/Secure/SameSite Cookie、登录限流、HTTPS 私有入口 |
| 日程误写/并发覆盖 | Proposal、版本号、幂等键、事务、审计和 409 返回最新状态 |
| Prompt injection/过度授权 | 结构化输出验证、无模型直连工具、能力白名单、项目快照隔离、确认闸门 |
| Provider/网页泄露敏感数据 | ContextManifest、scope policy、密钥 OS 存储、SSRF/内容限制、无完整 DB 上传 |
| 上传和路径攻击 | 魔数/大小校验、私有文件目录、规范化路径、授权根、符号链接逃逸拒绝 |
| SQLite 损坏或迁移丢数 | WAL 成组备份、迁移前快照、事务、迁移计数校验、可回退备份 |

现有 `crypto.scrypt` 实现采用随机 16-byte salt、异步 KDF 和 timing-safe comparison；实现阶段保持该设计或以有迁移方案的更强 KDF 替换，绝不保存明文密码。Node 文档说明 scrypt 的 salt 应随机且至少 16 bytes。[Node Crypto: scrypt](https://nodejs.org/api/crypto.html)

Core 仅绑定 `127.0.0.1`。远程 iPhone 访问属于第 ⑧ 步部署设计：只可通过私有 HTTPS 反向代理/私有网络暴露 Web，不得公开 Core 或 SQLite。生产部署开启安全 Cookie、固定 CORS、CSP/安全响应头和日志脱敏。

## 10. 迁移、备份、测试与可观测性契约

### 10.1 从 v0.2 的迁移

迁移为只增不破坏：先对关闭/一致的 SQLite 数据库创建包含 `-wal`/`-shm` 的时间戳备份；在一个版本化迁移序列中建立新表，并把旧 `tasks` 映射为 `actions`（保留原 ID、Owner、标题、状态、日期、版本和来源 `LEGACY_TASK`）。既有 `agent_sessions`/`agent_messages` 原样保留为 legacy conversation，不被错误解释为领域记忆。

每次迁移后校验 Owner 数、原 Task/Action 数和关键外键数；校验失败立即停止并指向迁移前备份。任何破坏性清理只在确认数据已迁移、备份可恢复且用户批准后才可执行。

### 10.2 测试分层

| 层级 | 必测对象 |
| --- | --- |
| Contracts | Zod 输入/输出、错误、版本与枚举的兼容性 |
| Domain unit | 周次展开、时区转换、冲突排序、恢复规则、营养计算、记忆政策 |
| Core integration | SQLite 迁移、授权、Proposal 事务、幂等、Provider 失败、项目根隔离、SSRF 拒绝 |
| Web component | 今日控制台、低置信导入、确认对话、未配置 Provider、无障碍状态 |
| E2E | 独立端口/数据目录上的课表导入确认、项目 Brief、Check-in→Session→Proposal、饮食确认、手机路由 |
| 安全/回归 | Owner 隔离、越权 403、文件/路径限制、上下文最小化、无伪造 Provider 回复、迁移不丢旧数据 |

测试环境绝不使用用户的 `EV_DATA_DIR`。每个 E2E worker 使用临时数据库、独立端口和唯一 Owner；测试结束只删除自己创建的已验证临时目录。

### 10.3 可观测性预留

第 ⑨ 步才会部署完整监控，但实现必须从 MVP 起生成本地结构化事件：请求 ID、Owner ID 哈希、运行 ID、Proposal ID、Provider 名称、耗时、错误代码、Job 状态与迁移版本。不得记录密码、密钥、原始健康详情、完整提示词或未经许可的项目文件内容。

`GET /v1/health` 仅暴露最低限度状态：Core 版本、数据库可读写、迁移版本、最近日计划 Job 状态与 Provider 可用性；详细诊断仅给本机 Owner。未来告警与远程日志传输要在第 ⑨ 步单独批准。

## 11. 实施边界

**始终执行：** Contracts-first、边界验证、权限校验、测试隔离、原子迁移、审计、对模型输出进行 schema 验证、对高影响日程写入要求确认。

**实施前需重新确认：** 新的 npm/native 依赖、OS Secret Store 的具体适配包、外部搜索/营养/视觉 Provider、数据库不可逆迁移、远程反向代理、CI/CD 或 Docker 改动。

**绝不执行：** 提交 API key/用户数据；直接把模型输出执行为 SQL/Shell/HTML；直接公开 Core/SQLite；让项目 Agent 写入项目；绕过 Proposal 写日程；让公开网页指令成为 Agent 指令；将学校登录凭据交给 Agent。
