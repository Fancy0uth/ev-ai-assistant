# EV AI Dashboard 技术规格（TECH_SPEC）

## 2026-09-16 退役契约（优先于旧项目设计）

依据 PRD 最新批准，删除项目分析模块的运行入口与专属实现，不再装配 ProjectAnalysisProvider、项目目录授权 CLI、项目会话或晨间分析任务。旧 §6.3、§12.1、§14/15 仅保留设计溯源，不能据此继续开发/调用。Fitness §16 与其他领域不变。

退役不执行数据迁移或清库：保留所有已编号迁移以及 PROJECT 历史标识、外键、记忆隔离和已创建任务/日程兼容。通用 Proposal 确认入口须拒绝新的项目应用且无部分持久化；安全拒绝历史候选不应恢复分析能力。前端删除项目导航/详情入口，历史工作事项回到可操作的普通任务流程，不能产生失效项目链接。DeepSeek 配置和每日计划/课程用途不受影响。

本次检查限定为合成数据上的接口退役、任务可用与导航回归，以及受影响 workspace 的类型/构建；不改变真实调用、隐私、部署授权。实际端点与错误码以 [API](API.md) 为准；进度与修复次数只维护于 [TASKS](../plans/TASKS.md)。

> 权威正文迁移（2026-09-08）：原批准/审核记录与目标蓝图保留，不代表当前实现或发布通过。唯一进度见 [TASKS](../plans/TASKS.md)，现有接口见 [API](API.md)，运行见 [DEPLOYMENT](DEPLOYMENT.md)。V8 增量以 [TECH_SPEC 第 12 节](TECH_SPEC.md#12-v8-增量设计冻结) 为准；旧蓝图中的未实现命令、端点与目录均为设计待核验，不能作为可调用说明。

| 字段 | 内容 |
| --- | --- |
| 版本 | 0.1 |
| 状态 | 已批准的长期目标技术规格；当前仅部分实现 |
| 日期 | 2026-08-17 |
| 上游依据 | [PRD](PRD.md)、[MVP 范围](product/MVP-SCOPE.md) |
| 范围 | 学院流程第 ④ 步：可实现、可测试的系统规格；不包含任务拆解或代码实现 |

> 实施状态说明（2026-08-17）：本文保留完整目标架构，不能被当作“所有能力已交付”的清单。已实现的模块、真实接口、已知限制和下一步优先级以[本地 MVP 技术设计](technical/IMPLEMENTED-MVP-DESIGN.md)为准。

## 1. 目标、已选取的技术决策与非目标

本规格把已批准的产品要求转成 TypeScript 本地优先系统的契约。Owner 只需在自己的电脑上运行系统并配置 Provider，即可使用本地日程、记忆和 Agent；iPhone 访问同一 Web 界面，但不会拥有第二份数据库或 Agent 状态。

为避免技术设计停留在选择题，以下决策由本阶段固定：

1. 保留现有 monorepo 的 **Next.js Web + Fastify Core + SQLite + Zod Contracts** 分层，Core 是所有业务写入、调度、Agent 和审计的唯一所有者。
2. 所有业务事实以 SQLite 为权威来源；人类可读 `MEMORY.md` 是可版本化的本地投影与人工编辑面，不是模型自行相信的数据库。
3. AI、OCR/视觉、公开检索和营养查询通过 Provider Port 接入；业务模块不得依赖供应商专有响应格式。专属 Codex 接入已退出范围。
4. Agent 只能生成经过 schema 校验的分析、建议、时间请求和记忆候选；**Proposal 是日程及其他高影响计划写入的唯一入口**。
5. 不再提供项目文件访问或分析能力；保留历史数据不能成为重新取得项目访问权限的途径。
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

历史基线的 `npm test` 曾因隔离 worktree 依赖边界失败；该问题已恢复并记录在[技术基线审查](reviews/2026-08-17-technical-baseline-review.md)。后续功能仍不得通过跳过或重写失败测试掩盖回归。

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

### 6.3 项目分析的只读边界（历史设计，已退役）

原蓝图拟用本机 `evctl project authorize <path>`（设计命令，尚不可调用）授权；V8 改为第 12 节的 CLI 直连现有 EV 数据库与 `project_scopes`，不新增 local-admin HTTP 或凭据。远程页面只能使用已授权 project ID，不能授权新路径。

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

## 8. HTTP API 与一致错误语义（长期设计待核验，非可调用目录）

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

## 12. V8 增量设计冻结

本节是本轮三链唯一增量正文，覆盖旧 V8 计划相冲突的 local-admin HTTP、migration v21 和外部分析必选要求。它是设计待实现/待核验，不是已有能力。进度与小契约只见 [TASKS](../plans/TASKS.md)，实际路由见 [API](API.md)。

### 12.1 项目：授权 → snapshot → Brief → 确认 Action → TimeRequest（历史设计，已退役）

- 本机 CLI 复用 config、openDatabase、auth repository 与 scope-service，直接打开 EV_DATA_DIR/app.sqlite；要求库已存在且仅一个 Owner，零/多 Owner 拒绝，不创建账号或凭据。CLI 显式给出精确目录，realpath 后拒绝相对、UNC/设备路径及 symlink/junction 逃逸。只写 EV 授权表，保留旧 scope；关闭 HTTP 目录登记与 Web 表单，BFF 不转发登记写请求，不新增 local-admin HTTP。
- 当前 snapshot 仅根 PRD.md / TECH_SPEC.md / ARCHITECTURE.md / TASKS.md、单文件 256000 bytes。V8 在现有 builder 上增加 docs/PRD.md、docs/TECH_SPEC.md、docs/ARCHITECTURE.md、plans/ROADMAP.md、plans/TASKS.md 明确白名单；规范正文优先，兼容旧根入口，同内容只取一次。不泛递归、不跟随 Markdown 链接、不新增 shell/Git 采集。
- 固定预算：至多 9 个候选路径（如有必要加入 README.md 则至多10个）、最大路径深度2、单文件 256000 UTF-8 bytes、总计 512000 bytes；只读普通文本，拒绝 symlink/junction 链、二进制、secret、越界与超限，记录 skipped reason、relativePath、hash 和读取时间。Provider 入参只含有界 snapshot value，不含授权根/任意文件或执行工具；项目内容一律是不可信数据。
- 显式 `LOCAL_RULES` 是可产品运行的本地静态建议，不是 Fake 或模型分析：展示模式、读取证据、限制、阶段建议与 Action 草案，不能凭文档把里程碑标成完成。外部模式只经可选 ProjectAnalysisProvider Port；未配置或不能证明受限能力时 503，不隐式 fallback。真实调用/项目另授权。
- Owner 确认有版本的 Action 草案后，复用现有 Proposal/Action/TimeRequest 事务写 EV 数据；重复确认不重复创建，stale 输入拒绝。项目文件与 Git 不变；阶段/长期记忆不能由分析自动确认。

### 12.2 记忆：实体隔离 → 规则 draft → 确认/拒绝/恢复

- 身份为 `ownerId + scopeType + scopeId`。兼容 GENERAL/FITNESS/LEARNING/PROJECT 四域：以 DOMAIN + 原域名作为稳定兼容键；实体使用 PROJECT/projectId、COURSE/courseId、FITNESS/ownerId、NUTRITION/ownerId、DAILY/localDate。实体归属必须 Owner 验证，课程/项目间不得串读。原四域文本、revision 与旧接口不丢失，不猜测旧 PROJECT 属于哪个项目。
- 复用 memory service 与 Markdown 投影。新增 revision 的 parent/source refs、输入版本和字节预算可追溯；新迁移在实际 max22 之后追加，编号实施前再核对，旧迁移不改。
- 增量存储裁定：旧 memory_documents / memory_revisions 保留，DOMAIN 适配旧服务；实体内容与revision使用追加表，由小实体服务复用投影/版本模式。这样不猜测迁移旧四域到某个具体项目，避免破坏旧接口。实体投影路径包含受控Owner与实体身份，不接收客户端任意文件路径。具体已落盘编号和表见 DATABASE，状态只见 TASKS。
- `LOCAL_RULES` 对同 scope 当前摘要进行确定性分段/精确重复段合并，保留顺序与来源映射，不改写 L0、不推断新事实、不合并不同 scope。手动可生成 draft；自上次处理基点累计 32768 UTF-8 bytes 或 20 个 revision 时自动生成同样 draft，输出不大于输入且至多 16384 bytes；超限不截掉独有事实，明确阻断需人工处理。预算不触发 Provider/网络。
- draft 保存 baseVersion、source revisions、保留/合并 diff、规则模式、字节数及状态。相同 scope/baseVersion 仅一份未决 draft；确认前当前文本/投影不变。确认检查版本后追加 revision；拒绝追加决策，不改当前 revision/投影；恢复从尚存 revision 追加新 revision，不倒写历史。自动 draft 绝不自动应用。
- 本轮压缩减少有效摘要与后续上下文大小，不以“压缩”为由删除历史，也不承诺数据库磁盘占用停止增长。长期存储配额、历史归档与备份保留策略属于后续显式方案，不在本轮悄悄清理事实。
- 删除沿用永久删除语义，原文、revisions、投影删除时同时使引用它们的 drafts 不可用；不得保留可重建被删内容的 draft payload。旧 draft/restore/重试都不能复活删除内容；再次手动新建是新文档代际，不继承旧 draft 权限。

### 12.3 协调：已有 TimeRequest → 一个活跃协调 proposal → 确认排程

- 复用 daily-planning context/service/repository/review-service 与 execution-unit-of-work；消费同 Owner/日期 ACTIVE 的 project/learning/fitness/life TimeRequest 与最小 Signal，保留 origin/版本/来源，不另建协调数据库或平行排程服务。
- 同 Owner/localDate 仅一个活跃 daily coordination proposal，包含待审核或部分采用后仍可确认的候选。生成/替换在现有事务中原子关闭旧候选、写入新候选；并发由数据库唯一约束兜底，历史记录不删。仅约束该协调类别，COURSE_IMPORT、Workout、Memory、Meal 等其他类型可并存。
- 确认复用 expectedProposalVersion、scheduleVersion、幂等与审计事务；stale 409、不部分写入，未确认不改 Event。LOCAL_RULES 协调模式如接入，必须显式标静态规则并复用领域冲突规则；外部日计划模式继续要求 Provider，未配置 503，绝不自动降级。
- 本地规则模式的最小实现采用已有 context-service 数据包与 validator，按现有请求优先级在允许时间窗寻找可用区间，避开已确认事件；放不下的请求保留为带原因的未安排项。不是模型推理，也不自动把学习/训练/项目事实改成“已完成”。存储继续使用 daily_plan_runs/proposals；旧候选用既有 STALE 状态保留历史，只有该表的活跃协调候选施加唯一性，通用 proposals 不受影响。生成和确认都沿用已有版本/事务路径。

实现文件、进度和实际最小检查只由 TASKS 的 01～05 契约维护。本节是设计，不作为运行证据。

## 13. V9 私有运维增量设计冻结

沿用[批准的V9设计](superpowers/plans/2026-08-23-v0.9-private-iphone-operations.md)，不重建架构。本文是增量目标，不是已实现/实机成功声明；唯一任务、状态、检查预算与证据见[TASKS](../plans/TASKS.md#v9-当前执行契约2026-09-08)。本节覆盖旧计划不符合当前源码的路径/命令与本轮授权冲突，历史报告不改写。

### 13.1 V9-01：显式可信 Web Origin 与可登录的 CSRF 边界

源码起点：Core `loadConfig` 已拒绝所有非`127.0.0.1`值；BFF已有固定loopback origin校验、5,000,000 bytes body上限、手动redirect、cookie/header白名单及项目登记405，但没有Origin/CSRF；浏览器写入包括auth均经`requestCore`。复用这些控制，不宣称旧代码已有CSRF。

- 拟新增服务端配置`EV_WEB_ORIGIN`为唯一可信Web origin，要求显式配置且只含scheme/host/port（无用户信息、路径、query、fragment）；无效/缺失配置fail closed。远程仅HTTPS；开发/隔离HTTP仅显式loopback值。普通本机示例`http://127.0.0.1:3000`，E2E固定`http://127.0.0.1:3217`，Core上游仍为独立的`EV_CORE_URL`（E2E `http://127.0.0.1:4327`）。不可根据请求Host、Forwarded、X-Forwarded-Host/Proto或Origin自动扩充可信列表；真实HTTPS域名必须用户选定后配置，不在文档猜测。
- 所有BFF mutation（POST/PUT/PATCH/DELETE）在读取/转发body前要求Origin与配置的规范origin精确匹配，缺失、null、多值、跨origin均403。拒绝不得调用Core，不设置宽泛CORS。GET/HEAD不得承担业务写入。服务端固定upstream，不接受浏览器目标URL/凭据/header代理。
- 拟新增`GET /api/csrf`，无Owner可初始化，返回`{ token: string }`及host-only `ev_csrf` cookie，token使用密码学随机数（至少32 bytes）、固定编码/长度；cookie `Path=/; SameSite=Strict`，HTTPS `Secure`，无Domain，非HttpOnly供同源前端读取，`Cache-Control: no-store`。会话`ev_session`继续HttpOnly/Strict，远程Secure；不能为兼容HTTP测试关闭生产Secure。初始化不依赖session，不能形成“先登录才能取登录token”的循环。
- CSRF初始化仅同源调用：有Origin时同样精确校验，显式cross-site Fetch Metadata拒绝；无Origin的同源GET允许，响应无跨域读取许可。复用格式正确的现有token避免并行初始化轮转竞态；前端首次初始化共享pending promise，`requestCore`在每次mutation带`X-EV-CSRF-Token`，BFF要求与格式正确的cookie等值（拒绝重复/歧义cookie）。这些CSRF值不转发Core、不记录日志。Origin+host-only cookie+header绑定共同防护，不单凭cookie存在放行。
- 仅`auth/setup`和`auth/login`的写入免Owner，不免Origin/CSRF，继续唯一Owner建立检查、口令验证及限流。其余写入要求有效Owner；补足现有logout的认证检查。BFF不自行把session cookie存在判为已认证，Core复用`createAuthGuard`验证有效期/Owner与资源归属。只读setup-status/session及匿名最小health保持初始化可用。
- 全部`local-admin`路径不代理；2026-09-16 起 projects 整支按退役边界拒绝，不再建议通过 CLI 登记。Web-only远程不提供路径授权/备份恢复HTTP入口。CSRF不是Proposal Confirm、expectedVersion或幂等的替代。
- 安全头覆盖HTML/BFF成功及错误：`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`及CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`。生产CSP的script/style与现有Next运行方式核对、使用nonce或hash承载必需内联脚本，不为了过检查开放任意来源/生产unsafe-eval；不得以静态头字符串证明页面可用。HSTS仅可信HTTPS部署，先短max-age、不自动preload/includeSubDomains；本地HTTP不发HSTS。不能根据不可信forwarded proto启用安全策略。

### 13.2 V9-02：受管本地进程，不执行系统注册

源码起点：Core `start`实际为`tsx src/server.ts`，无Core build产物/独立migration CLI；Web `start`为loopback Next start，需既有Web build；`scripts/windows`尚不存在。拟新增脚本不等于已可执行命令。

- launcher接收显式绝对`RepoRoot`、`DataDir`、`LogDir`，WebOrigin遵守13.1；解析并验证存在的repo/build/runtime，数据/log只能在明确选定根内创建，拒绝UNC/设备路径及junction/symlink逃逸，不接受用户串接shell命令。不默认触碰日常EV_DATA_DIR。使用已装Node/tsx/Next、参数数组、固定working directory；后台Start-Process必须Hidden，不下载/安装，不管理员常驻。
- 集成裁定：launcher消费`next start`生产构建，故其WebOrigin必须HTTPS；普通HTTP本机预览继续用dev命令。外部WebOrigin端口不等于本机监听端口，单独WebPort默认3000、CorePort默认4311，合成测试显式指定隔离端口。子进程显式传EV_CORE_PORT、EV_CORE_HOST=127.0.0.1、固定EV_CORE_URL、EV_WEB_ORIGIN、NODE_ENV=production、EV_SECURE_COOKIES=true与数据/log目录；不能让ready探测端口和Core实际启动端口分离。
- 按规范data路径建立排他锁，记录本次启动标识、PID及进程创建时间等可核对所有权；重复启动拒绝，陈旧锁不能直接按PID杀进程，端口已被陌生进程占用即失败。Core先启动，现有`openDatabase`仅在这一明确启动流程迁移；等待既有`/v1/health/ready`有界就绪后启动Web。不能另造一个尚不存在的migration命令，不双进程抢迁移。
- 有界启动失败/child crash/停止时只回收本次拥有且身份仍匹配的子进程，释放自己持有的lock；不按端口/名字批量kill。Web健康不冒充Owner登录完成；锁/数据/备份不因启动失败删除。运行日志接入13.4后不把原始环境或stdout任意永久落盘。
- install/uninstall均`SupportsShouldProcess`，WhatIf完整展示拟执行精确任务定义且零注册/删除/子进程启动/配置写入；仅当前Windows用户登录触发、最低权限、无保存密码、无网络入口/防火墙变更。任务记录repo/data参数和所有权标识；相同定义幂等，不同/陌生同名任务拒绝覆盖。uninstall只移除经核对归属的精确任务，不删应用、数据、日志或备份。
- 本轮仅mock任务/进程与临时合成路径验证，真实注册删除/启动日常库/主机重启均需精确目标与用户授权；真实自启动成功不能由WhatIf推断。

### 13.3 V9-03：SQLite-only 一致备份与隔离恢复

源码起点：`openDatabase`会mkdir、开启WAL和自动迁移，不能用作无副作用校验；实际schema max26。使用已装better-sqlite3 `database.backup()`生成独立一致快照，禁止直接复制活跃db/wal/shm。本轮不制造migration，必要新增先重读max、只追加。

- 服务产生独占新备份目录中的`app.sqlite`与`manifest.json`；备份完成后关闭快照写句柄，使用`new Database(path, { readonly: true, fileMustExist: true })`读取快照的schema_migrations、计数与`PRAGMA quick_check`，计算SHA-256/bytes。成功manifest最后原子落盘，失败不留下可被误判为已完成的manifest，不删除最后可用备份。
- manifest最小字段固定：`formatVersion: 1`、`scope: 'SQLITE_ONLY'`、`createdAt`（UTC）、`appVersion`（APP_VERSION）、`schemaVersion`、`database: { file: 'app.sqlite', bytes, sha256 }`、`ownerCount`、`counts`（实际owners/tasks/agent_runs等已存在表）、`quickCheck: 'ok'`、`includes: ['sqlite']`、`excludes: ['artifacts', 'memory-projections', 'runtime-logs', 'dpapi-user-context', 'external-project-files']`。所有计数/schema取同一快照，不读取活动源拼装。库内Provider密文随SQLite保留，但不导出/解密密钥，不含DPAPI CurrentUser保护环境；换用户/机器不能假定可解密。hash用于完整性检测，不是对恶意共同篡改snapshot+manifest的签名认证。
- SQLite包括业务事实和库内引用，不包括`artifacts`文件本体、`memory`投影或外部授权项目；缺失侧车不能宣称全量应用恢复。记忆正文可在库内存在，不意味着本轮实现了投影重建CLI；恢复后artifact引用可能悬空、Provider可能需原用户环境或重新配置。完整数据可恢复性仍是单独真实环境门禁，SQLite-only成功不能将它勾完。
- 恢复分为只读verify→独占隔离目标副本→副本验证。先严格解析manifest（大小/字段/版本/计数边界），固定文件名禁止路径穿越，realpath拒绝源/目标/父链链接逃逸、目标与活动库/备份源重叠或已存在。核对hash/bytes、quick_check、实际schema_migrations和计数，未来schema/manifest不匹配拒绝。只读verify不调用openDatabase、不启动buildApp/调度/Provider。
- 复制到新的隔离目录后复验；如支持旧schema升级，只能在已验隔离副本调用现有迁移、记录升级前后版本并再校验，不能改源备份/原库；本轮只测当前26，不新增多版本矩阵。CLI仅提供新快照/verify/隔离演练语义，不提供replace-active/force覆盖参数。具体函数导出和CLI拼写由实施落盘后登记API，不把规划当已有evctl。
- 真实恢复的停服、保留原库、同卷原子换入、失败回滚及DPAPI/artifact恢复验证仍保留为另授权操作门禁；本轮不实现或执行活跃库替换。备份含敏感SQLite事实，即使无明文Key仍应Owner目录权限、不可作为Web静态目录、不上传。

### 13.4 V9-04：结构化脱敏、轮转和纯读健康

源码起点：Fastify logger已启用，`server.ts`可能记录原始error；没有独立observability/轮转。已有匿名`GET /v1/health/live`返回live/version，`GET /v1/health/ready`仅`select 1`给database up/down。不另造旧计划的`/health`别名。

- 新logger仍消费既有request/run/proposal关联事件；最终写入字段allowlist为时间、level、component、event、经格式校验的requestId/runId/proposalId、mode、elapsedMs、状态/稳定errorCode、有限计数与app/schema version。字符串必须有长度/字符约束，component/event/errorCode用固定值或映射；不能让用户控制的requestId承载正文。嵌套字段默认丢弃，原始err/error.message/stack、URL/query、任意路径、req/res、cookies/Authorization、密码/token、OCR/项目/记忆/健康正文、prompt均不落盘，不能仅用正则替换已知Key。
- 同一安全序列化覆盖Fastify自动请求与现有业务日志；禁用默认原始req/res/error自动输出或显式安全serializer，防止只保护新logger而旧通道仍泄漏。固定log根下JSONL默认单文件5 MiB、保留最多3个已轮转文件，加当前文件最多4个；单事件有界（至多8 KiB，超限丢弃可选字段或整事件、仅写固定降级码），串行写入/轮转，重开进程延续计数，不按时间泛删目录。
- Owner-only权限要求保留；隔离测试只验证合成目录。无法建立可证明的受限目录/权限时不得声称安全落盘，降级为不写敏感输出的固定错误状态；磁盘满/写失败不能抛原始路径到stderr或递归记录。日志状态degraded可见，不因日志失败伪造业务成功/失败；最多固定非敏感stderr提示。
- 03/04权限共用`createPrivateDirectory(absolutePath)`与`assertPrivateDirectory(absolutePath)`，前者只创建新目录并设置/验证受限权限，后者只读核验现存目录。launcher的EV_LOG_DIR作为root，实际JSONL使用其固定runtime子目录，与临时文件分离；不修改已有root ACL。未知权限降级，不以Windows的mode0600替代DACL证明。
- 源码未发现现成icacls/chmod/ACL helper；DPAPI CurrentUser仅保护密钥，不保护SQLite/日志目录。Node mode0600不能证明Windows ACL。备份与日志如需共享权限代码，可拟新增`apps/core/src/filesystem/owner-directory.ts`并由02/03/04复用：验证当前用户SID与目录ACL，权限未知或过宽则拒绝敏感落盘；可开发显式参数、Hidden子进程的Windows权限适配器，但本轮仅在本次创建的临时目录设置/验证ACL。真实Owner目录ACL不得修改；其权限状态只能标待核对，不能凭路径位于LOCALAPPDATA就视为Owner-only。生产脚本默认验证失败停止，不自动“修复”真实ACL。
- 保留匿名live/ready兼容launcher/E2E，只最小存活/数据库可读性；不泄露详细配置。拟新增Owner `GET /v1/health`：`appVersion`、`schemaVersion`与`checks`包含database/migration/backup/provider/scheduler/log枚举状态。无Owner401；ready失败保留503。不可读取/未配置/未观察到分别明确down/unconfigured/unknown或not_run，不把缺少观测判健康。
- health仅读取现有内存快照与只读SQL；备份状态来自最近已验证manifest摘要，不在请求中扫描备份正文/触发快照；provider只报告配置/最近已知结果，不ping外网、不DPAPI解密；scheduler读取现有状态，不创建/补跑job；数据库不写探针、不migration、不repair。返回无路径、secret、Owner正文或自由错误消息。版本来自实际APP_VERSION，schema来自实际迁移记录。

### 13.5 V9-05/06：两种验收状态，不冒充完整 PASS

- 本地实现：最小任务case、受影响typecheck/Web build及至多1本地浏览器主路径；用既有3217/4327隔离runner和合成Owner/LOCAL_RULES，保留真实失败码、精确选择器和诊断，不启用旧全矩阵。缺已装WebKit为NOT RUN、不安装；本地HTTP/Chromium或WebKit仿真不证明HTTPS证书、私网身份、物理Safari或Windows重启恢复。
- 物理部署：用户逐项授权后，按DEPLOYMENT记录私有身份认证HTTPS仅代理Web、Core loopback实际监听、真实任务自启动/异常停止/主机重启、物理iPhone Safari登录→Today→Proposal确认及刷新/断线恢复、真实数据备份恢复/侧车与DPAPI边界。没有设备/权限/证据记录NOT RUN及所缺项，不编造已安装Tailscale或设备版本。
- 实际版本源为`packages/contracts/src/reliability.ts`的APP_VERSION；仅实现收口同步workspace package/内部依赖/lock元数据至0.9.0，health/run/manifest引用同源，不新增平行version.ts。版本号不代表发布、原完整门禁或物理部署完成。
- 允许分别报告LOCAL_IMPLEMENTATION_PASS与PHYSICAL_DEPLOYMENT_NOT_RUN；后一项缺证据overall必须PARTIAL，不complete、不完整V9 PASS。旧全量自动矩阵本轮明确不执行也不标通过；完整MVP真实Provider等继承证据债仍保留，不能用本地规则或缩小检查替代。是否以后授权旧矩阵/发布由用户决定。

## 14. M1 项目工作目标与外发确认（历史批准，已撤销）

> 历史设计保留：2026-09-12 确认的新项目对话体验以 PRD 修订及第 15 节为准。本节的逐次 preflight、结构化 Brief 与 Action 确认不直接套用到新聊天链路；既有接口安全校验不因此删除。

保留项目Codex、生活/学习DeepSeek分工，不添加新的自由工具Agent。Owner输入有界工作目标；只读白名单快照与目标构成完整业务输入。原项目绝对路径、Shell、Git写入和任意文件读取权限不得交给模型。

外发前由Core准备预览，展示工作目标、文件相对路径、内容和体积。确认凭据绑定Owner、project ID、目标与快照内容，短时有效、有界存储、单次使用；发送前重新核对，目标或内容变化要求重新审阅。preflight不调用模型、不生成Action/Event。模型只输出结构化Brief，服务端校验格式和证据引用，业务建议仍经独立确认才转Action/TimeRequest。

保留LOCAL_RULES兼容和明确未配置状态。生产Codex适配器只有在无工具、无用户扩展隐式执行及上下文隔离能够证明后才接线；read-only sandbox不等于无工具。当前本机CLI的help/协议schema检查仅证明安装和部分参数存在，不证明模型运行安全。真实调用、认证资料、费用和网络另授权；进度及实际接口只见TASKS/API，不能把Fake通过写成真实Codex已接入。

## 15. 项目对话与每日分析（2026-09-12 历史草案，已撤销）

产品范围已确认；以下是待聚焦核对后冻结的实现设计，不是已存在的 API 或迁移。继续现有 TypeScript 模块化单体，不新建通用多 Agent 框架。真实认证、上游协议与操作系统隔离仍是独立启用门禁。

2026-09-12 后续授权：用户认可两项功能进入开发。实施按 TASKS 的小任务契约冻结接口，已有产品边界不重复提问；真实调用门禁不变。

### 15.1 模块与上下文

复用 projects 的本机目录授权、过滤快照和安全边界，agent 的消息持久化模式以及 memory 的 PROJECT 实体隔离。现有通用 AgentSession 没有 project ID，需增量建立 Owner/project/session 绑定并在每次访问校验，不能仅靠前端传参隔离。旧通用会话接口保持兼容。

新项目 conversation 服务接收消息、构造有界上下文、调用无工具 Provider Port 并保存结果；不调用会产生 Proposal 的旧 Brief 业务流程。Provider 只得到过滤快照值、必要来源标识、本项目进度摘要和有限近期消息，不获得文件系统、Shell、Git、任务/日程写接口。仓库文本与历史消息是数据，不得改变这些权限。最近消息数、快照总字节、摘要大小和输出上限在实现小契约中明确；超限截取需可见，不假装已读全仓。

### 15.2 进度与失败持久化

用户消息先本地持久化，模型失败不得抹掉用户的进度报告；记录待分析/失败状态，不伪造 assistant 成功消息。这与现有通用 appendMessagePair 成功后成对保存不同，应新增独立路径而非破坏旧契约。重复发送使用幂等标识，单项目并发写入串行化或版本校验。

项目进度派生记录引用来源消息和 revision，区分用户自述、文件证据、建议和待澄清推断。明确自述无需额外确认；冲突暂不覆盖确定事实，先澄清。模型不能自行确认工作完成。用户更正与已有删除语义必须影响后续上下文，不从摘要复活已删除内容。既有记忆压缩的确认/恢复流程不被全局取消。

迁移只追加。检查时 migrations.ts 最大版本为 26，编码前重新核对；不在设计阶段占用版本号，不重编号或清空旧数据。

### 15.3 定时分析与授权

现有 createDailyPlannerJobService 会生成 SCHEDULE Proposal，不能用于这条链路。复用启动/定时触发方式，新增独立项目分析 job；按 Owner/project/部署机本地日期/job kind 持久化幂等键。晨间结果作为有来源 run 的 assistant 分析记录写入项目会话，不伪造用户消息，不写任务与日程。

建议执行策略：07:00 触发；当天 07:00 后重启最多补跑一次，不重放历史日期；持久化运行状态防止重复领取，超时结果不明时不盲目自动重试。失败可见，后续人工重试仍关联同一日期任务并避免重复交付。此为技术策略草案，须在实施前核对现有启动生命周期。

默认未启用真实自动调用。用户在产品中一次明确授权项目上下文范围、账户与定时行为后，才允许后台按此范围调用，无需每天确认；撤销后停止新运行。发送前复核授权版本，范围变更不得沿用旧授权。暂停不能保证撤回已发出的请求，应明确提示。当前对产品功能的确认不是本轮使用凭据或付费模型的授权。

### 15.4 页面、观测与验证边界

项目页承载会话、当日建议、用户进度与发送/失败状态；Today 仅提供当日建议摘要入口。Provider 未配置时明确不可用；允许保留本地进度输入并说明尚未完成 AI 分析。Fake 仅用于隔离测试，规则结果必须显式标注。

复用脱敏日志，仅记录 request/run/session/project 标识、耗时、状态、Provider 模式，不记录正文或密钥。验证按小切片采用隔离合成数据：项目绑定成功与越权拒绝；进度报告→后续上下文且失败保留消息；一次定时分析与重复触发不重复；最终最多一条浏览器主路径。检查新链路任务/日程写入计数为零。真实 Codex、账户、OS 隔离和生产调度必须分别记录验证状态，不能由 Fake 通过代替。

## 16. 外部动作目录与 DeepSeek 详细训练计划

本节落实已认可的文字目录＋结构化检索方案，不直接使用仓库 setup.html 的生成式建站提示词或另建后端。来源为 https://github.com/hasaneyldrm/exercises-dataset ，文字许可证和媒体例外分别按 LICENSE / NOTICE.md 保留。上游固定 commit 与内容 hash；更新是显式导入，不在请求中拉取 GitHub。

### 16.1 数据适配

外部动作采用 sourceId＋revision＋upstreamId，保留名称、肌群、器械及中英文步骤。安全审核状态独立于上游原始字段；缺少 impact、禁忌、训练参数的信息标 UNKNOWN，不映射成内部 starter 的 LOW。旧 starter 目录及引用继续原样可读，不能把第三方数据伪装 FIRST_PARTY_INTERNAL。初始纯解析器先接收已加载文字 JSON，不执行网络/文件读写/SQL；媒体字段只忽略，不下载。

正式导入后索引按器械、肌群和文本检索，动作来源快照保持不可变，计划引用固定版本。未评估动作可浏览但不自动进入计划候选；一小批经过明确审核的动作用于第一条训练链路，不宣称全库适合所有人。

### 16.2 编排与详细计划

复用 fitness service、Workout revision、反馈与 Proposal 确认机制。现有 WORKOUT_TEXT_SELECTION_V1 仅选动作，详细计划使用独立版本化契约，保留 V1 兼容。输入为有限候选及经授权的目标/状态/近期反馈；输出必须引用输入候选，包含结构化训练参数与原因；校验引用、数字范围、总时长和当前安全限制后才保存草案。工具调用只暴露后端受限查询，不允许任意 SQL、文件或自由网页抓取。起步可由 Core 先查询候选再调用模型，不强制实现通用工具循环。

已有疼痛/急性风险阻断不降低；病史不完整不能推定可训练，医学相关判断不能仅以通用模型输出定案。DeepSeek 连接读取既有后端配置与凭据服务，不将密钥放到浏览器。外发声明增加实际发送的健身上下文范围，不能沿用旧仅动作选择声明冒充授权。测试注入 Fake，真实适配器未配置保留不可用。

### 16.3 切片与验收

先完成安全文字适配器，再接目录存储/检索与可选候选，然后升级计划/反馈上下文，最后接 DeepSeek adapter 和训练详情页。每个当前切片只做一条成功与关键拒绝检查，最终一次合成浏览器主路径。项目对话和健身通过各自 Provider Port 隔离，不共享原始健康记忆。新字段和迁移只追加，版本号不作为完成证明；实时进度及精确任务仅见 TASKS。
