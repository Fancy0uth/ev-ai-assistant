# 唯一进度与 V8 / V9 小契约

> 2026-09-08 V9增量规划承接V8限定本地验收。最新授权/小契约见下方V9节，历史V8过程与FAIL保留；技术栈继续Node24 + TypeScript + Next Web/BFF + Fastify Core + SQLite。V8规格为TECH_SPEC §12，V9规格为§13；任务编号分别保留01～05和01～06，不另建plan/todo进度。

## 当前进度

### 2026-09-18 连续完成健身闭环（最新授权）

用户要求“完成修复后直接去跑健身功能，直到完成健身闭环”。授权继续 R4 定点处理已证实的 V9 测试失败链，复核后执行已批准阶段提交/推送，再连续实施 FIT-02/03/04；不逐个小任务索要继续。旧2/2和R3记录不抹除。R4一次实现最多两轮局部修复，健身各任务沿用最小验证/两轮修复边界。

- R4：原 Terra Max Laplace 处理选择器歧义、页面切换预期取消和首错保留；不吞失败或放宽安全断言，同一隔离合成case。主并行核对健身增量技术契约，Astra medium做一次规划校准，随后按任务聚焦复核。
- 完成定义：可用动作候选 → 状态/目标与近期反馈 → 详细训练草案 → 用户确认形成Action/TimeRequest → 日程审核 → 完成/跳过反馈 → 下一次规划读取限量本地记忆；真实DeepSeek适配接线具备但本轮只Fake/合成验证，外部未审核动作不能伪装安全候选。未配置真实Provider保持不可用。
- 限制：不读/改日常数据库、不安装、不自动下载全库/媒体、不执行真实付费请求或使用用户健康数据，不恢复项目模块。提交授权仅本轮阶段保存，不自动main合并/tag/Release。只有本地闭环证据存在才标本地通过，真实模型/生产另列未验证。
- R4 已限定通过：同一 V9 case 初次FAIL，局部修复1/2后 1 passed / exit0；五次计数全部执行，确认前events0、确认后events1、providerCalls0。主核对最后日志及hash CFF7C61E176469A9A523ECBAE7CA260128BE1AF1EE95F4992FA5C316EA2B4D51；Astra medium Darwin 独立复核规格/质量通过。AbortSignal证据只对精确metadata端点、最多5次配对，非逐请求ID关联属于本case有界权衡。其余网络及安全断言保留。证据：[R4](evidence/2026-09-18-project-removal-r4.md)及同名diff；旧FAIL保留，REMOVE-03仅本地限定收尾完成，不等于全量或生产验收。
- 当前唯一下一步：按已授权范围提交推送阶段快照，再执行FIT-02；不等待新的小步骤确认。

### 2026-09-18 继续推进（当前入口）

用户“按照你说的顺序继续推进项目”：先收尾移除模块的测试遗漏与复核，再准备阶段保存，随后推进既定健身闭环。原两轮修复记录保留；本次额外授权 R3，仅补回 V9 E2E 的非项目 events/providerCalls 断言，不扩大业务改动。

- 当前契约：普通 WORK 输入下，协调后确认前 events=0，确认后 events=1，静态链路 providerCalls=0；保留原认证/CSRF/CSP/网络断言。允许写入单份 V9 E2E 与追加证据，原历史 FAIL 不改写。
- 检查：Terra Max Laplace 已补回五个只读合成数据库检查点。唯一命令 `node scripts/run-e2e.mjs v0.9-private-iphone.spec.ts` 实际 1 case，0 passed / 1 failed，exit1。首个失败是普通任务详情链接 locator 匹配两项，随后 finally 的两次本机 credential GET ERR_ABORTED 覆盖首错；只有 initial counts 执行通过，确认前后计数未执行。启动另见 EV_RUNTIME_LOGGER_DEGRADED。R3 一次额度已使用，停止修复/重跑；Astra medium Darwin 聚焦复核中。证据：[R3](evidence/2026-09-18-project-removal-r3.md)。主核对测试 hash 1D214367AFC519783F494EC825145F0E7602E09FB8F99261165C2BFD415A7426 一致。未触及日常数据库、真实 Provider 或 preview。
- 阶段保存：已只读核对 HEAD 50b5338、分支 codex/product-prd、origin Fancy0uth/ev-ai-assistant、身份 Codex <codex@local>。用户另明确“授权提交并推送该分支”，仅在限定复核及敏感检查完成后保存累计改动，不合并 main、不建 tag/Release。440份非忽略文本的密钥形状启发式扫描唯一命中是 provider-settings.test.tsx 的合成 fakeKey；不是全面安全认证。新增忽略 __pycache__/ 与 *.pyc，保留本机缓存但不纳入提交。
- 独立复核：Astra medium Darwin 已交回，确认断言在代码中补回但关键检查未执行，限定验收 FAIL；只读复核，不重跑。原2/2及额外R3计数保留。
- 唯一下一步：请求一次仅针对 V9 E2E 选择器歧义、页面切换请求取消及首错保留的定点处理授权，再运行同一 case；不放宽鉴权/数据库/Provider 安全断言、不扩大全站测试。阶段提交/推送授权已获，但约定的通过条件未满足，尚未 stage/commit/push。FIT-02 等仅准备契约，不以失败检查冒充收尾，不重启已退役项目分析。

FIT-02 后续契约准备（尚未开始编码）：

- 目标/依赖：消费 FIT-01 解析结果，提供固定来源版本的持久化、按器械/肌群/文本的有界检索，以及与来源事实分离的审核记录；FIT-03 只取明确审核过的候选。依据 TECH_SPEC §16.1，旧 starter 目录及引用不变。
- 允许范围：fitness 新目录仓储/服务及定点测试、必要共享契约、migrations.ts 末尾追加迁移；执行时重查最大版本，当前 27，不能覆盖原迁移。单个实现切片约五文件；页面/真实下载/训练 Provider 不混入此项。
- 不做：下载全库或媒体、把 UNREVIEWED 自动改为安全、让模型/普通 Owner 确认替代医疗判断、使用个人健康数据、修改旧训练记录。
- 可见验收：两份合成动作可落库并有界检索，重复相同来源版本幂等；相同版本不同内容拒绝且无部分落库。未审核记录可查阅但不能进入计划候选；审核决定带来源、范围与记录依据，不宣称适用所有人。
- 最小检查：隔离数据库一个组合成功/冲突场景，必要 Core 类型检查；一次实现最多两轮局部修复。当前证据无，未实现；前置收尾与阶段保存完成后再冻结具体接口并交由 Terra 实施。

### 2026-09-16 项目分析模块移除（当前唯一任务）

用户确认移除项目分析、项目对话、晨间项目分析和专属 Codex 接入；取消下方 PC/C1/C2 待办及代理网络问题，不继续登录或调用。保留普通工作待办、日程、课程、健身、饮食和记忆；不删除个人仓库、桌面 Codex、Docker 或历史数据库记录。

- [x] REMOVE-01：已删除 projects 页面/导航、Core 分析与本机授权入口、未接线会话、专属诊断源码；共享调用方解绑。原迁移、历史任务/事件/记忆兼容保留；旧 PROJECT ACCEPT 受控失败无写入，REJECT 保留。34 专属文件删除，28 文件修改，2 定点测试新增；具体清单和可恢复 delta 见本轮报告。唯一无源 .pyc 未清理，不是运行入口。
- [x] REMOVE-02：同步 README/AGENTS、PROJECT_BRIEF、PRD、MVP-SCOPE、TECH_SPEC、ARCHITECTURE、API、DATABASE、DEPLOYMENT、ROADMAP；历史审查与发布证据原样保留，旧项目设计标记退役。主完成文档，代码退役与最终响应仍待 REMOVE-01/03 核对。11份正文相对文件链接检查缺失0；限定 diff --check exit0，仅既有 LF/CRLF 提示。
- [ ] REMOVE-03（PARTIAL）：RED 后 GREEN，13 Core + 64 Web + 1 selected 通过；Core 类型、隔离 Web typegen/typecheck/build 通过，普通 Web 类型因原 .next 旧项目引用失败并保留记录。Astra medium Darwin 聚焦复核未发现 P0/P1，但 V9 E2E 漏保留非项目的 events/providerCalls 计数断言，P2 尚未补回；不称完整验收通过。未运行 E2E/真实 Provider。

允许范围：apps/core 的 projects/CLI、app 装配、proposals 直接调用链及相关测试；apps/web 的项目页/组件、共享导航/详情/链接、相关测试；packages 的项目专属契约及兼容调用点；scripts/codex-container 和三个 codex 诊断脚本；必要 package script。只删功能专属测试，共享测试保留非项目断言并增补退役覆盖。

验收：产品不再提供项目扫描/分析/对话/自动晨间分析，不再要求 Codex 认证；普通任务与历史日程仍可访问，DeepSeek 配置和其已有生活学习用途不变。测试仅独立合成目录/数据库；不接触现有 Owner 日常库，不安装、不提交/推送、不修改已编号迁移。Docker 镜像/容器和外部下载缓存留存，本轮不作主机资源清理。

执行预算：一次实现、两轮局部修复已用完（2/2）；Terra Max Laplace `01a0aa18-5424-7a92-a43b-496955563f5c` 实现已交回，Astra medium Darwin `01a0aa3d-dbd7-7030-acbd-4f13a6bb40e9` 复核已交回。主确认有效 P2 测试缺口，未在预算外修复。唯一下一步：请求一次仅补回 V9 E2E 共享事件/Provider计数断言的授权，再做定点检查和聚焦复核；不继续 C2 登录/代理排障，也不自动开始健身新功能。

最终证据：[本轮报告及独立复核](evidence/2026-09-16-project-removal.md)、[真实前后 delta](evidence/2026-09-16-project-removal.diff)。主核对 delta SHA256 `CEBFCA61D6179FC293AA3302FA2A35DB071B661D5E2277571ED5BA457E079CA6` 一致；迁移校验一致，隔离构建 manifest 无项目路由。未提交、推送、发布，未重启用户预览。原修复过程如下保留，最终状态以上文为准。

实施过程（未完成）：RED 已运行并复现入口尚存。首次 GREEN 有失败，进入合并局部修复 R1/2：按真实 schema 边界修正退役 agent 请求的 422 预期；恢复误删共享测试的非项目覆盖（memory-project 的普通记忆、V8 记忆/协调、V9 私有访问/日程链）。主已读取修改前副本确认这些文件并非项目专属，不能整份删除。其余迁移版本/每日计划断言失败待核验归因，不自动扩大修复、也不写全量 PASS。原迁移 SHA256 `8B70CD9BDC0E803A7776A71A1C6AF9B43009EBC1070839EE1783561D44B33C82`，删除代码后的再次核对一致。

### 2026-09-16 真实 Codex 适配器请求

**最新状态：C2 代码/R1限定复审通过，实际认证通道 PARTIAL，被当前DNS结果阻塞。** 主实际R1测试2/2 PASS、镜像构建exit0；Astra Planck确认原两项已解决、允许无凭据TLS探针，设备码登录必须等待运行门禁。真实探针exit1 `PROXY_CONNECT_REJECTED`，网关固定日志`DNS_REJECTED`；只读解析发现 auth.openai.com→198.18.0.79（非全局可路由地址）。仅测试容器指定DNS1.1.1.1后仍同结果，疑似本机代理Fake-IP，尚未确认软件或配置；未放宽IP检查、未修改系统/代理设置。

已停止本轮网关并inspect确认exited/Running=false；真实停止后探针exit0 `auth probe closed: PASS`，不再把残留socket误当存活网关。客户端inspect保持network none、socket卷只读；网关仅挂该卷，无认证卷/项目/宿主绑定/发布端口。真实TLS证书握手、真实非法目标403分支、官方设备码登录、凭据持久化仍NOT RUN（探针在DNS拒绝时提前终止）。没有创建认证卷或发起登录，模型调用仍0/1，未提交推送。R1/2已使用，R2未用；环境阻塞不通过改代码隐藏。

唯一下一步：用户确认当前代理软件及TUN/Fake-IP模式，再选择仅针对官方认证域名的安全DNS/代理适配；未经授权不改代理或系统全局配置。源代码与精确运行证据见 [C2](evidence/2026-09-16-codex-c2-auth.md)。以下为历史过程。

**当前 C2 开始：认证主机受控通道；C1 已限定通过。** 契约见 [C2](evidence/2026-09-16-codex-c2-auth.md)。CLI保留network none，以只读EV专属socket卷连接独立受信任网关，仅允许auth.openai.com:443；新EV认证卷，不复制旧凭据。先离线/无凭据网络边界检查及独立复核，再一次官方设备码登录。不是模型网关，不调用模型、不提前接入项目。初始实现、局部修复0/2；当前登录未启动，调用0/1。

C2 更新：初始五文件已构建，容器内Fake组合测试1/1 PASS，专属传输卷UID65532/0700及空镜像home验证通过。Astra Planck限定复核NO-GO：停止网关后的stale socket路径会令探针误判、绝对deadline与主动关闭未完全实现；均P2但违反当前冻结验收，先修正再登录。Terra开始R1/2，仅gateway/client/相关局部测试。真实TLS与登录尚未运行，认证卷未创建；调用仍0/1。初始RED仅缺模块错误，不声称有效行为RED。

**最新状态：Docker 已恢复可用；C1 R3 限定预检 PASS。** 第3次定点恢复后引擎两次查询 exit0、29.6.2。新镜像 `ev-codex-preflight:0.146.0-20260916-r3` 构建 exit0，官方包 SHA512 PASS；非root运行 Codex 0.146.0、stderr 为空，原临时 home 警告消失。容器 `ev-codex-c1-20260916-r3` 七项 probe PASS，inspect 确认无网络/宿主挂载、只读根、cap-drop ALL、禁提权及有界 tmpfs，exit0。修复文件 hash 与既有 Astra 静态复核一致，Python回归再执行 1/1 PASS。完整证据见 [C1 R3](evidence/2026-09-16-codex-c1-r3.md)。

唯一下一步：完成受控网络/网关与官方认证协议的限定预检，再让用户在 EV 专属存储完成官方登录；沿用已有授权，不重复申请。C1只证明二进制版本及所列隔离检查，不代表完整 Codex exec、真实模型或业务适配器完成。登录未开始、真实调用仍0/1、未提交/推送。Docker底层端点问题可能在重启后复发，三个改名目录保留；没有镜像/卷/容器数据删除。以下记录是历史，不代表当前阻塞。

2026-09-16 新授权：用户允许定点诊断/修复 Docker 自身启动问题，不恢复出厂、不删除镜像/容器/卷数据。主只读核实 Docker 已退出，`run` 是普通目录且仅含三个运行时 ReparsePoint 端点，`dockerInference` 查询报 Windows 1920；将明确验证的 `C:/Users/asus/AppData/Local/Docker/run` 改名为同级 `run.ev-recovery-20260916` 保留，创建新 run 并启动现有 Docker Desktop。此为 Docker 恢复第1次限定尝试，结果待核验；没有删除数据或更改设置。旧阻塞及修复历史保留。

**当前：R3 代码修复及限定静态复核完成，离线回归 1/1 PASS；C1 运行验证 BLOCKED，适配器未完成。** Docker Desktop 启动后自身 backend crashed（Inference manager 的 dockerInference 端点错误），不是 EV 镜像失败；未执行新镜像重建/版本警告复验/隔离 probe。不得复用旧镜像 PASS 宣称新代码运行通过。唯一下一步：恢复 Docker 引擎后对 R3 重建并完成同容器版本/隔离验证，再进入受控网络与官方登录准备；不恢复出厂、不删除 Docker 数据，涉及 Docker 全局修复需另授权。真实调用仍 0/1，无账号/日常数据库改动、无提交推送。

R3 Terra Max Turing `01a0a971-d11e-7ae3-9098-712c2f45c36d` 实现三文件；主实际执行 Python 合成回归 exit0、1/1 PASS。Astra medium Goodall `01a0a976-52f2-7850-83a3-801f24f076f7` 独立限定复核：精确成员匹配已解决，home 改动静态符合，无新 actionable finding；明确 runtime NOT RUN。证据见 [C1 R3](evidence/2026-09-16-codex-c1-r3.md)。以下为执行历史，不再代表当前下一步。

**最新授权：用户“批准。立即执行”批准 C1 一次额外限定收尾（R3）；不是重置原两轮计数。** Terra Max Turing 负责精确成员匹配、非临时专属 home 与一个合成回归；主执行重建/隔离检查，Astra medium 限定复核。仅改专属容器脚本及必要文档，不动账号/日常数据库；登录未开始，真实调用仍 0/1。以下 PARTIAL 与失败记录保留为历史，当前状态为 R3 执行中。

**C1当前PARTIAL：构建与隔离实测通过，限定复核仍有契约遗漏，2轮局部修复额度用尽，停止登录/推理。唯一下一步：用户批准一次受限收尾额度后，修正精确成员匹配并处理/验证Codex专属home路径警告；不以改任务名重置额度。** 无需重复申请已授予的容器/下载/一次模型调用权限；调用仍0/1。

- 最终第二次构建exit0，58.50s下载137138170bytes、SHA512 PASS，输出codex-cli0.146.0；镜像ev-codex-preflight:0.146.0-20260916，image ID sha256:c956891dc7eefd4d163c1d6b5a7c953e487b0a7e570200a2e0f629568e82c5ab。存在警告：Codex拒绝在临时目录/tmp下创建PATH aliases（codex_home=/tmp/ev-codex）。仅版本可执行，不代表完整exec资源/认证可用。
- 同一容器ev-codex-c1-20260916实际probe exit0，7项PASS：non_root、tmp_roundtrip、rootfs_write_rejected、host_paths_absent、egress_blocked、no_new_privs、cap_eff_zero。inspect确认User65532:65532、Mounts=[]、Binds=null、NetworkMode=none、ReadonlyRootfs=true、CapDrop=ALL、Privileged=false、SecurityOpt=no-new-privileges、tmpfs64MiB/noexec/nosuid/nodev、memory256MiB、pids64、1CPU、ExitCode0。容器已停止并保留用于追溯；未发布端口或创建认证卷/内部网络。
- 独立Astra medium Harvey 01a0a89d-c8d8-77d2-bc75-3047b215ac43：R1诊断/期限静态无阻断；R2仍用endswith而非==精确成员匹配。主核对代码属实，固定SHA512阻止任意更换包，尚无已证明校验绕过，但约定的精确匹配确实未落实，不能标限定复核PASS。原静态review不能代替此结果。两角色已关闭，无后台开发任务。
- 主限定文档diff检查exit0；未跑应用全仓测试、真实Provider或生产部署。官方包缓存、构建镜像和一个停止的EV检查容器保留，其他容器/项目未改。C1通过部分不解除受限网络网关/认证协议/模型输出边界等后续门禁；不宣布适配器已完成。

C1根因已定位：宿主机仅下载官方固定包至新EV缓存 `C:/Users/asus/AppData/Local/EvAiAssistant-codex-download-20260916-130545/codex-0.146.0-linux-x64.tgz`，137138170 bytes，SHA512与registry固定值匹配，命令exit0。tar只列目录，实际Codex成员为 `package/vendor/x86_64-unknown-linux-musl/bin/codex`，初始脚本假定的 `/codex/codex` 不存在。R1诊断已落盘但未重建；R2/2仅改为正确的精确成员匹配，保持来源/校验/大小/普通文件限制。缓存保留供追溯，不在仓库、不含用户数据。仍未登录/推理。

C1首次实际构建FAIL：RUN下载/校验步骤exit1，未输出Codex版本；原脚本捕获异常但未给出分类，根因尚未确认。主用相同基础镜像/非root/只读/禁提权执行固定npm包URL的HEAD请求，HTTP200、Content-Length缺失；只证明registry可连，不证明包下载/校验通过。局部修复R1/2仅加固定阶段/错误类别/下载完成字节证据及180s总体下载期限，不降低sha/来源/体积校验。未进入登录或模型调用。

C1执行记录：基础镜像在--network none/--read-only/UID65532/cap-drop ALL/no-new-privileges条件下运行python --version，exit0（3.11.15），容器自动移除。Terra Max Pasteur 01a0a88a-6976-7fc2-9437-fc689d74fe47交付四文件；Astra medium Jason 01a0a895-2321-7af3-86df-480098cd64f7独立静态复核PASS，未运行测试，已关闭。主开始 `docker --context desktop-linux build --pull=false --network=default --label ev.component=codex --tag ev-codex-preflight:0.146.0-20260916 scripts/codex-container`，构建上下文8.82kB，复用基础镜像，当前下载/校验步骤执行中，尚无构建成功结论。运行时flags仍须与同一probe容器inspect核对；不能只凭单个socket失败宣称完整隔离。

用户最新“允许”：批准EV专用隔离容器/内部网络、官方Linux Codex及必要基础依赖下载，权限不再是此预检阻断。开始容器预检C1：Terra Max只写scripts/codex-container四个新构建/合成检查文件；主执行构建和无网络容器检查，独立Astra复核，最多2局部修复。不改业务Adapter，不挂载宿主数据，不启动登录/模型。基镜像复用已安装python:3.11-slim的digest；Codex锁0.146.0-linux-x64并校验npm registry提供的SHA512。每次build上下文仅该专属脚本目录，不送整个仓库或.env。

C1验收仅证明Linux二进制可执行与无网络/非root/只读rootfs/no-new-privileges/cap-drop条件下合成检查；后续受限网络、认证及真实网关仍须各自验证。真实调用计数0/1。当前唯一下一步完成C1，之后在已授权范围继续网关/登录准备，不重复要求用户批准相同动作。

Docker启动后核对：用户已打开Docker Desktop；本地命名管道端点不变，Server 29.6.2、linux/x86_64、image ls exit0。已有python:3.11-slim等基础镜像；不复用其他个人项目镜像/数据。已安装Codex npm目录只有codex-win32-x64，没有Linux执行包，不能直接放入Linux容器运行。当前未创建容器/网络、未拉镜像/安装包、未登录、真实调用仍0/1。此前“引擎未运行”阻断已解除。

当前唯一下一步：请求新增且一次说明完整的权限——基于已有公开基础镜像构建/运行EV专用隔离容器及内部网络，下载官方Linux Codex包及构建所需基础依赖，仅写EV专属目录/镜像；不改宿主Codex/全局设置、不挂载个人项目/日常库/桌面凭据、不动其他容器。获准后先做合成文件/网络边界验证，安全通过才进入已授权官方登录与最多1次合成调用。下载/构建成功不是隔离或上游协议通过。

最新授权：用户“是”批准EV专属配置/认证目录、本人官方登录、隔离通过后最多1次合成文本真实调用（订阅额度）；不含真实项目/健康数据、API-key费用、安装、全局配置或防火墙修改。授权已记录，不重复索要同一授权。真实调用计数0/1，登录尚未开始。

授权后只读预检：codex.exe --version为0.146.0；sandbox --help具备restricted-token/profile参数，但help不构成运行隔离证明。系统Windows11家庭版中文、26200，未找到WindowsSandbox.exe；WSL只列docker-desktop，Docker context为desktop-linux，端点npipe:////./pipe/dockerDesktopLinuxEngine。docker version及image ls均exit1，管道不存在（引擎未运行），不能据此声称没有镜像。未启动Docker、未拉镜像、未运行容器、未改系统/账号/防火墙。

官方[Permissions](https://learn.chatgpt.com/docs/permissions)说明profile网络策略不约束Codex模型/认证服务流量，Windows unelevated隔离也不支持全部边界；不能用只读CLI代替原批准的整体隔离。此时停止真实登录/推理，不浪费一次调用额度。唯一下一步：用户启动现有Docker Desktop引擎后，继续只读核验镜像/可隔离运行环境；运行容器或下载缺失依赖前须说明具体范围，不默认批准整项目Docker化。不改变既有Gateway协议未验证状态。

用户要求完成适配器。已复用PC-01/02和M1-B离线证据，确认当前没有生产Codex适配器；不能把后续Fake Port当作用户所需真实接通。官方Auth/App Server文档支持ChatGPT登录与托管浏览器登录，但没有因此证明本机已装版本、受限网关认证协议及OS隔离通过。当前尚未启动真实登录、读取已有认证或调用模型。

需要用户单独授权的下一步：创建EV专属Codex认证/运行目录，由用户完成官方ChatGPT登录；先验证既定隔离，再最多一次合成文本真实请求验证认证及响应，可能占用订阅额度。不得复制桌面auth、上传用户项目/健康数据、自动改用付费API Key、改全局配置/防火墙或安装软件。隔离无法落实则停止真实调用并说明缺口。此前真实调用/系统权限门禁保留；此项待授权不等于整个开发只能停止，也不宣称适配器完成。

参考：[官方认证](https://learn.chatgpt.com/docs/auth)、[App Server 登录](https://learn.chatgpt.com/docs/app-server)。本次只读核对与状态收口，未改业务代码、未跑模型/应用测试。

### 2026-09-16 用户验收修复：Provider 状态误报

用户授权自行定位并修复“DeepSeek测试成功但页面未连接、项目不可调用”。已确认两个不同原因：app-shell右栏硬编码未连接；项目及通用聊天启动未注入真实Provider，DeepSeek凭据目前仅被每日计划/课程文本建议消费。前者本轮修复，后者是PC-03以后尚未完成的接线，不将项目擅自切换到DeepSeek，不以文案成功冒充可调用。

- 当前任务：修正shell状态读取及设置变更刷新；关联已批准Provider配置与真实状态要求。只读本地凭据元数据，不读密钥、不发起连接测试、不动数据库/原有账号。
- 范围：app-shell、新provider-status组件、设置页无敏感数据刷新事件、两份定点Web测试（允许最多五文件）；主维护本节。保留导航/登出，区分加载、未配置、已配置未测试、最近测试成功/失败、读取失败；历史成功不等于实时连接。
- 可见验收：设置变更后右栏同步，提供设置/每日计划入口；明确项目Codex与通用聊天尚未接线。身份失效和请求失败不得继续展示旧成功；状态读取仅GET，不自动模型调用。
- 检查：真实组件、合成HTTP响应的组合case先RED后GREEN；现有shell受影响测试及Web typecheck，不全仓回归。一次实现最多2轮局部修复。
- 实施：Terra Max Kant 01a0a862-1284-7ef0-a97c-8b2484389b5a；当前状态误报修复DONE（限定验证），项目调用仍未接通。精确命令 `npm test --workspace @ev/web -- tests/app-shell.test.tsx tests/provider-status.test.tsx`：RED exit1、4/15失败，GREEN exit0、15/15通过；`npm run typecheck --workspace @ev/web` exit0。主复用实施者结果并比对五文件SHA256全部一致，没有运行真实API。限定git diff --check exit0，仅LF→CRLF提示。现有本地预览设置页HTTP200，但未登录读取用户凭据或执行真实模型/浏览器闭环。
- 独立复核：Astra medium Lovelace 01a0a86b-b410-7813-b520-84d7a726399d，限定PASS，无新增需修复问题。成功→事件刷新→失败清旧有运行证据；竞态、focus/path、401等只有静态检查，不宣称所有分支运行覆盖。两角色已关闭，无后台开发任务。唯一下一步回到PC-03无工具项目对话Provider与运行状态接线，真实Codex授权/隔离门禁未解除。
- 最终hash（依次app-shell/provider-status/设置页/shell测试/status测试）：D731CA440D987A447AB3D1891D94D15798ABCFBC5320513C43FBC1E2F0900F1C；BE43DBF686AF944F8004D69F4BA65A58C58A57270E0362604406803B0E4D7DB0；67F7BCBF1F9F92AA38C19329F4E0C89A60CAA7C54D9DB0E9DC60C78EED744DDB；5925C77CF20E019BD8BD9AA232E22DBD74D408A96AC24716E7ABAD7EC8C0708B；6DC849518C41512D8EB957E07826F572F06E969159C5026A2A2FE878FDF8AE10。未提交/推送，未更换预览数据目录。

### 2026-09-16 续开发

**最新状态：PC-01、PC-02 DONE（限定本地验证/复核），FIT-01此前已通过；两个用户功能整体仍未完成。唯一下一步：冻结并实现PC-03无工具对话Provider、回复及运行状态的小契约；不启用真实Codex、不提前创建定时任务。** PC-01 R1 后1case PASS、Core typecheck exit0；Astra medium Russell `01a0a827-e4f6-7e41-8ff1-75613a23d2c5` 限定复核两项均已解决、无新增问题。主已实际比对仓储/测试/迁移 SHA256 与最终报告一致，复核条件满足；修复1/2。原实施和复核角色均已关闭。证据：[实施及R1](evidence/2026-09-16-pc01.md)、[初版diff](evidence/2026-09-16-pc01-review.diff)、[R1diff](evidence/2026-09-16-pc01-r1.diff)。下面初版FAIL过程原样保留，不是现行阻断。

PC-02 实施者：Terra Max Halley `01a0a829-75ed-7a03-a873-efc8c850a755`，新增三份代码/测试；主写报告。实际行为RED后GREEN 1/1，Core typecheck初次TS2322，局部修复1/2后两项均通过，主核对最终三hash一致。Astra medium Chandrasekhar `01a0a836-0081-7981-b47f-3480d369ab9d` 独立规格/质量复核PASS，无需R2；两角色均已关闭，无后台开发任务。证据：[实施/检查/复核](evidence/2026-09-16-pc02.md)、[三文件diff](evidence/2026-09-16-pc02-review.diff)。51条窗口、记忆超限和文件总预算分支仅静态核对，不冒充实际覆盖。未注册HTTP接口、不接真实Provider、未做浏览器验证，页面尚无此次新入口。

已核对 linked worktree `codex/product-prd`、HEAD `50b533804be24f8963492679127f72e39ff4f7dd`；全部原有 dirty 保留，现有最大迁移26，FIT-01成果仍在。沿用原模型分工和最小测试预算，不安装、不调用真实API、不启动使用日常数据的服务、不commit/push。

以下为 PC-01 历史过程，不是当前待办；现行状态以本节首段为准。

PC-01 开始时记录（已结束）：Terra Max Godel `01a0a817-6108-7351-af8b-df0e2e3e48be` 实施下方已核对契约；本轮报告改用 `plans/evidence/2026-09-16-pc01.md`。初始实现1次额度，修复0/2，当时尚无测试或代码复核结论。下方9月12日的“下一步/NOT STARTED”同样是历史记录。

PC-01 初版检查：实际定点case 1/1 PASS，但主执行 `npm run typecheck --workspace @ev/core` exit1（tsc2），新增仓储104～106行对unknown分页参数使用 Number.isInteger/isSafeInteger 后未先做typeof number收窄，出现TS18046/TS18047/TS2365/TS2322。尚未标PASS，Astra medium Aristotle `01a0a822-777d-76a3-a44e-9d57f360fb79` 正结合此证据做限定复核。主比较修改前dirty迁移全文与当前文件，确认仅追加46行、原行删除0；已有迁移未改写。

PC-01 R1：独立复核确认分页编译错误（P1）及UUID校验只接受v1～5、拒绝合法v7的契约缺口（P2）。主已核对代码与契约，均为本切片缺陷，交原Terra合并局部修复1/2；仅仓储/同一测试/证据，迁移不改。修复须证明v7用例先失败再通过，重新运行精确定点case及Core typecheck；初版失败保留，不以新任务编号重置预算。原复核角色已关闭，修复后另做限定复核。

预检记录：PC-01仅新增仓储/测试并追加迁移，FIT-01不共享文件；PC-02消费PC-01消息读取接口，不写仓储、旧记忆或原始项目；PC-03以后才负责模型运行及回复保存，PC-01的通过不代表它们已实现。技能默认的全仓检查、自动提交与独立进度账本由用户明确的小检查/不提交/TASKS唯一入口要求替代。

#### PC-02 有界项目上下文与进度报告契约

- 目标：复用 PC-01 用户消息持久化、现有授权快照和当前 PROJECT 实体记忆，构造供后续无工具 Provider 使用的上下文；用户消息是自述，不自动判定项目完成。
- 允许文件：新增 `apps/core/src/modules/projects/conversation-context.ts`、`apps/core/src/modules/projects/conversation-service.ts`、`apps/core/tests/project-conversation-context.test.ts`；报告 `plans/evidence/2026-09-16-pc02.md`。不新增迁移、不改旧项目/记忆/Agent接口、不接Web或外部模型。
- 接口：`createProjectConversationService({conversations, scopes, memory})`；依赖分别取 PC-01 仓储的 appendUserMessage/listMessages、现有 scope service 的 snapshot(ownerId,projectId)、EntityMemoryService.read(ownerId,{scopeType:'PROJECT',scopeId:projectId})。提供 `recordProgress(ownerId,projectId,{clientMessageId,content})`（直接持久化原自述并返回 PC-01结果）与 `buildContext(ownerId,projectId)`（只读，不隐式建会话）。调用顺序先通过 conversations.listMessages(limit:51) 校验Owner，再读取该项目快照/当前实体记忆；不可接受调用方任意路径。
- 输出 `ProjectConversationContext`：schemaVersion='PROJECT_CONVERSATION_CONTEXT_V1'；`userReports`（messageId、sequence、content、source='USER_REPORTED'）；`memory`（null或content/version/source='CURRENT_PROJECT_MEMORY'）；`files`（relativePath/content/contentHash/source='PROJECT_FILE'）；`omissions`（olderMessages:boolean，messageIds:string[]，files:{relativePath,reason}[]，memory:boolean）。输入root、ownerId、凭据、跨域记忆或回调/工具不得出现在输出；原始文本仅作数据，没有执行权。
- 有界策略：最近50条完整用户消息，总content UTF-8最多32000bytes，从最新往前纳入连续后缀，遇不够预算即停止，不保留旧消息而丢较新的更正；输出按sequence升序。获取51条用于olderMessages标识，预算跳过也标olderMessages=true并列可见范围内省略ID。当前记忆最多16000bytes，超限整份省略（memory=true），不截断后伪装全文。文件依照snapshot顺序、每文件最多16000bytes、合计64000bytes，超限整文件跳过并标CONTEXT_FILE_LIMIT/CONTEXT_TOTAL_LIMIT；已有snapshot.skipped原因原样保留。保留完整原文hash，不以部分文本配全文件hash。本切片不生成摘要、不写记忆revision；已删除当前记忆为null，不读取历史恢复。
- 验证：一条组合用例使用内存SQLite真实PC-01仓储、合成项目及受控快照/记忆读取边界。两次报告（含一次更正）进上下文，中文多字节文件按字节省略，snapshot root和附加字段不外传，当前记忆删除后上下文为null；报告后模拟snapshot读取失败，消息仍存在；错误Owner在读取快照/记忆前404。少量边界fixture验证连续消息后缀与省略信息，不运行大矩阵。Fake只用于代替文件/投影I/O，不用mock替代仓储断言。
- 命令：`npm test --workspace @ev/core -- tests/project-conversation-context.test.ts`，命中1case，先RED实际行为断言后GREEN。约定数字是上下文体积上限，不是医学或产品效果承诺。一次实现、最多2轮修复，当前NOT STARTED/0。不把本切片标为自动长期进度摘要已完成；它提供保留自述和现有记忆的可追溯输入，摘要与对话输出仍依赖后续Provider。

### 两项功能进入增量开发（2026-09-12 最新授权）

用户认可文字动作库＋DeepSeek 详细计划，并要求与项目对话/07:00 分析一并进入开发。PRD 顶部两个修订是范围权威，TECH_SPEC §15/16 为技术边界。保留 Terra Max 实现 / Astra medium 聚焦复核；无真实 API、凭据、用户数据、安装、提交、发布授权。已核对现有 linked worktree codex/product-prd，保留所有 dirty。按用户规定不执行技能默认全仓测试或自动 commit，不另建平行进度账本。

**当前：FIT-01 实现及限定复核通过；两个用户功能整体均未完成。唯一下一步：按已核对的 PC-01 契约实现项目会话基础。** 后续顺序为 PC-02/03 → FIT-02/03 → PC-04/05 → FIT-04。真实 Provider 验证另有门禁，不能把本地完成写成真实链路完成。

FIT-01 最新结果：Terra Max Lagrange 完成两份新增代码/测试；最终精确命令 `npm test --workspace @ev/core -- tests/external-exercise-catalog.test.ts` exit0，1case/1PASS，无警告；主核验最终文件hash与报告一致。原始GREEN后发现上游字段映射错误，修正fixture先RED再改解析器GREEN，计局部修复1/2，不抹掉这次错误。主运行 `npm run typecheck --workspace @ev/core` exit0。Astra medium Mill `01a09437-fd67-7561-8b90-ae7779f38465` 依据新文件diff和报告完成独立规格/质量复核，无本切片问题，未重跑测试。证据 [实施报告](evidence/2026-09-12-fit01.md)、[复核diff](evidence/2026-09-12-fit01-review.diff)。两个角色已关闭，无后台开发任务。当前只是可调用纯函数，尚无真实动作库落库、页面接入、训练计划生成、真实模型或生产部署；未commit/push。以下任务契约里的“尚未运行/执行中”是实施前记录，以上结果优先。

健身切片：FIT-01 纯文字适配；FIT-02 版本化目录存储/检索/审核候选；FIT-03 详细训练草案与反馈上下文；FIT-04 DeepSeek 适配接线与详情页。FIT-02 消费 FIT-01 的不可变来源记录，FIT-03 仅消费审核后的候选，FIT-04 消费已校验计划；旧8动作接口继续兼容。项目切片 PC-01～05 见下方，不将 Fake 接口冒充真实 Codex 接线。

#### FIT-01 当前任务契约

- 目标/关联：TECH_SPEC §16.1。实现纯函数读取已加载的外部 JSON，获得不含媒体且不伪造安全信息的标准文字目录；为 FIT-02 提供稳定输入。
- 允许修改：新增 `apps/core/src/modules/fitness/external-catalog.ts`、`apps/core/tests/external-exercise-catalog.test.ts`；实施报告 `plans/evidence/2026-09-12-fit01.md`。不改已有 shared contracts/catalog/service，不接生产入口、不导入真实库、不联网下载媒体。
- 接口：导出 `parseExternalExerciseCatalog(input: { records: unknown; revision: string }): ExternalExerciseCatalog`。输出包含固定 sourceId `hasaneyldrm/exercises-dataset`、revision（40位十六进制 Git commit）、license `MIT`、items；每项 `upstreamId`、`name`、`bodyPart`、`equipment`、`target`、`secondaryMuscles`、`instructions: {en: string[], zh: string[]}`、`safetyReview: 'UNREVIEWED'`。没有媒体字段、没有默认组数/强度、没有 FIRST_PARTY_INTERNAL 或 LOW。不修改输入对象。
- 输入界限：1～2000条、整体 JSON UTF-8不超过32MiB；唯一四位数字字符串id；名称及分类字段非空且至多240字符；secondaryMuscles最多32项各120字符；中英文步骤各1～40项、每项最多2000字符，总步骤文本每动作最多24000字符。优先 instruction_steps 的 en/zh；该语言 steps 缺失才将该语言 instructions 非空文本作为单项（仍受限）。显式无效步骤不能静默回退。未知字段忽略但不执行，媒体不返回；有效根必须JSON兼容。任何无效条目或重复ID整批拒绝，稳定错误 `EXTERNAL_EXERCISE_CATALOG_INVALID`，不回显原始内容。
- 来源字段澄清：输入是上游原始 snake_case（`body_part`、`secondary_muscles`），输出才是 `bodyPart`、`secondaryMuscles`；fixture同样使用上游字段。主在实施中发现初稿使用camel输入，已通知修正；不能以自造camel fixture通过代替上游可接入性。
- 最小检查：一条顺序case使用两条合成记录验证中文/英文字段、缺steps的回退、来源、UNREVIEWED、不含媒体且输入不变；再以重复ID和损坏步骤验证受控拒绝。不得抄取完整上游数据冒充合成样本。
- RED/GREEN：先实现导出占位并令成功解析断言失败（纯 import 错误不算断言 RED），再实现解析。命令已按 @ev/core 实际脚本核对：`npm test --workspace @ev/core -- tests/external-exercise-catalog.test.ts`；必须命中1条case，零用例不计PASS。实现一次、最多两轮局部修复；当前0轮；报告保留命令/退出码/实际断言/警告及最终文件hash。
- 证据与下一步：尚未运行，适配器通过也不代表完整动作库导入、医学审核或健身 UI 完成。复核依据新文件 diff，不用既有 HEAD 的全仓 diff。

主 Agent 上游只读核验（2026-09-12）：通过 GitHub API 解析 main 为 `7455efae41b330c265e7cd4b78dfa848e7ce5ebd`，读取该 commit 的 data/exercises.json，在内存解析：1324条、UTF-8 17391530 bytes、重复id 0、缺中文steps 0；PowerShell命令exit0。未下载图片/GIF、未持久导入数据库；计数不是动作医学审核或全字段质量PASS。FIT-01 实施者 Terra Max Lagrange `01a0942f-0a89-70c3-8eb1-17a4a01c77a4`，当前执行中，未宣称测试结果。

#### PC-01 项目绑定会话基础契约

- 目标：第15节的本地会话绑定及用户消息先落库，为后续对话Provider提供基础；本切片不暴露Web接口或调用模型。
- 允许文件：`apps/core/src/storage/migrations.ts`只追加27（开始前核对）；新增 `apps/core/src/modules/projects/conversation-repository.ts`、`apps/core/tests/project-conversation-repository.test.ts`，报告 `plans/evidence/2026-09-12-pc01.md`。不修改通用agent表/契约，不改已有迁移。
- 接口：`createProjectConversationRepository(database)` 返回 `getOrCreate(ownerId, projectId)`、`appendUserMessage(ownerId, projectId, {clientMessageId, content})`、`listMessages(ownerId, projectId, {limit, beforeSequence?})`。返回会话含id/projectId/createdAt；消息含id/sessionId/sequence/content/role='USER'/createdAt。追加返回 `{message, replayed}`；一个Owner/project恰好一个会话。同clientMessageId同内容返回原消息，不同内容409 `PROJECT_MESSAGE_CONFLICT`。
- 迁移：新增 project_conversations（owner_id/project_id 唯一）及 project_conversation_messages（session_id/client_message_id 唯一、全局整型递增sequence主键、message id唯一）。会话与已授权project_scopes绑定，每个操作校验scope归属Owner，不允许任意路径参数。Owner/project/session关系由事务和适当约束保证，不降级外键。非本人/不存在scope统一404 `PROJECT_SCOPE_NOT_FOUND`。正文trim后1～8000字符；clientMessageId UUID；limit整数1～100、beforeSequence正整数可选，非法输入400受控失败。
- 消息列表：按sequence取游标前最近limit条，返回时间顺序升序，不能依赖UUID排序判断先后。列表读取不自动创建会话。追加单独提交用户消息，无Provider/assistant伪回复，无Task/Action/TimeRequest/Proposal/Event写入。
- 最小测试：一条顺序用例，内存SQLite先迁移到26，放入合成Owner、两个project scopes及一条原有Task，再升级27；验证旧Task/Owner保留、同项目重复获取同会话、用户消息先保存且按顺序读取、同clientMessageId重放不重复/改内容冲突、另一项目无串话、错误Owner读写404且计数不变。仅当前26→27路径，不跑历史迁移矩阵。
- 命令：`npm test --workspace @ev/core -- tests/project-conversation-repository.test.ts`，确实命中1case；先RED断言（不是模块找不到）后GREEN；新增迁移仅在隔离内存库运行，不启动使用日常数据的服务。一次实现/最多2轮修正。当前NOT STARTED、修复0。

PC-01 契约独立核对：Astra medium Faraday `01a09433-64d0-71d2-a272-898d8e6ec616` 已只读核对现有 owners/project_scopes 与 migration26/迁移器及第15节，结论无阻断设计问题。未运行测试、未审查尚未实现代码；不算实现PASS。审查角色已关闭，后续代码需独立复核。

后续小任务在依赖输出确认后冻结精确字段和文件范围，不将上述顺序声明为已经验证可运行的完整实现。

### 最新优先级：项目对话与每日分析（2026-09-12）

用户已确认：每天本地 07:00 给出项目工作建议，通过项目专属对话报告进度；明确进度不再逐句额外确认，新链路不写项目/Git，不创建任务、Action、TimeRequest、Proposal 或 Event。产品权威正文为 PRD 顶部修订；技术草案为 TECH_SPEC 第 15 节。旧功能和历史证据保留。

**状态：产品范围已确认；技术草案已记录，尚未冻结/实现新链路。** 本次只读核对现有 agent 会话/消息契约、projects 分析 Port、PROJECT 记忆和 daily planner：通用会话没有项目绑定；旧分析为一次性 Brief；现有日程 job 会生成 Proposal，不能直接用于晨间项目建议。迁移最大版本检查为 26，后续编码需复核。旧 M1-A Fake PASS 不覆盖新需求，M1-B 真实接线阻断不因此解除。

**唯一下一步：对 TECH_SPEC 第 15 节做一次聚焦技术核对，冻结项目会话数据/Provider 契约及首个实现小任务。** 不重复询问已经确认的产品范围；保留 Terra 实现、独立聚焦复核分工，未实际委派不得声称完成复核。真实账户/网络/费用及隔离门禁另行处理，不以此阻塞可安全完成的本地 Fake 基础建设。

后续实施顺序（尚非已执行任务）：

| 切片 | 目标与依赖 | 允许范围 / 不做 | 最小可见检查 |
| --- | --- | --- | --- |
| PC-01 | 项目绑定会话与持久消息；依赖契约冻结 | 共享契约、agent/projects 持久化及追加迁移；不接真实模型、不改旧会话语义 | 合成项目会话可读写；跨 Owner/项目拒绝 |
| PC-02 | 对话进度与有界上下文；依赖 PC-01 | 项目 conversation、实体记忆来源；不自动确认推测、不调用任务写接口 | 用户报告进入后续上下文；失败保留报告 |
| PC-03 | 无工具对话 Provider 适配边界；依赖 PC-02 | Port 与 Fake 契约验证；真实 Codex 仍受独立门禁 | 成功文本与未配置/失败状态准确，无伪造回复 |
| PC-04 | 07:00 项目分析 job；依赖 PC-03 | 独立持久运行状态与授权检查；不复用排程 Proposal 服务 | 一次分析入会话；重复触发不重复交付、不写日程 |
| PC-05 | 项目对话页与 Today 入口；依赖前四项 | 复用响应式组件，不重设计整站 | 最多一条隔离浏览器闭环，真实/Fake 状态明确 |

每项开工前补齐精确文件范围（约五个文件，必要时按契约再拆）、检查选择器、验收与修复计数；默认一次实现、最多两轮局部修复，超预算升级。当前五项均 NOT STARTED，修复次数均 0。此次仅更新文档，不运行应用测试、真实模型、登录、数据库迁移或发布；文档检查不代表功能验收。

以下 M1 状态与设计是历史承接材料；其中旧“唯一下一步”和仅手动/逐次确认方案已由上方最新优先级替代，证据及未解决安全门禁仍有效。

### MVP 真实链路收口（承接用户“按照你的建议继续工作”）

**最新状态：M1-A 本地限定PASS；M1整体PARTIAL，M1-B生产Codex适配器BLOCKED。** 已实现工作需求、外发预览/单次确认、输入变化中止、引用校验与页面，使用Fake验证。真实适配器未配置时预览/发送不可用并明确提示，静态模式可继续使用；不是用户已经能调用Codex的声明。

**唯一下一步：用户确认正式适配器短设计方向，然后冻结技术增量与实施小契约。** 2026-09-12已只读核对分支codex/product-prd、HEAD50b5338、既有dirty保留；已装包仍0.146.0，app.ts仍仅可选注入projectAnalysisProvider，未因此宣布真实接线完成。本轮只准备设计、不运行模型/测试/登录，不读取凭据，不修改业务代码或发布。

2026-09-12设计核对：官方[认证](https://learn.chatgpt.com/docs/auth)明确custom provider的requires_openai_auth支持Codex托管的ChatGPT或API-key认证，适用于模型代理；[App Server](https://learn.chatgpt.com/docs/app-server)提供托管登录/状态接口及stdio控制。以上是官方能力说明，不是本机自定义网关与订阅上游已兼容的证据。建议EV专属Codex配置/凭据目录，经用户官方登录，不复制桌面现有auth文件；推理保留已验证exec生命周期并接独立受限网关。若网关转发认证头，它属于受信任秘密处理组件，只允许进程内短暂处理，禁止持久化/日志/前端透传，且真实启用须另授权。不能同时声称“网关完全不接触凭据”。上游地址、所需头、真实模型协议须按支持契约验证，不能猜测私有路由或把ChatGPT token当通用API key。

候选隔离要求：独立工作目录不等于OS隔离；生产启动须验证文件读取范围仅必要运行文件/EV专属认证区/当次文本、禁止个人项目与EV业务库直接读取，并验证模型出站只能经网关，登录/刷新通道独立受限。Windows具体执行机制与受控拒绝证据是启用门禁，不以只读sandbox、环境变量或提示词代替。网关按批准快照重建输入，完整缓冲并校验真实响应后只返结构化Brief；真实推理项处理规则需明确，不能盲目沿用Fake的单message限制。保留现有两次确认、引用校验、单次令牌、未配置503；初期只允许Owner手动调用、单并发、超时与有界输出，无自动重试/日程写入。备选独立OpenAI API方案需要用户另选及费用授权，不自动切换。本次尚未批准正式设计/写实现，历史spike证据不扩大。

#### 网关离线验证结果（2026-09-08，协议限定PASS）

- 实施次数：本轮一次实现、局部修复0次；最初测试因新模块尚未存在而解析失败，测试体未执行，不计为有效断言RED。后续组合用例GREEN是实际证据，不宣称完整RED/GREEN回归证明；上一轮2次修正历史保留。
- Terra Max McClintock实现三文件：`scripts/diagnostics/codex-offline-probe.mjs`新增显式`--gateway`；`codex-gateway-boundary.mjs`为不做I/O的Pure Fake边界；`codex-gateway-boundary.test.mjs`为一个组合用例。Astra medium Beauvoir执行前只读核对三文件，允许一次受看护诊断；结束后仅复核三份结果证据，确认协议限定PASS。主执行与核对，不复用派发声明冒充结果。
- 主运行`node --test scripts/diagnostics/codex-gateway-boundary.test.mjs`，exit0、1/1、无skip；证明全新outbound精确等于父冻结文本与五个固定字段，不含注入instructions/metadata/paths/tools；有效完成文本交付，工具/混合输出与不匹配输入拒绝且交付计数0，重复请求拒绝。恶意工具数据只送给纯测试函数，未送入真实CLI。
- 主运行`node scripts/diagnostics/codex-offline-probe.mjs --gateway --codex-exe "D:/ClaudeCode/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"`，exit0，CLI耗时476ms、正常退出、1次loopback POST、无超时。原入站仍有update_plan/request_user_input/view_image；网关出站236bytes，仅model=ev-mock、input=已批准合成文本、tools=[]、tool_choice=none、store=false。上游仅进程内Fake函数，不是外部HTTP请求。
- CLI stdout包含已完成`agent_message`，文本精确为`EV_MOCK_FIXED_PLAINTEXT`，以及turn.completed。同时存在type=error的`ev-mock` metadata缺失/fallback诊断，不能称零警告或真实模型兼容性通过。该错误事件未妨碍本次模拟协议闭环，但真实模型元数据、推理输出与认证均未验证。
- 证据目录：`C:/Users/asus/AppData/Local/Temp/ev-codex-offline-probe-vHOuEE/evidence/`，包括summary.json、gateway-incoming-request.json（受限元信息，不是完整入站正文）、gateway-outbound-request.json、child-stdout.jsonl、child-stderr.txt。网关接收完整有界输入后重建出站；不把日志中未保留的正文误称为不存在。proxyAttempts为空仅表示拒绝代理未观察到请求，不证明OS级零外联。
- 安全与范围：返回CLI的SSE在完整Fake响应验证后重新生成，只保留文本；不是对任意真实上游流实现的通用流式过滤器。独立临时home/cwd、环境白名单、managed存在性检查、strict、hooks禁用与file authstore保留；没有OS强制隔离/真实凭据测试。进程与本机服务随诊断正常结束，保留合成证据；用户数据、业务代码、数据库、配置、版本未改，未安装/部署/提交/推送。
- 最终SHA256：gateway模块`BF189583D7E817C8C24A4329177EABA08A1B1B83F75D2A375784F460E8AFFFE0`；组合测试`A93ADD0EC7884DE99A06DC2BF4CFCDAF3947AE7665AB13AF1FA540245217CA14`；probe`72349803EAD339F0EFF7FABDCDB5E206AE7DF15494F2F73DBA3BF9BFD7912169`。三个文件语法检查通过；主复验probe语法与单用例。未运行应用测试/build/browser或真实Provider；上轮直连限定FAIL原样保留，不重跑默认模式冒充新证据。

以下为本轮执行前冻结契约，最新结果以上方为准。

网关spike契约：Terra Max McClintock只修改诊断脚本、添加纯网关模块及一条组合测试；主Agent记录证据、Astra medium限定复核。复用原隔离启动与strict配置，旧默认拒绝模式保持。新增显式`--gateway`：本机CLI请求中必须有精确匹配的合成用户文本；网关从父进程冻结文本重建全新请求，不透传CLI instructions、tools、metadata或路径，设置tools空、tool_choice none及store false。上游仅进程内Fake、不访问网络API；完整验证Fake响应为有界已完成assistant纯文本后，才重新编码SSE交给CLI。恶意function_call/混合输出在纯测试中证明零交付，不给实际CLI发送工具调用。一个组合用例＋一次受看护CLI正常主路径；初次实现及最多两轮本轮局部修正，旧两轮不抹除。只写TASKS进度；不改生产代码/版本/数据/部署/Git发布。该代码标为诊断原型，不转正；本轮尚未运行。

#### M1-B 离线 spike 结果（2026-09-08，限定FAIL）

- 实际分工：Terra Max Raman编写独立诊断，Astra medium Popper做执行前聚焦只读复核及最终两份证据复核；主Agent实际执行。仅新增`scripts/diagnostics/codex-offline-probe.mjs`并更新本TASKS；业务代码、版本、数据迁移、生产Provider接线不变。
- 首版仅语法检查。主审发现功能开关缺项、压缩键层级错误、stderr提示词回显可能误判回复及证据不完整，R1修正后独立复核允许受看护诊断。第一次运行exit1，285ms，配置拒绝`features.browser_use_full_cdp`；模型请求0，不能计为协议通过。证据：`C:/Users/asus/AppData/Local/Temp/ev-codex-offline-probe-CGC16Q/evidence/`。
- 随后在同专属合成环境只读执行已装exe的`features list`，exit0，核验canonical为`browser_use_full_cdp_access`、`memories`；R2修正并显式关闭plugins/image_generation/code_mode_host/goals/in_app_updates与更新检查。主在执行前纠正更新检查的顶层键笔误；strict与安全门禁始终保留。两轮局部修正额度已用，不以换任务名重置。
- 最终命令（两次同形、分别绑定R1/R2代码）：`node scripts/diagnostics/codex-offline-probe.mjs --codex-exe "D:/ClaudeCode/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"`。最终wrapper exit1，CLI在462ms被门禁SIGTERM，无超时；捕获恰好1次loopback `POST /v1/responses`，预期模型/流式/canary均匹配，但tools为`update_plan`、`request_user_input`、`view_image`且tool_choice为auto。门禁返回拒绝、不发送SSE或tool-call回复；这是工具**声明**，没有证明工具实际执行。
- 最终证据：`C:/Users/asus/AppData/Local/Temp/ev-codex-offline-probe-SB7Wlf/evidence/summary.json`、`first-request.json`、`child-stdout.jsonl`、`child-stderr.txt`。请求输入包含内置skills及临时cwd/权限/日期等上下文，不是只有用户合成文本；未在已检查输入中发现个人项目内容。stdout提示`ev-mock`缺模型metadata而使用fallback，故结论仅限0.146.0、本配置与此mock，不能泛化为全部Codex或真实模型不可用。
- Popper独立只读复核summary/first-request，确认no-tools适配器仍BLOCKED、门禁拒绝正确；没有重跑检查。proxyAttempts为空仅说明代理未观察到请求，不是OS防火墙或零外发证明；30秒限制针对直接子进程，不是整棵进程树硬截止。本次进程已结束、服务器随脚本finally关闭，合成证据保留未清理。
- 最终脚本SHA256：`4454E3650C5401DB39B492007DDC171A25B2D3A11B66AA1C96D4A456820AA4AA`。`node --check` exit0（仅语法，非应用测试）；本次2次诊断中1次配置失败、1次协议门禁失败，不存在成功模型回合。未使用真实凭据/真实Provider/个人项目/健康数据，未安装或部署，未stage/commit/push；不运行全仓测试、构建、浏览器或迁移矩阵。M1-A既有Fake证据范围不变。

以下为本次执行前冻结契约与历史核对记录，当前状态以上方结果为准。

M1-B spike小契约（2026-09-08）：Terra Max Raman仅写`scripts/diagnostics/codex-offline-probe.mjs`；主Agent核对安全配置与证据，Astra medium作一次执行前聚焦复核。目标为捕获实际模型请求的工具声明、输入和额外上下文，不接生产adapter。使用专属临时cwd/home/数据、子进程环境白名单、无需认证的loopback Mock Responses与拒绝转发代理；不继承用户认证、插件或配置，不发送工具调用响应。单次执行有界，保留合成证据；代理不等于OS防火墙，不能宣称通用零外网保证。检查managed配置存在性而不读秘密；若存在未核验启动hook/托管配置则不运行。允许脚本语法检查与一次协议诊断，不运行应用测试/构建，不改版本/数据库/用户配置，不提交。工具仍存在或未捕获请求均非PASS；生产入口继续禁用。当前为脚本实现中，尚未运行CLI模型回合。

2026-09-08官方文档核对（仅网页读取，无模型/登录/配置修改）：[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)确认features.shell_tool、应用开关及MCP enabled/工具名单有各自作用域；[非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)确认read-only、ignore-user-config、ignore-rules及ephemeral的局部含义；[App Server](https://learn.chatgpt.com/docs/app-server)说明dynamicTools机制，未提供已核对的全工具清空保证。未找到全局tool_choice:none契约，不代表证明该能力绝不存在。官方当前文档也非0.146.0全部行为的版本锁定证据。不能把shell关闭、只读sandbox、空dynamicTools或事后JSONL检测分别等同于无工具。建议下一步只用专属临时目录/非真实认证占位/loopback Mock协议捕获验证输入与工具声明，并验证工具执行拒绝边界；设计和验证本轮尚未执行。保留原分工，不自动改用OpenAI API或DeepSeek替代项目Codex。

最终R2：Core RED4case中1失败、Web RED2case中1失败，分别复现旧string[]缺引用标识及UI显示全部快照。改为Provider输入{content,contentHash}[]并展示实际引用后，Terra最终`npm test --workspace @ev/core -- tests/m1-project-external-preflight.test.ts tests/v0.8-project-brief.test.ts` exit0、5/5；`npm test --workspace @ev/web -- tests/m1-project-external-preflight.test.tsx tests/v0.8-project-scope.test.tsx` exit0、3/3；`npm run typecheck --workspace=@ev/contracts --workspace=@ev/core --workspace=@ev/web` exit0。Tesla限定复核两处ADDRESSED、无新阻断，复用最终测试不重复全仓。主核对service/UI哈希一致，diff check exit0、暂存区为空；未跑browser/build/全仓/真实Provider/实机。

最终service SHA256 `3334A6DECB7A371B0A5A4086523643677474ABDEA2A5056B49698DE8D2623732`、UI `149FE54B9B92DE4373789C3BF4BFCA09AC2C9FAA00062C3F5D971B5F258317CD`；contracts projects `0DA2A4DF6A8E93432F92EAEBA4DC978D2E772A78CE989D7028E060DB8E9D39E0`、routes `2E3D4F51C552FA0D0C763B0D7F5AFCA59AE2F8F929A273C71135D61FD379F017`。新Core test `560F3A500D54F5F7E66737D2BC22B4AF2749F20BF358096A3CF34070696955EA`、新Web test `7DF69448E36A3E64CA40C5EDB21B50E93326D53522C43333F3A5F382B5C0FCCC`。

修改范围：上述契约/服务/路由/项目页面，两份新M1测试、两份受影响V8测试；文档TECH_SPEC §14、API M1节及本TASKS。无SQL迁移/版本变更，无app/server真实接线，无提交/推送/发布/用户数据操作。下面保留初次实现与R1/R2历史，不把中间绿冒充最终完整MVP通过。

本阶段先核对能力与默认启动接线，不重做项目、不升版本号。授权本地核对与增量准备；真实API、外发数据/费用、真实项目、部署及stage/commit/push仍单独确认。保留V8/V9未提交修改。下文V9“等待部署授权”是该轮停止点；当前优先级调整为先补真实AI业务链。

#### 首次源码核对：不是填入Key即可全部启用

| MVP链路 | 已核对实现/证据 | 当前缺口 |
| --- | --- | --- |
| 项目工作 | projects/service.ts有ProjectAnalysisProvider接口、外部响应schema/证据校验及LOCAL_RULES；app.ts只接收options.projectAnalysisProvider；server.ts没有注入它 | 缺默认生产适配器及启动接线；项目页面提交mode固定LOCAL_RULES，不能从该页面调用真实分析 |
| 输入工作需求 | contracts/projects.ts的createProjectBriefInputSchema含日期、时长、优先级与时间窗；analyze输入仅snapshot | 没有自由文本工作目标字段，需从页面到契约到Provider输入贯通；不能把静态TASKS抽取称为按用户需求推理 |
| 项目读取范围 | 有界白名单文档快照，外部Provider只获snapshot value | 不读取整个代码仓库或Git状态；更广读取不属于此次默认扩权，需要单独界定 |
| 学习文本 | app.ts存在默认DeepSeek LearningAdvice工厂及凭据服务 | 有生产适配器不等于真实调用已验；还需最终输出、来源、失败/费用验证 |
| 课表截图/公开搜索 | capabilities.ts有Vision/PublicSearch接口；app.ts依赖options注入；正常server没有提供 | 当前默认启动缺相应适配器；与普通文本API配置是不同能力，不宣称自动可用 |
| 健身文本/营养数值 | app.ts把可选healthTextProvider/nutritionDataProvider注入对应业务服务 | 正常server未提供这两个实例；需分别选定并实现/连接适配器，不能以模型估算替代营养事实 |
| 日程与记忆 | V8/V9限定本地证据已存在；每日计划默认DeepSeek适配器接线可见 | 真实模型行为及07:00跨日运行待验；规则压缩不是智能摘要 |
| 运维/手机 | V9本地检查与限定复核已记录 | 私有HTTPS、物理iPhone、自启、完整恢复仍NOT RUN |

以上是2026-09-08只读源码核对与既有证据复用，不是新增运行结果，也不是穷尽所有MVP条目的全仓审计。此前75%为方向性粗估，不是可计算的完成率；生产适配器缺失必须单列，不能都归为“只差真实验收”。

#### 当前任务 M1：冻结一条项目真实分析契约

**最新批准：** 用户确认保留“项目Codex、生活/学习DeepSeek”，并明确同意工作需求输入→白名单资料审阅/外发确认→受限Codex分析→确认Action/TimeRequest的短设计。M1进入本地实现；不授权真实调用或秘密读取。

执行拆分：M1-A工作需求、快照绑定preflight与页面（Terra Max Boole，业务契约/服务/路由/页面和定点测试）；M1-B主Agent只读核对已装Codex0.146.0能否满足无工具/无原目录边界，再交适配器实现。两者共用Provider输入，A先交契约，B不并发修改它。只有可验证的能力才启用；仅read-only sandbox不满足“无Shell/无任意读取”。技能的自动提交、额外账本、全仓审查及清理默认不执行，沿用用户最小验证与唯一TASKS要求。

M1-B只读结论：主Agent读取已装CLI help/package，并在本次专属临时目录生成appserver协议schema（生成器exit0，不启动服务/模型）；Tesla/Astra medium独立核对ThreadStart/TurnStart和README，未找到全局no-tools保证。dynamicTools空不等于清空内置，environments空仅声明禁用环境访问，开放config字段不证明配置键有效。生产适配器BLOCKED（证据不足），不尝试绕过sandbox或以提示词代替权限控制。已异步询问是否允许只读官方文档；未获得回复前不联网。schema证据目录：`C:/Users/asus/AppData/Local/Temp/ev-m1-codex-schema-650652777b4443acabe1402582563c82`，只含生成协议，未清理。后续优先取得对应版本配置/工具注册源码或官方证据；真实调用仍单独授权。M1-A没有此依赖，可继续本地Fake验收。

M1-A初次实现证据：新Core3case RED、Web新旧2case RED；首实现预览文件schema错配导致Core2处500/Web审阅失败，修正后GREEN。类型首轮遗漏ProjectExternalAuthorization导出TS2724，补正。主15:06复验`npm test --workspace @ev/core -- tests/m1-project-external-preflight.test.ts tests/v0.8-project-brief.test.ts` exit0、2文件4/4；Web对应m1-project-external-preflight.test.tsx与v0.8-project-scope.test.tsx exit0、2文件2/2；contracts/core/web typecheck exit0。未运行browser/build/真实模型。初次绿不是最终验收：Tesla限定审查P1两项（authorize等待输入变化仍发送旧请求；外部输出没有真正依据引用却自动附全部文件），P2一项（静态模式新必填目标破坏旧页面流程）。主核对对应闭包、schema、required后交Boole R1定点修复；历史失败保留，暂不标A完成。

R1证据：Core新4case的RED中2失败；Web最初重复import造成收集失败（不计用例通过），修正后新旧3case中2失败。修正revision、evidence校验、LOCAL_RULES空目标后，主15:17重验Core2文件5/5、Web2文件3/3 exit0、diff check exit0；Terra最终3workspace typecheck通过。Tesla复核原3项均ADDRESSED。新P2为UI仍把全部快照显示为依据；主另发现Provider仅string[]却要求输出SHA256，缺少可引用标识。R2限定把snapshotValues改为{content,contentHash}[]（不含路径/工具），UI显示analysis.evidenceFiles；成本仅接口/Fake同步，不扩大读取或外发内容正文。待该两点收口，不启动生产适配器。

- 目标：Owner输入工作目标，审阅白名单资料的外发范围，生成有依据的建议，确认后沿现有Action/TimeRequest/Proposal服务排程。
- 已完成：分支/dirty核对、主要接线缺口定位；未改业务代码、未读凭据、未运行测试/模型/其他个人项目、未提交。
- 允许范围（设计候选，待确认）：projects契约/service/单一适配器、现有凭据与能力入口最小接线、projects页面；不授予shell/Git/任意路径权限，不读取全库，不接健康资料，不自动写日程。
- 默认意图：沿用用户原“项目用本机Codex，生活用DeepSeek”；不能未经确认把项目改成DeepSeek。Codex本机入口也可能将上下文发送给模型服务，不应被描述为离线推理。
- 候选最小验证：一个合成项目成功链路与必要一个外发未确认/Provider失败阻断，使用Fake传输；真实小额调用只在另行授权后执行。当前纯文档不跑应用测试。
- 唯一下一步：请用户选择本次项目真实分析首先接本机Codex，还是明确改为DeepSeek API；随后提交具体短设计，确认后才实现。无须现在提供Key，也不在聊天中索取秘密。

| 项目 | 状态 | 证据 / 下一步 |
| --- | --- | --- |
| v0.4～v0.6 | CLOSED（历史工程结论） | [阶段交接](../docs/releases/2026-09-07-development-phase-handoff.md)；真实 Provider 证据债未豁免 |
| V07 / V07-LINEAGE-015 | 限定验收 PASS；历史整版 FAIL 保留 | [独立聚焦复核](../docs/reviews/2026-09-08-v07-lineage-015-focused-review.md) |
| V8 | DONE（本地限定验收） | 01～05实现、最小检查与限定复核完成；历史证据原样保留，不代表真实Provider/生产通过；用户最新已授权继续V9 |
| V9 | LOCAL_IMPLEMENTATION_PASS（限定）；整体PARTIAL | 01～06本地实现、最小检查与限定复核收口；真实Provider/私有HTTPS/iPhone/自启/真实恢复NOT RUN；未发布 |

## V9 当前执行契约（2026-09-08）

**依据与优先级：** 用户最新“直接继续完成v0.9”；复用[已批准旧设计](../docs/superpowers/plans/2026-08-23-v0.9-private-iphone-operations.md)，小契约以本节及[TECH_SPEC §13](../docs/TECH_SPEC.md#13-v9-私有运维增量设计冻结)为准。旧计划保持原样，其全仓测试/audit、全迁移/浏览器矩阵、网络安装与自动提交明确不执行。继承V8未提交工作区（只读起点HEAD `50b5338`、实际migration max26），不要求创造V8 PASS commit，不改历史FAIL/验收报告。下方V8预算与停止点是历史，不覆盖最新V9授权。

**执行方式：** 实际Terra Max实现，Astra medium仅对安全/恢复与最终实际diff做少量聚焦只读审查。Descartes完成9份规范文档增量后交回文档写入权；Euclid已接V9-01。主Agent在本文件登记实际结果，不以派发或文档冻结代替通过证据。

**共同预算和权限：** 每任务1成功场景 + 关键阻断，可合成1case；记录精确命令、命中数、退出码、修复轮次与证据范围，零命中不是PASS。不重跑数百suite、历史迁移矩阵或所有V8用例；共享边界确实改变时只补受影响关键断言。常规范围内修复持续完成、失败与轮次累记，不换编号清零。最终仅受影响workspace typecheck/build，至多1本地浏览器主路径。实现可用隔离合成目录/loopback；本轮文档不运行任何测试。所有实际网络/安装/Tailscale/Serve/防火墙/任务注册删除/重启/真实库备份恢复/个人数据/付费API/push发布需用户单独授权；不stage/commit、不覆盖dirty、不新增依赖安装。

| 任务 | 本地实现 | 物理部署/真实环境 | 初始证据 |
| --- | --- | --- | --- |
| V9-01 | DONE（限定本地） | NOT RUN | 第2轮GREEN、Planck两项ADDRESSED；最终Web单case、类型/build/browser通过 |
| V9-02 | LOCAL_SLICE_PASS（1项P2保留） | NOT RUN | 第3轮GREEN、Planck原3项ADDRESSED；未真实运维 |
| V9-03 | LOCAL_SLICE_PASS | NOT RUN | 第5轮GREEN，Kepler原类型P1 ADDRESSED，恢复边界限定通过 |
| V9-04 | LOCAL_SLICE_PASS | NOT RUN | 第4轮GREEN，Kepler原5项ADDRESSED；无新具体P1 |
| V9-05 | DONE（限定本地）；完整设备验收PARTIAL | NOT RUN | 单Chromium LOCAL_RULES主路径1/1；只读检查执行；无物理Safari/HTTPS证据 |
| V9-06 | DONE（限定本地）；完整版本验收PARTIAL | NOT RUN | 0.9.0版本1/1、三workspace类型、Web构建通过；Astra限定复核无有效P0/P1 |

### V9 最终本地收口证据（2026-09-08）

主Agent最终只读检查：12份当前文档、107个本地文件链接无缺失；`git -c core.safecrlf=false diff --check` exit0，暂存区为空，分支codex/product-prd/HEAD50b5338未变。V07三个来源冲突相关文件SHA256仍与限定复核一致，未重跑V07。当前父环境EV_LOG_DIR未设置（只读布尔检查，不输出配置值）；这是当前环境证据，不追溯推断所有历史执行环境。

**唯一下一步：等待用户对真实私有部署/实机验收的精确目标与动作授权。** 本轮停止，不自动启动预览、不提交/推送/发布、不进入新版本。下方未勾选小契约及“待返回”等段落是冻结设计和历史执行时点，当前结论以本表/本节为准；完整实机门禁仍未通过。

- 实现Terra Max，最终限定复核Kepler/Astra medium：指定集成文件未发现有效P0/P1；保留P2-LOCK-REPORT及新P2-E2E-LOG-ENV（runner继承EV_LOG_DIR，后续执行必须确保未设置或指向隔离目录；没有证据表明本次写入真实日志）。未重开全仓审查，未追加应用测试。
- 最终命令：`node scripts/run-e2e.mjs 'v0.9-private-iphone.spec.ts'` exit0，Chromium一worker1/1；`npm test --workspace @ev/core -- tests/v0.9-backup-restore.test.ts tests/v0.9-operations.test.ts` exit0、2/2；`npm test --workspace @ev/web -- tests/v0.9-private-boundary.test.ts` exit0、1/1；`node --test tests/v0.9-version.test.mjs` exit0、1/1；`npm run typecheck --workspace=@ev/contracts --workspace=@ev/core --workspace=@ev/web` exit0；关闭NEXT_TELEMETRY_DISABLED遥测后`npm run build --workspace @ev/web` exit0（环境变量实际值为1，关闭的是遥测）。既有Windows脚本1case与logout精确1case证据复用，未改相应文件。
- 顺序：browser绿→Core测试发现旧0.8期待→仅同步测试期待→Core2→Web1→版本1→类型→构建→只读监听。最后修改由Core测试/类型覆盖；最后Web运行时修改先于browser，未拿HEAD替代dirty证据。schema26，迁移文件SHA256仍`7256CC175365E8DB2C66065AAF5FBD230ADBD38F94C2EAF6A6E3CE7BD56202B1`；V9未改SQL。4个workspace+根共5份manifest及内部lock元数据0.9.0，不新增依赖。
- `& .\scripts\windows\check-private-access.ps1 -WebOrigin 'http://127.0.0.1:3217' -CoreHost '127.0.0.1' -CorePort 4327 -WebPort 3217` exit0，3217/4327均NOT_LISTENING。只证明读取本地状态与runner已停，不是私网可访问PASS。
- 浏览器实际正常Core入口，独立数据目录，setup→合成项目CLI授权→LOCAL_RULES Brief→确认Action/TimeRequest→协调Proposal→确认Event→刷新Today；确认前后计数、Provider调用0、CSRF/CSP/nonce和console/page/API/外部请求诊断均断言通过。仅精确V8/V9单selector豁免不产生的V07 fixture归档，其他selector仍有原门禁。HTTP dev Chromium不是生产HTTPS或iPhone。
- 05/06累计7修复组：版本lock路径、backup严格类型、Web测试严格类型、正常Core启动环境、Next显式.ts/原生TS loader、UI locator、operations版本期待。9次验收命令exit非零：版本1、类型1（8 TS诊断）、browser6（启动前5/locator1）、Core1；另1次只读模块解析探针非零。未把启动零命中算通过，未删除断言或降低类型配置。试用tsx preload未解决并撤回。此前01～04历史轮次/FAIL照旧保留。
- 最终代码SHA256：backup-service `BDF9BA9D5C0584F357EDB2AEA09866369DB13523F4A7E00FEBEB6F2A11036301`；private-directory `B5EDF59BC99DEE4EC4232A84CA1E360FF9B208EBAA80E1E2AA6FD64B51787F3D`；next.config `7A576A1F82F769B94CA42514B62EF542B5BDB05FFE920F6E6AA714A7DD82DE7A`；runner `6298253D3A302B019C19784E16BA4C7D5AE19A632225B4F5AF5FF026571EADD9`；browser spec `DA3AEC1D6CAB413140CD26252914A6A7F413030804A91070D53B74559CB58929`；Web边界test `D287BD2C748E5E0C5CE9449B6CD0444FC12FBC97A6BD4D816DC08BA490924658`；operations test `2A42E26C906D396FF4ACCDBAFE2F87161811A864BFFD4A6DA106C9178EDA9A7A`。
- 验收人员操作、命令与未测矩阵见[交接](../docs/releases/2026-09-08-v0.9-local-acceptance.md)。物理iPhone、真实HTTPS、真实任务注册/重启、真实Provider、个人数据恢复、全仓/全设备矩阵均NOT RUN；WebKit未安装未运行。无默认账号，无用户反馈，不称完整MVP/生产PASS。

### V9-01 — Web-only private HTTPS 安全边界

执行前交叉核对（主Agent，只读源码与冻结契约）：

| 接口/共享文件 | 核对与执行裁定 |
| --- | --- |
| 01 → 02/05：EV_WEB_ORIGIN | 精确外部Web origin，不是Core上游；launcher和隔离runner显式传值；不会按Host猜测。缺配置会阻断写操作，部署说明必须同步。 |
| 01 → 04：auth/health | setup/login可匿名但受CSRF保护；Core实际Owner guard保留；旧匿名live/ready不改成需登录，避免launcher死锁。 |
| 02：运行入口/验证 | Core现有tsx源码启动，Web需既有build；测试用mock进程与任务适配器，不用WhatIf冒充真实开机启动。 |
| 03 → 04/06：backup/版本 | 使用同一快照的计数和APP_VERSION；health不触发备份或读取全部备份正文，未观察到就明确unknown/not_run。 |
| 03：恢复/数据权限 | 不用自动迁移openDatabase验证源备份；仅独占新目标，SQLite-only不等于全备，Windows 0600不等于ACL。 |
| 01/05：scripts/run-e2e.mjs | 01只加origin环境，05再改精确V9 selector；按序写，保留真实退出码及其他selector的V07归档门禁。 |
| 04/06：app.ts/reliability/package | 日志接线与版本收口串行；最终集中类型/构建一次，版本号不当作发布证据。 |

代价/边界：缺生产域名、设备或真实运维授权仍可交本地实现候选，但完整V9保持PARTIAL。10份规范文档87个本地文件链接已只读核对、无缺失；这不是业务测试。

- [ ] 消费现有`apps/core/src/config.ts`、`server.ts`、`modules/auth/{routes,guard}.ts`、`apps/web/src/app/api/core/[...path]/route.ts`、`src/lib/core-client.ts`；修改最小接线，拟新增`apps/web/src/lib/web-security.ts`和`apps/web/src/app/api/csrf/route.ts`，安全头在`apps/web/next.config.ts`或同层最小响应封装落地。不得重建认证栈。
- [ ] 产出§13.1精确Origin/CSRF契约：拟新增`EV_WEB_ORIGIN`，不信任Host/forwarded；setup/login无session但需Origin+CSRF，其余写入仍必须Core认证Owner（包括补足logout）。`requestCore`统一初始化token再写；保留5MB、固定loopback、会话cookie白名单、no-store/manual redirect与Proposal确认边界。全部local-admin代理拒绝，POST projects保持405。
- [ ] 最小检查拟新增`apps/web/tests/v0.9-private-boundary.test.ts`，`npm test --workspace @ev/web -- tests/v0.9-private-boundary.test.ts`：1组合case涵盖初始化→setup/login→Owner写成功及伪造Origin/缺或错CSRF不fetch、local-admin拒绝；同case可读config guard断言非127拒绝，不扩旧suite。精确补验logout Owner可放受影响Core单case，不以cookie存在代替认证。E2E env接线在现有`scripts/run-e2e.mjs`及`apps/web/playwright.config.ts`明确设置`EV_WEB_ORIGIN=http://127.0.0.1:3217`；不另跑browser。

### V9-02 — Windows launcher 与 WhatIf 脚本

V9-01第2轮结果：Web同一命令RED exit1/1失败（正确src/proxy缺失），修正后GREEN exit0/1通过。Planck限定复核两项均ADDRESSED、修正无新问题；未再跑Core/logout或类型/build/browser。主核对入口及token判空。复核SHA256：src/proxy `22A116435CEFDE5C9A86DF37C4D65ABA79AE07992016C0BFD51DC708CFEDBDE5`；web-security `1AFB7CCCEFB524AC3AE2E077991B9CEC88377190B519C2A99BD8CC07FB7869AD`；Web测试 `F3682F6F605794236A2382E0E531CB4E6E75F5CECE72E323AC4F9B141A80CA81`；env示例 `A7932FC71DC5BDD6C1E61E59FE5CE60E6646EDCD59DDACE713264D85D6586601`。仅切片通过，不是实际生产nonce/私有HTTPS证据。

V9-01独立Planck/Astra medium复核SPEC/QUALITY未通过，P1两项：①根`apps/web/proxy.ts`不在实际src/app同层发现路径，HTML nonce/CSP未接线；②`web-security.ts`的`values[0]`在noUncheckedIndexedAccess下仍可undefined。主Agent核对源码/tsconfig确认，不是实测生产暴露结论。已交Euclid定点第2轮：只移动自身新proxy文件至src、校正导入与索引判空，补Web单case入口断言和.env.example显式origin。02仅独立Windows脚本，无同文件写入；不碰日常数据或真实网络，不重跑整版。复核其他01边界未发现新阻断，不据此宣称整版PASS。

V9-01切片证据（Terra返回，主Agent已核实际实现）：`npm test --workspace @ev/web -- tests/v0.9-private-boundary.test.ts` RED exit1/1失败（缺Origin仍转发），GREEN exit0/1通过；`npm test --workspace @ev/core -- tests/auth.test.ts -t "rejects logout without a valid Owner session"` RED exit1/1失败，GREEN exit0/1通过9跳过（精确名称过滤）。修复1轮为SameSite序列化大小写断言修正，未放宽安全策略。新增web-security、csrf route、proxy，BFF/client/Next/layout/logout及E2E origin接线；未跑旧suite、类型/构建或browser。主Agent核对固定origin、cookie绑定、logout实际guard，独立复核尚待结果，不称完整安全验收。

- [ ] 依赖01，拟新增`scripts/windows/ev-dashboard.ps1`、`install-autostart.ps1`、`uninstall-autostart.ps1`、`test-launcher.ps1`和`tests/windows-launcher.test.mjs`。消费实际Core start（tsx源码）与Web next start（已有build），不能假设Core dist、evctl或独立migration CLI已存在。
- [ ] 产出显式绝对RepoRoot/DataDir/LogDir、进程所有权与排他lock、Core先启动迁移并ready后Web启动；失败仅清理本次拥有的进程。install/uninstall为当前Windows用户、最低权限、精确任务定义、SupportsShouldProcess/WhatIf，卸载不删数据/备份且不覆盖同名陌生任务。具体边界见§13.2。
- [ ] 最小拟运行`node --test tests/windows-launcher.test.mjs`（不用会捎带既有测试的test:legacy）：1组合case用临时目录与mock进程/任务适配器覆盖带空格路径启动成功、重复/陌生占用拒绝及WhatIf零注册/删除/启动副作用。parser检查可纳入同case；不实际注册、删除系统任务，不重启主机。

### V9-03 — SQLite 一致快照及隔离恢复演练

V9-02收口限定复核：Planck原P1三项均ADDRESSED，未重跑测试；helper SHA256 `D34192BEFB48A6D3443502BA6D45B91DA3354F6D8BE78663354170E125E38365`、测试`5984F91057EE11C55403A523504D6D9F88AB7AFD6E52A6A1AA4FEDC28170AD5F`。新增P2-LOCK-REPORT：Retain-EvLaunchLock在持久记录失败/流已关闭时可能仍因Dispose成功而报告lock retained，实际是否保留未核验；正常启动仍有端口/锁拒绝，未把错误变成业务成功。本轮不扩P2修复，进入ROADMAP及验收限制；不能凭该提示删锁/重启，更不能据此认定Core已停止。这里只关闭原P1，不是实机运维PASS。

V9-02第3轮：同一`node --test tests/windows-launcher.test.mjs`，RED exit1/1fail缺树终止契约；补不可验证身份断言又RED exit1/1fail底层查询错误泄漏；最终GREEN exit0/1pass0fail。Interactive枚举同步定义/比对；身份匹配后Kill(true)；各清理独立尝试、失败记录保留lock；未知查询/创建时间failclosed；PATH包含固定系统PowerShell目录、TEMP/TMP在runtime-tmp。主核对关键实现，Planck仅复核原三项与修正，待结果。累计3轮不清零，不称真实进程树/系统任务已验证。

V9-02 Planck限定复核SPEC/QUALITY未通过，P1×3：本机ScheduledTasks CDXML合法LogonType为Interactive而非InteractiveToken；tsx CLI会spawn真实Core子进程、只Kill父进程可遗留持库进程；finally顺序清理一项抛错会跳过后续清理/锁释放。主读取对应默认实现确认，并交Mendel原范围第3轮（保留2轮计数），同一组合case覆盖修正，无真实注册/进程操作。不是因mock PASS而忽略默认生产分支，最终记录仍为未实启。

V9-02切片证据：Mendel/Terra Max仅新增5份Windows脚本（含私有共享helper）及tests/windows-launcher.test.mjs。`node --test tests/windows-launcher.test.mjs`初始RED exit1/0pass1fail（缺launcher）；集成RED exit1（缺WebPort）；最终GREEN exit0/1pass0fail，单case含PSparser、mock先core ready后web、HTTPS443与内部3217分离、Core4327及secure/env参数、HTTP拒绝、重复lock/陌生端口任务/WhatIf。累计2功能轮次（基础实现/集成契约补正）。主实际读取环境、子进程身份与cleanup接线，并核本机PowerShell7.6.5及已装pwsh路径；没有安装。Planck限定复核待返回。未运行真实Node/tsx/Next启动、注册/卸载、AtLogOn、迁移ready、反代或重启；不把mock称为真实常驻成功。

执行顺序裁定：02与03没有消费彼此的函数、端口或新表，前者独占scripts/windows与Node launcher测试，后者独占Core backup service/CLI/单测试及新的私有权限helper；可安全并行。仅取消无技术依赖的等待，不提前执行04/05集成、不更改业务边界或测试规模。若产生共享文件需求须交主Agent串行接线；代价是最后必须核对双方数据目录/配置约定，不能用各自局部PASS代替整合。

- [ ] 依赖02，拟新增`apps/core/src/storage/backup-service.ts`、`apps/core/src/cli/backup.ts`、`apps/core/tests/v0.9-backup-restore.test.ts`；复用better-sqlite3 backup API、实际schema_migrations及现有路径防逃逸工具，不新增HTTP运维写入口。CLI参数及npm脚本在落盘后才收入API/DEPLOYMENT可调用说明。
- [ ] 产出§13.3的SQLite-only snapshot+manifest、只读验证与隔离恢复副本；快照中读取计数/schema/hash，绝不从仍在变化的源库拼manifest。不复制活跃db/wal/shm，不用openDatabase校验未验备份或原库，不提供活跃库覆盖开关。保留artifacts/DPAPI/投影不完整声明。
- [ ] 最小拟运行`npm test --workspace @ev/core -- tests/v0.9-backup-restore.test.ts`：1组合case在合成WAL写入下backup→hash/quick_check→隔离恢复保留Owner/Task/Run标识与计数，篡改snapshot或manifest/活跃目标拒绝且原库不变；使用当前max26，不造多版本矩阵、无必要不加migration。

### V9-04 — allowlist JSONL 轮转与只读 health

V9-03收口限定复核：Kepler原类型P1 ADDRESSED，实读hash与第5轮一致；精确数组校验/失败语义保持，无修正新增P1/P2。复用1/1证据，不重新审查或运行03；只是本地切片通过，不是全应用恢复或真实数据验收。

V9-03第5轮：只改backup-service的manifest includes/excludes局部收窄，不改精确长度/顺序判断；同最小命令exit0、1文件1通过。SHA256 `2DD1BFE835034588510FDDFF13D1A78579E6FA25EF2968BC484C1828F05DB747`，helper/CLI/migrations未变，未type/build/新增case；Kepler仅复核原类型问题，待结果。

V9-03 Kepler限定复核：恢复SPEC边界无具体P1/P2，QUALITY有1项静态类型P1（manifest includes/excludes属性的Array.isArray收窄不保留到every回调）；已交Kant仅局部常量收窄，第5轮，前4轮不清零。未运行编译器，不伪称compiler RED。源/目标隔离、manifest与同快照事实、readonly verify、DELETE journal头、ACL先于复制均有静态控制；manifest篡改/链接/已有目标/ACL故障未直接动态覆盖，保留NOT TESTED，不扩矩阵。helper SHA256 `B5EDF59BC99DEE4EC4232A84CA1E360FF9B208EBAA80E1E2AA6FD64B51787F3D`，该修正不得改变helper，04证据据此判断有效性。

V9-03实际证据：Kant/Terra Max执行`npm test --workspace @ev/core -- tests/v0.9-backup-restore.test.ts`最终exit0/1文件1通过。最初缺service/CLI两次RED均exit1、0个执行用例（收集失败，不当作业务RED或PASS）；随后累计4轮窄修复：WindowsDACL改.NET、manifest fsync句柄、独立snapshot journal_mode DELETE、去冗余ACL调用和真实ACL时限。仅当前合成WAL/当前用户临时DACL，无个人库/网络。新增private-directory、backup service/CLI/测试，migrations仅尾部导出最大版本、1～26 SQL未改；package未改。helper在04获得GREEN后未再修改。主已读快照/manifest/CLI错误控制，Kepler独立恢复复核待返回，未type/build/browser。

并行边界：04可以先写独立logger/health与测试，03唯一维护`filesystem/private-directory.ts`，按createPrivateDirectory/assertPrivateDirectory两函数消费，不复制权限实现、不写同文件。04通过证据须在03实际helper可用后获得；backup状态无实际观测就unknown/not_run，不虚构独立CLI与Core之间的状态同步。版本元数据统一留06，migrations不并发修改。

- [ ] 依赖01/03，拟新增`apps/core/src/observability/runtime-logger.ts`、`apps/core/tests/v0.9-operations.test.ts`；最小修改`app.ts`、`server.ts`、`modules/health/routes.ts`、`packages/contracts/src/reliability.ts`及实际导出接线。复用日志调用与Owner guard，不复制运行/调度状态服务。
- [ ] 产出§13.4有界日志及health快照；现有`/v1/health/live`、`/v1/health/ready`保留最小匿名兼容；拟新增Owner `GET /v1/health`详细状态。字段allowlist覆盖Fastify自动请求日志和业务调用，不将原始err/message/req直接落盘。health禁止外部探测、DPAPI解密、迁移/写探针/修复/触发任务。无既有ACL helper，必要拟新增`apps/core/src/filesystem/owner-directory.ts`供02/03/04复用；仅新建临时目录可做权限验证/设置，真实Owner目录ACL不改，mode0600不视为WindowsACL证据。
- [ ] 最小拟运行`npm test --workspace @ev/core -- tests/v0.9-operations.test.ts`：1组合case正常写入/轮转/重开、Owner读health成功，嵌套canary正文/密钥/路径不落盘、磁盘失败降级与匿名详细health拒绝；可在一个case逐段断言，不跑历史health大suite。

### V9-05 — 唯一本地主路径与待验实机记录

V9-04收口限定复核：Kepler原五项ADDRESSED、type导出补齐，无合修新增具体P1。主已读server/guard/health；app哈希`49770B1104C67C6D066DE1907F9793A488F1E4EE7F315E23A5ADC61296C4A6D8`、server`C99B610717830958FA1C97EE7109C6EF5D82C8545569B5EF3E9A3FCE54B7BA9E`、logger`9E7FEC487D717B0DD01028F770C6A22214681970E9B5F5F685DE2D9510510D30`、health`9A6AC71F5355A0F8F31C3CE7F6F2F3F54E9C7822686D332EB8B76CD4C7C4D413`、operations测试`62CC141487A8A5656C9916C5FCAEF463477480A3076EC64EB9BD7E38995DDB4E`。复用第4轮1/1，不冒充整体类型/构建通过。03/04停止写入后，主已发GO让Rawls合并05/06机械元数据收口；最终版本变更后的backup/operations两case集中验证，不重跑旧全套。

V9-04合修实际第4轮（本轮+1，初始missing-module/helper等待不计）：9文件含直接auth三文件只读选项。operations同命令RED exit1/实际1case，5断言失败覆盖无日志500/缺合法状态、过期session删除/WAL改变、startCore缺失；GREEN exit0/1文件1用例，固定磁盘降级标记为预期。类型可选字段/tuple判空/OperationsHealthCheckStatus导出、health unconfigured映射与只读鉴权、启动外层catch和listen失败close已落盘。主读实际server/guard确认，Kepler仅原问题复核中。startup动态只测隔离listen失败与close，config/build失败仅同catch静态覆盖；未单独运行，不编造全失败矩阵。未变03/helper/版本/迁移，集中type/build/browser仍后置。

V9-04 Kepler限定复核需修：P1类型接线（exactoptional/tuple索引）与启动初始化异常旁路；P2过期session鉴权清理写库、log not_configured枚举造成health500、listen失败未close调度。主核实际函数并发现缺OperationsHealthCheckStatus类型导出。裁定：这些是本切片明确契约的直接缺口，合并一次局部修正，不扩业务；仅health启用只读session选项、保持其他认证默认清理和过期401语义，允许直接调用链auth repository/service/guard小范围接线。新单case补无日志状态/过期session不删与安全启动失败，仍不运行旧矩阵。启动失败close与脱敏同链修正；不同于02的可留P2诊断精度，本项默认health500与纯读契约需闭合才能交付。

V9-04切片：Nash新增runtime logger/operations单测试，接app/server/health与reliability契约，APP_VERSION未改。`npm test --workspace @ev/core -- tests/v0.9-operations.test.ts`最终exit0/1通过；预期磁盘故障输出固定EV_RUNTIME_LOGGER_DEGRADED，无原始路径。RED历史与修复计数待补充，不能抹去失败。默认backup仅注入观察接口、not_run；scheduler启用unknown/未启用not_run；Provider只元数据不做真实调用，状态限制不伪造成健康。主已读实际接线，Kepler限定审查中，尚未类型/build/browser。

- [ ] 依赖01～04，拟新增`apps/web/e2e/v0.9-private-iphone.spec.ts`，必要修改现有runner/config；拟新增`scripts/windows/check-private-access.ps1`仅输出只读本地边界检查，实际网络检查不执行。实机步骤正文只在DEPLOYMENT，结果只在本文件。
- [ ] 最小拟运行`node scripts/run-e2e.mjs 'v0.9-private-iphone.spec.ts'`，仅当runner已支持精确selector后执行；隔离3217/4327、新合成Owner、LOCAL_RULES，1路径setup/login→Today→已有Proposal审核确认→刷新结果，确认前不写事实；未配置Provider不伪造成功。受影响断线/重试利用同主路径与已有幂等机制，不新增模块浏览器矩阵。runner保留真实退出码，不能因未跑V07归档把此单spec误判或跳过其他选择器验证。
- [ ] 默认使用已装Chromium；至多1本地路径，不另加第二仿真矩阵。缺已装WebKit记录NOT RUN、不安装；仿真无论成功与否均不是物理Safari。物理设备、认证私有HTTPS、监听隔离、真实自启动/重启及真实数据恢复证据仍待单独授权，未执行明确NOT RUN。

### V9-06 — 0.9.0 本地实现收口，完整验收分离

- [ ] 依赖01～04本地完成、05本地主路径已有实际结果及实机待验记录；物理缺证据不阻止准确标注本地实现候选，却阻止完整V9 PASS。实际版本源为`packages/contracts/src/reliability.ts`的APP_VERSION，不是旧计划不存在的version.ts。
- [ ] 同步`package.json`、`apps/core/package.json`、`apps/web/package.json`、`packages/contracts/package.json`、`packages/domain/package.json`及`package-lock.json`的workspace元数据/内部依赖到0.9.0，health/run/backup消费同一APP_VERSION。只改版本元数据、不联网刷新依赖，不tag/push/release。
- [ ] 1版本一致性组合case可纳入04现有单case或拟新增`tests/v0.9-version.test.mjs`用`node --test tests/v0.9-version.test.mjs`定点执行；成功验证元数据与manifest版本，错配阻断收口。最终按实际影响执行`npm run typecheck --workspace=@ev/contracts --workspace=@ev/core --workspace=@ev/web`及`npm run build --workspace @ev/web`，domain仅被改时加入；关闭遥测。不跑根test/lint/build/audit，不再第二条浏览器路径。
- [ ] 实际实现/检查与少量Astra medium聚焦复核无未解决P0/P1后可写LOCAL_IMPLEMENTATION_PASS（限定）；物理/真实部署仍NOT RUN则overall **PARTIAL，不complete/完整PASS**。旧完整V9的真实Provider证据债、私有认证HTTPS、物理iPhone、真实自启动/重启、真实数据可恢复门禁不得删除；原全量矩阵本轮NOT RUN，不把缩小验证冒充旧完整门禁通过。

**文档冻结证据：** 本轮仅只读源码与现有文档、apply_patch增量；未执行上述拟定命令、未运行V9业务。历史版本和已存在能力以只读起点为准；后续并发实现落盘后由主Agent更新本节证据，不能从本规划勾选任何实现完成项。

V07 原 [第三次 Sol 审查](../docs/reviews/2026-08-31-v0.7-sol-rereview-2.md) 为 FAIL（P0=0/P1=1/P2=4），历史结论不改写。独立复核只针对完整不可变 nutrition source descriptor 冲突、原子失败与无可确认 Meal；不是重启整版测试。保留 V07-CONTRACT-010、BROWSER-011、EVIDENCE-014 与继承 v0.6 P2，不越界顺修。REPORT-016 历史措辞修订见阶段交接/原 .agent 历史。

## 全部任务共用执行预算

- **2026-09-08最新工作流授权：** 用户在明确知晓两处P1与集中类型错误后要求“一次性完成v0.8，无须停顿”。本轮按已列收尾包持续处理既定V8内常规本地修复，不再因原逐轮确认流程暂停；实际修复轮次继续累计并保留历史FAIL，不改任务名清零。功能/数据/网络/安装/发布权限不扩大，仍执行最小检查，只有不可绕开的外部条件或新权限需求才请求用户。

- 本轮允许 V07 定点修复、独立复核及其 PASS 后的 V8 业务实现与最小测试；禁止 stage/commit/push/network/安装。
- 后续每任务仅 **1 个成功场景 + 必要 1 个阻断场景**，按测试名称聚焦；每任务最多 **2 次局部修复**，超过上限或需实质扩展功能时交主 Agent 决策，不循环扩大验证。闭环必要支撑文件可按下述规则补充。
- 不跑根 npm test、全迁移矩阵、全站 E2E；整版最多 **1 条聚焦 browser happy path**，归 V8-05，其他任务不重复浏览器。既有全量测试数字仅作历史引用。
- 真实 API/网络/数据/项目/凭据/安装/生产/push 均另授权。LOCAL_RULES 明示静态建议，可产品运行；外部模式未配置 503。合成测试数据不得冒充真实外部证据。
- 原 review/release/ADR 不改。仅 TASKS 更新状态、实际修复次数、检查结果、证据与下一步；未来不存在的文件均标“拟新增”，不存在的 API 不当作可调用。
- 每项验收只看本项结果，不借文档冻结修改 package 版本。新 migration 实施前重读实际 max（初始22）后追加，迁移写入串行。可新增独立聚焦测试文件避免运行旧大suite；下列测试路径是复用候选，不要求整文件运行。与本项闭环直接相关的存储/契约/接线/Proposal applier/加法迁移可按实际补充范围并记录，不因原计划漏列造成实施死锁；实质新增功能仍不在范围内。

## V8-01 — 本机 CLI 授权

- [x] **状态：DONE；最终CLI单场景及集成类型检查通过；原局部修复0/2，收口判空修正在05累计记录。**
- **目标/需求：** FR-06/13；TECH_SPEC §12.1。本机 CLI 直开已存在 EV 库，选唯一 Owner 并复用 scope-service；关 HTTP/Web 路径登记。
- **依赖：** V07 定点独立 PASS。**文件范围：** 拟新增 apps/core/src/cli/projects.ts；已有 apps/core/src/modules/projects/{scope-service,routes}.ts、apps/web/src/app/api/core/[...path]/route.ts、apps/web/src/components/projects/project-workspace.tsx；复用 config.ts/storage/database.ts/auth/repository.ts（只读）；聚焦 apps/core/tests/project-scopes.test.ts（已有）或新增独立聚焦测试。
- **不做：** local-admin HTTP、新 capability 凭据、创建 Owner、自动扩大/删除旧 scope、真实项目授权。
- **验收：** 本机授权写 EV 库而不写项目，旧授权可读；远程不能递交路径。
- **最小检查：** 1 成功：隔离库唯一 Owner 的授权→列表；必要1阻断：HTTP 登记路径拒绝且授权表不变。不启动真实 CLI/服务操作用户库。
- **证据：** 主 Agent 于2026-09-08 00:35:13执行 `npm test --workspace @ev/core -- tests/v0.8-project-cli.test.ts`，exit0、1文件1/1。合成已有Owner/旧授权，CLI新增授权，旧快照可读，项目字节不变，Core无HTTP登记路由且BFF拒绝POST路径、不调用fetch；表计数无意外新增。独立新增测试，原project-scopes与Web测试保留断言并调整为本机授权准备。本轮未运行旧suite或浏览器；共享类型/构建待收口。**下一步：** V8-02。

## V8-02 — 有界 snapshot 与 Brief/Action

- [x] **状态：DONE；最终Brief单场景、网页主路径及项目竞态回归/限定复核通过；原局部修复1/2，集成收尾在05累计记录。**
- **目标/需求：** FR-06/11/13；TECH_SPEC §12.1。规范文档白名单、有界 snapshot，LOCAL_RULES 静态 Brief / 可选 Provider Port，确认 Action 后产生 TimeRequest。
- **依赖：** V8-01；既有 Proposal/Action/TimeRequest 与 Provider envelope。**文件范围：** apps/core/src/modules/projects/{snapshot,service,routes}.ts；拟新增同目录 project-analyzer.ts、repository.ts（按实际需要）；packages/contracts/src/projects.ts 与必要 Proposal 契约；现有 modules/proposals 下的项目 Action applier 及注册接线可补充/新增；apps/core/src/app.ts 与 storage/migrations.ts 追加迁移单列；测试优先新增独立 project brief/确认链聚焦文件，或筛选既有 memory-project.test.ts。复用服务，不整段重写。
- **不做：** shell/Git 查询或写入、泛文件遍历、Provider 原路径/工具权限、隐式规则降级、真实数据/网络。
- **验收：** 静态标签和文件证据可见；确认前无 Action/TimeRequest，确认后原子且不重复；外部未配置 503。
- **最小检查：** 1 成功：合成目录规范文档→LOCAL_RULES→确认 Action/TimeRequest，前后字节不变；必要1阻断：外部模式无 Provider→503且无业务写入。
- **证据：** 主 Agent 于2026-09-08 00:56:15执行 `npm test --workspace @ev/core -- tests/v0.8-project-brief.test.ts`，exit0、1文件1/1。EXTERNAL未配置503且无Brief/Proposal/Action/请求写入；LOCAL_RULES读取docs/plans、根重复内容去重，确认前零行动/请求，确认后各1且重复决定幂等；项目合成文件SHA256不变。migration23仅追加project_briefs。读取使用stat/fstat+最多256001字节的fd读取，祖先链接与疑似密钥跳过为静态核对，未冒充动态组合覆盖。**下一步：** V8-03（实体记忆）。

## V8-03 — 实体记忆兼容

- [x] **状态：DONE；最终v22→26实体记忆兼容、Owner/实体与删除保护单场景通过，页面竞态回归/复核通过；原局部修复1/2，未转移预算。**
- **目标/需求：** FR-10；TECH_SPEC §12.2。owner/scopeType/scopeId、旧四域兼容与可追溯 revision。
- **依赖：** V8-01；现有 memory service。**文件范围：** packages/contracts/src/memory.ts、apps/core/src/modules/memory/{service,routes,markdown}.ts；迁移 apps/core/src/storage/migrations.ts 单列；聚焦 apps/core/tests/memory-routes.test.ts（已有）。
- **不做：** 重写旧 migration、强归属旧 PROJECT 到某实体、跨域共享、模型调用、全历史升级。
- **验收：** 四域文本/revisions 仍可读，新实体记忆 Owner/实体隔离，编号只从实施时 max 后追加。
- **最小检查：** 1 成功：一个 v22 合成四域库增量升级并读取原版本；必要1阻断：跨 Owner 实体读取拒绝。无需整个 migrations.test.ts。
- **证据：** Terra Max执行 `npm test --workspace @ev/core -- tests/v0.8-entity-memory.test.ts`：RED exit1、1用例（路由404）；兼容修复前exit1（旧revision严格响应拒绝新增id），恢复旧输出后GREEN exit0、1文件1/1。主Agent核对改动与单场景断言：v22→24旧四域与历史仍可读，DOMAIN适配，新实体写/编辑/追加恢复/安全投影，跨Owner拒绝及永久删除后不可恢复。未跑typecheck/lint/旧suite；V8-04会改共享记忆代码，收口时判断需重新验证的部分。**下一步：** V8-04。

## V8-04 — 规则压缩草案与恢复

- [x] **状态：DONE；最终压缩/拒绝/确认/恢复及删除保护单场景、网页草案确认通过，类型错误已收尾；原局部修复2/2 + 额外授权1/1保留，05集成轮次另记。**
- **目标/需求：** FR-10；TECH_SPEC §12.2。手动/字节或revision阈值触发规则去重 draft，确认/拒绝/恢复追加审计；永久删除不可复活。
- **依赖：** V8-03，不依赖外部 Provider。**文件范围：** apps/core/src/modules/memory/{service,markdown,routes}.ts；拟新增同目录 compaction-service.ts；packages/contracts/src/memory.ts；必要加法迁移单列；聚焦 apps/core/tests/memory-routes.test.ts（已有）。UI 集中 V8-05。
- **不做：** 静默应用、删除 L0、语义猜测、跨scope合并、外发或旧draft复活内容。
- **验收：** 来源/diff/预算可审阅；确认前投影不变，确认及恢复追加版本，拒绝只记决策。
- **最小检查：** 1 成功：同一scope手动/阈值draft→拒绝/再申请确认→追加恢复；必要1阻断：永久删除后旧draft确认/恢复均拒绝。只覆盖此生命周期，不铺完整崩溃矩阵。
- **证据：** Terra执行 `npm test --workspace @ev/core -- tests/v0.8-memory-compaction.test.ts` 最终exit0、1文件1/1；legacy手动草案/复用/拒绝/确认/恢复，实体字节阈值草案，删除后旧草案不可确认/恢复。事务与有界读取整改已落盘，migration25删除触发器清草案正文/diff/来源及baseline。主Agent重验实体单场景于01:45:05 exit1（1文件1失败）：删除后restore原404变成409。不能把单独压缩PASS当本任务整体通过。**下一步：** 见下面唯一升级包，未经新授权不修复。

## V8-05 — 统一协调与一次浏览器收口

- [x] **状态：DONE（实现完成、最小跑通、限定复核通过）；按最新连续收尾授权累计4轮修复，旧1/2与历史FAIL不改写；真实Provider未验证、生产未部署。**
- **目标/需求：** FR-04/11/12；TECH_SPEC §12.3。复用 daily-plan 事务/版本，仅一个 owner/date 活跃协调 proposal，其他类别并存。
- **依赖：** V8-02、V8-04。**文件范围：** apps/core/src/modules/daily-planning/{service,repository,review-service}.ts；apps/web/src/components/projects/project-workspace.tsx、apps/web/src/components/memory/memory-workspace.tsx；必要加法迁移单列；拟新增 apps/web/e2e/v0.8-project-memory-coordination.spec.ts；必要阻断用已有 apps/core/tests/daily-planning-service.test.ts。
- **不做：** 重建 daily-plan、全类型 proposal 唯一锁、领域直写 Event、版本发布/安装/真实 Provider。
- **接线范围补充：** 可补充 routes/daily-planning.ts、app接线、contracts、projects Brief只读查询与页面刷新读取、daily-plan/today组件及必要运行版本常量/package/lock字段。复用现有请求日志，记录模块、mode、耗时、状态、Brief/Proposal/revision ID与跳过原因；不记录正文。支持文件属于本项页面/观测收口，不另开功能版本。
- **验收：** 项目与记忆来源可见，协调替换后旧候选不可确认；Owner/日期唯一约束不妨碍其他 proposal 类型。
- **最小检查：** 全版唯一1成功 browser happy path：合成已授权项目→静态Brief→确认Action/TimeRequest→记忆草案审阅→统一协调proposal，显示来源与静态模式；必要1阻断以Core聚焦场景证明 stale确认409且排程不变。并发/唯一性结合事务与索引静态审阅，不另开测试矩阵。
- **证据：** Terra Max执行 `npm test --workspace @ev/core -- tests/v0.8-coordination.test.ts`：RED exit1（新路由404）；首次实现exit1（幂等operation CHECK不接受daily_plan.coordinate），局部修复1/2复用既有daily_plan.generate操作分类后GREEN exit0，1文件1/1。断言覆盖多源、所有已确认块避让、生成不写Event、替换唯一活跃候选、确认与重复/过期保护。migration26追加唯一约束与mode，未改1～25。项目Brief读取接口与页面已接线但未浏览器验收。**下一步：** 同一05继续记忆/协调页面、版本同步及集中受影响检查，剩余局部修复1次；不重新跑协调RED或扩大测试。

## 历史与本轮文档证据

### 2026-09-08 连续收尾检查

- 主Agent核对根项目和apps/core、apps/web、packages/contracts、packages/domain的package/lock版本及内部依赖，均0.8.0，最终只读检查exit0。首次PowerShell辅助命令因空JSON属性和可选dependencies读取失败，修正读取方式后重验；属于诊断脚本错误，不是应用测试通过证据或业务修复轮次。
- 两页面各新增一个scope竞态定点测试，Terra按TDD修复；原Astra仅复核这两项修复的身份/代际边界，不再重复后端整版审查。测试、构建与最终结果待实际输出。
- **限定复核：** 原Astra medium已将MEMORY-SCOPE-01、PROJECT-SCOPE-02均判ADDRESSED；对象代际可区分A→B→A，切换清除旧内容/审核状态/busy，读写/草案/决定/恢复的成功、失败与finally均绑定代际，操作前检查document/Brief/草案身份与当前成员。未发现修复新P1。末次稳定Git blob：memory页面`42c5aa444aacec228bd4a6d2bab6b1285fc077e2`，project页面`896833765a02c31fa3396855fbb12bb5a501851f`，两测试依次`3e2685ff8f8c89a8c4668bd57ef6aef9eda26eb0`、`e7acb08bfa1be5ba88531aa6e803475390ee3171`。仅静态复核，动态结果待Terra，不伪称所有异步排列均覆盖。
- **最终最小检查：** Terra Max在最终业务工作区执行以下命令，均exit0；主Agent核对两页面/两测试blob仍与Astra复核完全一致、Playwright `.last-run.json`为passed/failedTests空，并复核末次变更，不重复运行同一测试矩阵。

| 实际命令 | 命中 / 结果 |
| --- | --- |
| `npm test --workspace @ev/web -- tests/v0.8-memory-scope.test.tsx tests/v0.8-project-scope.test.tsx` | 2文件2/2；有效RED曾2失败，GREEN后绑定最终代码 |
| `npm test --workspace @ev/core -- tests/v0.8-project-cli.test.ts tests/v0.8-project-brief.test.ts tests/v0.8-entity-memory.test.ts tests/v0.8-memory-compaction.test.ts tests/v0.8-coordination.test.ts` | 5文件5/5；包括v22→26旧记忆兼容、删除防复活、项目不写原目录、确认与协调保护 |
| `npm run typecheck --workspace=@ev/contracts --workspace=@ev/core --workspace=@ev/web` | 3 workspace通过 |
| `npm run build --workspace @ev/web` | 通过；NEXT_TELEMETRY_DISABLED=1 |
| `node scripts/run-e2e.mjs 'v0.8-project-memory-coordination.spec.ts'` | 唯一主路径1/1，最终runner exit0；关闭遥测、仅loopback请求、独立3217/4327与合成数据 |
| `git -c core.safecrlf=false diff --check` | exit0；主Agent最终独立复用同命令核对 |

- **V8-05累计4轮，不重置：** ①既有幂等operation CHECK兼容；②两页面代际保护与四类类型修正；③单E2E精确定位及新Owner无记忆GET404识别；④E2E用例通过但runner缺失未运行的V07证据而退出1，定点修正为仅精确V8单spec不执行V07归档，其他调用保留原校验。历史失败不改写，第③④均为同一浏览器场景的局部修复重验，非新增场景/矩阵。
- **日志与浏览器限制：** 协调同一Core用例断言request/run/proposal ID、LOCAL_RULES、状态、耗时、skips及无合成正文/密码/会话凭据；浏览器仅将精确新Owner空GENERAL GET404与其响应数量对应，其余warning/error/pageerror仍失败。不是“所有HTTP皆200”或绝对零console诊断，也不是全部异步路径动态穷举。
- **资源：** Terra确认隔离3217/4327已停止监听；成功run合成目录由runner清理，失败诊断目录保留。没有启动用户preview、触碰日常数据、安装/真实网络/模型/发布。最后只待runner/Today小范围收口复核及文档完成，不进入v0.9。
- **收口限定复核PASS：** Astra medium只检查后续runner/精确404诊断/Today模式透传，未发现新P0/P1。精确单V8 selector才不要求未运行的V07归档，其他调用保留原读取/校验/复制，真实Playwright退出码未强行置零；404仅按精确路径/文案与GET响应总数上界匹配，不是逐请求配对，P2记ROADMAP。Today仅透传实际mode，不改外发批准门禁。主Agent核对hash一致：runner`3d3d6fcd4703ec2bce4d7b85da03902bd2d96ddf`，E2E`24a909c59a92d2b8bac7e332ca979744076b38cc`，today契约`8f455698145f9a4b467a17902d6e91c487dd6bfb`/路由`72ec8f87efaa17581526d1658287b8f6c5c5280f`/组件`d4a11d4caf30465558377e5ed2d54ce943f224d7`。独立复核未重跑测试。
- **最终界限：** V07三个文件SHA256仍与原限定复核一致，历史整版FAIL保留。Next构建将next-env.d.ts从.next/dev/types切换到.next/types，为生成文件而非业务变更；build通过后无需为了文档重复构建。没有全仓test/lint、全迁移、多设备矩阵或真实Provider验证。HEAD仍50b5338，所有修改未提交，最终冻结交接见[本地验收](../docs/releases/2026-09-08-v0.8-local-acceptance.md)，本任务到此停止。
- **文档最终核对：** 主Agent检查12份规范/验收文档、91个本地相对文件链接，无缺失；diff --check exit0，暂存区为空。最终业务验证后仅修改文档，未再改实现或测试，不重复运行应用检查。

### 2026-09-08 继续授权

- 用户对上一轮“是否授权额外一次受限修复”的请求回复“继续任务”。仅追加一次修复机会：调整legacy/entity两处RESTORE的缺失revision与expectedVersion检查顺序，保持事务、删除边界和原测试断言。
- 原V8-04的2/2及以下FAIL历史保留，不重置预算。仅重验两个既有记忆单用例；此次失败即停止，通过后继续已批准的V8-05。实现委派原Terra Max，主Agent核对证据与后续契约；无提交/网络/真实数据授权。
- **结果：** Terra仅改service.ts与entity-service.ts两处校验顺序，执行 `npm test --workspace @ev/core -- tests/v0.8-entity-memory.test.ts tests/v0.8-memory-compaction.test.ts`，exit0，2文件各1用例、共2/2；未改测试断言/迁移。主Agent读取两函数核对；独立gpt-6-astra/medium复核缺源404、陈旧版本409、事务/beforeProjection与parent/source保持，通过且未重复运行测试。原2/2 + 额外1/1已用。03/04恢复最小通过，不外推整版发布。

### V8-05 集中检查点（待最后一次修复）

- 页面、精确单browser spec与0.8.0版本字段已落盘，但没有因此标DONE。`npm run typecheck --workspace=@ev/contracts --workspace=@ev/core --workspace=@ev/web` exit1；contracts通过，Core/Web失败。
- 失败位置：coordination-service.ts:150/157/158联合类型收窄never；cli/projects.ts:36/37索引token可能undefined；compaction-service.ts:454/593/642可选日志字段不满足exactOptionalPropertyTypes；entity-detail-workspaces.tsx:134旧根路径类型不兼容新增docs/plans路径。最后一项为V8-02共享契约的直接消费链，不扩展功能或放宽安全校验。
- 当前1/2局部修复不变，待Astra限定只读审查结果合并到剩余一次修复。memory重验、web build和browser暂未运行；上述FAIL保留，不能把contracts单独通过当作类型检查整体通过。

### V8-05 独立聚焦审查与受限收尾包（历史停止点）

- 实际gpt-6-astra/medium只读复核，复用协调1/1证据，不新增测试。Spec/Quality均未通过，P0=0/P1=2；主Agent读取对应函数确认因果。未观察真实数据受损或跨Owner越权；同Owner实体误写/误确认风险已触及用户约定的严重数据边界停止条件，暂停相关开发，不把它静默算作通过。
- **V8-05-MEMORY-SCOPE-01 / P1：** memory-workspace.tsx:189起，save/restore/confirm/restoreDraftSource的响应直接setDocument/setDraft，loadSequence仅保护loadIdentity。复现路径为延迟A的写请求→切换B并加载→A响应覆盖B编辑器→B基版本恰好相等时再次保存，会以B路径提交A内容；旧草案响应亦可留下A的确认按钮。预期切换后旧操作结果不能成为新scope的内容或动作；实际无统一scope代际校验。静态证据Git blob `9f2d4914db4a5501ac340ec9f5f55a6192586fc2`，未伪称浏览器已复现。
- **V8-05-PROJECT-SCOPE-02 / P1：** project-workspace.tsx:83的refreshBriefs、createBrief响应无当前scope守卫，selectScope不清briefs/proposals。延迟A列表→切B→A返回覆盖→在B选择状态确认A的Proposal，后端按合法A proposalId创建A的Action/TimeRequest。预期审核列表与当前项目绑定；实际可能误导确认其他项目。静态证据Git blob `0c68233048d4a45fda0ded85dfec0b16f26918f2`。
- 后端限定静态复核未发现新增P0/P1：协调的替换/确认使用现有事务、版本、幂等，26索引仅约束daily_plan_proposals；记忆删除使草案失效；入口明示LOCAL_RULES。该结论不等于动态全量验证。
- **拟议修复范围（待用户确认）：** 同一05最后一次局部修复，覆盖两页面全部加载/生成/决定/恢复的identity+请求代际守卫；切换同步清空旧审核状态，禁止对非当前实体内容/草案提交。合并上述四类集中TypeScript错误的最小修正（协调联合类型、CLI参数判空、可选日志字段、详情路径类型）。不改迁移1～26、不更换架构、不处理P2、不使用真实数据，不增加修复预算。
- **拟议最小验证：** 两个页面各一个可控延迟响应定点用例证明A→B后无旧实体可提交状态（不能把竞态塞入浏览器矩阵）；集中受影响workspace typecheck、web build；只重验已受最终改动影响的V8单场景文件；仅一条既有新建v0.8 browser spec。精确命令和实际命中数届时记录，现未运行。再次失败停止；仅针对修复diff复核，不重开整版审计。
- **版本和交付：** package/lock/APP_VERSION等已改0.8.0字段，但这是未验收的本地开发工作区，不是v0.8完成或发布。未stage/commit/push/tag/Release，真实Provider、个人数据、生产环境均未验证，未启动v0.9；不建议将当前工作区用于日常记忆/项目管理。
- **停止确认与证据有效性：** Terra确认暂停后零写入/零测试，剩余1次未消耗；主Agent停止时核算两页面Git blob与Astra快照完全相同，HEAD仍50b5338，diff --check exit0、暂存区为空。V07三个文件SHA256仍与独立限定复核报告一致，复用该限定证据、不重跑v0.7。本轮所有新跑通均为隔离合成数据及LOCAL_RULES；尚未运行browser、web build、真实Provider或生产部署。

### 2026-09-08 最小升级包（停止点）

- **现象/复现：** `npm test --workspace @ev/core -- tests/v0.8-entity-memory.test.ts`，01:45:05 exit1，1文件1用例命中，198行预期删除后restore为404，实际409。前面的升级/写入/编辑/恢复/投影断言已执行，但整用例为FAIL，不把中途断言当整项PASS。
- **根因：** V8-04在legacy与entity的append函数中将expectedVersion检查放在缺失恢复revision检查之前。删除后current为空，先触发MEMORY_VERSION_CONFLICT，而非原MEMORY_REVISION_NOT_FOUND。观察到的是兼容性/验收回归，未观察到内容误恢复或真实数据损坏。
- **拟议最小修复（未授权、未实施）：** 仅调整两处恢复校验顺序，使缺失revision优先404；存在revision但基版本过期仍409。所有校验保持在当前事务内，保留beforeProjection回调/来源关联及删除防复活设计；不放宽或删除测试断言，不改迁移。
- **拟议验证：** 仅重验 `tests/v0.8-entity-memory.test.ts` 与 `tests/v0.8-memory-compaction.test.ts`（各1用例）。通过后再恢复V8-05，不加整版矩阵。
- **停止理由：** V8-04累计2/2已尽；不能转计V8-03的剩余次数、换模型或改任务名重置。代码保留未提交原状，等待用户对上述受限修复的新授权。
- **V8-04轮次明细：** 初始RED为compaction单用例exit1、路由缺失；第1轮hook接线/lint，第2轮事务原子性、有界历史读取及删除baseline生命周期收口。实现Agent已明确停止，未修复新发现的错误优先级回归。
- **独立聚焦复核：** 实际gpt-6-astra/medium只读确认entity-service.ts:269与service.ts:139的顺序遮蔽404；没有数据损坏证据。建议同一事务内先查RESTORE源、缺失404，再验证existing版本；保留普通WRITE版本检查和beforeProjection写入边界。未新增测试或修改代码。复核读取时TASKS旧计数尚未刷新，现已统一记录2/2。
- **最终未受影响检查：** 01:46:23执行 `npm test --workspace @ev/core -- tests/v0.8-project-cli.test.ts tests/v0.8-project-brief.test.ts`，exit0、2文件2/2，绑定当前未提交工作区。V8-01/02维持DONE；03 PARTIAL、04/05 BLOCKED。
- **V07证据有效性：** 停止时重新计算nutrition repository/service/定点测试三个SHA256，均与独立限定复核报告一致；没有重跑历史全量矩阵，不把该限定PASS扩成v0.7整版PASS。
- **未运行/未交付：** 最终workspace typecheck/build、浏览器happy path、协调与新记忆/Brief页面接线、0.8.0版本同步、真实Provider/个人项目/生产环境均未完成；应用版本仍0.7.0，未stage/commit/push/tag/Release，未启动v0.9。
- **文档收口检查：** 22份规范/迁移入口文档、124个本地相对链接，无缺失（exit0）；git diff --check exit0，仅换行格式提示。HEAD仍50b533804be24f8963492679127f72e39ff4f7dd，分支codex/product-prd，暂存区为空。没有采集新的真实用户反馈。

收口证据提醒：V8-02复用/调整CLI共用路径工具，V8-04将接入旧/实体revision hook；故V8-01与03的上述成功是切片时点证据，不直接当最终工作区结果。V8-05完成后对实际受影响的独立单用例集中重验；不扩为旧suite或矩阵，未变化的V07限定证据仅做有效性判断。

V8-01 RED：对应定点命令exit1、1用例，CLI文件缺失。V8-02 RED：对应定点命令exit1、1用例，briefs路由缺失（503预期实为404）。Terra记录功能性修复均0，V8-02另有一次lint清理；此处保守计入预算。V8-03开始使用独立Terra Max上下文，只处理尚未开始的记忆任务，不重置01/02预算。继续遵守用户小检查要求，替代技能默认的独立进度账本、五轮修复、全量复核与自动提交。

V07 定点收尾：Terra Max 实现，Astra medium 独立复核。`npm test --workspace @ev/core -- tests/v0.7-lineage-015.test.ts` RED exit 1（1用例）；两轮局部修复后 GREEN exit 0（1/1），Core typecheck、目标三文件 ESLint、scoped diff check 均 exit 0。独立复核同一用例 exit 0（1/1），报告绑定三个文件哈希。冲突受控409、没有食物快照/revision/Meal部分持久化、错误草稿无法确认，正常确认通过。修复预算已用2/2；没有运行整版矩阵。后续若共享代码改变，须判断该证据有效性，不将其扩大为历史整版 PASS。

原 .agent/current-task.md、.agent/goal-state.md、tasks/plan.md、tasks/todo.md 的完整原文保存在本地 Git 提交 `50b533804be24f8963492679127f72e39ff4f7dd:<原路径>`，旧入口保留同一定位；不复制原进度。阶段历史见上述 release/review。

文档迁移、批准记录和链接检查不计为 V07/V8 业务通过；实际最小测试与修复证据随各项实施填写，不复制历史全量成功日志。
