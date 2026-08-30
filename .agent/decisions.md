# 架构与技术决策

## ADR-LT-001：按完整大版本执行 Sol / Terra 循环

### 问题

逐小任务反复规划和审查会消耗大量上下文，并让用户难以看到完整版本成果。

### 采用方案

每个 v0.x 大版本只进行一次 Sol 整版规划、一次 Terra 连续实现和一次 Sol 里程碑审查。Terra 内部仍使用任务契约、TDD、精确测试和原子提交。

### 未采用方案

每个细分任务都重新派发 Sol 规划和独立整版审查。

### 采用理由

符合用户明确要求，并把高成本推理集中到公共接口、跨模块边界和里程碑退出判断。

### 影响范围

v0.6 至 v0.9 的规划、实现、测试和审查流程。

### 是否可逆

可逆；若 Terra 对同一根因连续两轮失败，可临时升级 Sol。

## ADR-LT-002：外部 Provider 未授权时必须诚实阻断

### 问题

自动测试需要确定性 Provider，但生产界面不能把 Fake 输出描述为真实视觉、搜索或模型结果。

### 采用方案

Fake 仅在测试环境和显式测试开关下装配；生产能力未配置时返回明确 BLOCKED/NOT_CONFIGURED。真实外部调用、费用和凭据必须单独授权，证据与自动测试分开记录。

### 未采用方案

生产回退到样例回复、静态候选或测试 Fake。

### 采用理由

避免假成功、错误日程与用户数据误外发。

### 影响范围

Vision、公开搜索、DeepSeek、后续营养与项目 Provider。

### 是否可逆

原则不可逆；具体 Provider adapter 可替换。

## ADR-LT-003：v0.6 图片输入采用 bounded raw body

### 问题

当前 Base64 JSON 会放大请求体、在浏览器/BFF/Core 产生多份副本，并且现实现没有 MIME↔magic、像素和私有 artifact 边界。

### 采用方案

使用现有 Fastify 5 content-type parser 接受 `image/png`、`image/jpeg`、`image/webp` raw bytes，BFF 和 Core 各自执行 5,000,000-byte 上限；Core 用 Node built-ins 校验 magic/dimensions/hash 并写入非静态私有 artifact 目录。SQLite 只保存 Owner-scoped relative storage key 与元数据。

### 未采用方案

继续 Base64 JSON；无界 `arrayBuffer()`；本版引入 multipart 或图像 native 依赖。

### 采用理由

不新增依赖即可消除 Base64 放大并建立可测的双层字节边界。multipart 若以后确有必要，必须单独批准 manifest/安装。

### 影响范围

Web Core client/BFF、课表上传 UI、Fastify parser、artifact service、migration v19 和安全测试。

### 是否可逆

API 可在未来以兼容版本增加 multipart；已保存 artifact metadata 和文件不得破坏性迁移。

## ADR-LT-004：Vision/Search 使用中立能力，生产默认不装配

### 问题

没有获批的 Vision/Search 供应商或 Key，且不能推断 DeepSeek 支持图片或公共检索。

### 采用方案

冻结 `VisionCapability`、`PublicSearchCapability` 和文本专用 `LearningAdviceCapability`。生产 Vision/Search registry 为空并返回 `BLOCKED_PROVIDER`；DeepSeek 只允许文本学习建议。Fake 必须同时满足 `NODE_ENV=test`、显式 v0.6 flag 和 runner-owned 临时数据目录，并把证据标记为 `AUTOMATED_FAKE`。

### 未采用方案

把 DeepSeek 当视觉模型；生产回退样例；供应商专有类型进入领域；用 Fake 声称真实能力。

### 采用理由

保持诚实状态和可替换边界，同时允许无网络、无凭据的确定性工程验收。

### 影响范围

Provider Contracts/Core composition/settings、课表提取、公开检索、学习建议、E2E 和最终审查证据。

### 是否可逆

中立 Port 稳定；获批 adapter 可追加。真实外部调用始终需要新的执行授权。

## ADR-LT-005：课表导入使用双确认和 immutable revision lineage

### 问题

当前高置信 Vision 输出直接生成 Proposal，低置信候选不可编辑，也没有 Course↔Rule↔来源 lineage。

### 采用方案

所有 Vision 输出先成为带 field confidence/provenance 的 immutable revision。Owner 保存编辑/排除后的子 revision，再确认导入；该本地事务创建 Course、linked Rule 和 `EXPAND_CALENDAR_RULE` SCHEDULE Proposal。只有 Proposal 接受才生成 Events。

### 未采用方案

置信度阈值自动确认；覆盖原 revision；在 Vision 请求事务中写 Course/Event；一次点击直接进 Today。

### 采用理由

把模型置信度限定为审阅提示，并将事实确认和日程副作用分成可审计的两个闸门。

### 影响范围

course-import Contracts/Core/UI、calendar repository、Proposal applier、Today 和 migration v19 lineage。

### 是否可逆

流程原则不可逆；候选字段和具体视觉 adapter 可兼容扩展。

## ADR-LT-006：公开学习资料只持久化 citation metadata

### 问题

公开检索既有 SSRF/prompt-injection 风险，也不能把整页正文长期写入 SQLite。

### 采用方案

仅允许匿名 HTTPS 443；DNS 结果必须全为 public 并固定到请求 lookup；重定向逐跳重验；限制编码、内容类型、字节和时间。页面文本只在内存数据通道使用，SQLite citation 只保存 title/url/publisher/retrievedAt/contentHash/mediaType。生成学习建议前重新抓取并要求 hash 一致。

### 未采用方案

任意 fetch、浏览器 Cookie/Authorization、私网/学校登录、整页正文/HTML 持久化、执行页面指令。

### 采用理由

同时满足 citation 可追溯、SSRF 防护、prompt 数据隔离和最小本地保留。

### 影响范围

learning/search/fetch Contracts、Core service/repository、Course 详情、Proposal 与 adversarial tests。

### 是否可逆

允许内容类型或 Provider 可追加；匿名 HTTPS、逐跳校验和不保存整页正文为稳定边界。

## ADR-LT-007：工程 PASS 与真实外部证据分轨

### 问题

本版没有真实 Vision/Search/DeepSeek 调用授权，但确定性工程实现仍需可关闭里程碑。

### 采用方案

最终只做一次 Sol v0.6 审查。自动 Fake、真实 Provider 和未运行项分别记录；P0/P1 为零且工程门通过时可判工程 PASS，真实外部成功继续列为 `NOT RUN — APPROVAL REQUIRED` 证据债。v0.5 `P2-EVIDENCE-001` 原样保留。

### 未采用方案

把 Fake 写成真实成功；因缺少外部批准而否定全部确定性工程；借 v0.6 重构 v0.5 Daily Plan E2E。

### 采用理由

既不制造假能力，也不让外部审批阻断本地安全与业务闭环的工程验证。

### 影响范围

Terra 执行记录、v0.6 E2E、Sol review 和 v0.7 入口判断。

### 是否可逆

真实证据债可在获得授权后补充；不得回写历史 Fake 证据分类。

## ADR-LT-008：区分产品比较基线与 Terra 执行基线

### 问题

v0.6 计划以 v0.5 关版提交 `155b172` 作为产品差异基线，但计划和 `.agent` 状态随后形成了文档提交 `d5d4ea5`；若仍要求 Terra 的 HEAD 等于 `155b172`，会把合法计划提交误判为越界修改。

### 采用方案

最终版本 diff、迁移历史和 Sol 里程碑审查继续使用产品比较基线 `155b172`。`d5d4ea5` 是运行时代码基线；Terra V6-01 从包含它且其后仅有 `.agent` 控制面提交的最新干净 HEAD 开始，后续任务使用前一任务的原子提交。

### 未采用方案

回退或改写已冻结计划提交；把文档提交排除在分支历史之外；让 Terra 在脏工作树上绕过 HEAD 检查。

### 采用理由

既保留完整 v0.6 产品差异，也给执行 Agent 一个干净、可验证、可回滚的真实起点。

### 影响范围

V6-01 启动检查、Terra 交接记录和最终 BASE→TARGET 审查。控制面状态提交不会再通过自指固定哈希使前置条件失效。

### 是否可逆

可逆；若计划提交被重组，只需更新执行基线，不改变产品比较基线。

## V6-01 执行记录：raw artifact 边界已落地

### 决定

V6-01 用 Fastify raw Buffer parser、BFF bounded stream、Node 内建图片 header parser 和随机 private storage key 替换 Base64 JSON。Capability registry 只暴露 descriptor；没有注册 Vision adapter 时 import 持久化为 `BLOCKED_PROVIDER`，绝不调用 Provider。

### 保留约束

v19 仅追加表、索引、immutable trigger；artifact bytes 不进入 SQLite。Fake registry 继续要求 test 环境、显式开关和 resolved runner-owned data root 三重同时满足。V6-02 负责首次读取 artifact 并在事务外调用 Vision。
