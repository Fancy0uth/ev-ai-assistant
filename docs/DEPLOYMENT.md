# Windows 本机运行与运维边界

## 当前使用说明与交付边界（2026-09-20）

正式入口为 `https://127.0.0.1:3443`，使用既有Owner登录；仅本电脑访问，不含手机、公网或局域网。本轮限定MVP验收已完成，证据及限制见[唯一进度](../plans/TASKS.md)顶部。当前浏览器显示登录页，使用原账号密码登录；账号与配置已保留。下文旧阶段的未授权/未部署记录为历史，不覆盖顶部当前说明。

- 日程与课表：先建立学期，上传截图，核对外发说明后识别；修改课程候选并确认课程，再单独接受排程提案。自然语言事项也须先勾选外发确认，核对日期、时间和冲突，必要时调整，再确认提案。
- 学习：建立课程并填写学习阶段，主动执行公开资料检索，查看引用URL与来源，再选择资料生成学习建议；接受建议创建待办和时间请求，到每日计划单独确认排程。公开检索限既有中/英文Wikipedia，不是全网或课程官方资料。固定检索页通过MediaWiki读取导言，非全文；内容变化会阻止复用旧引用。任意用户链接仍受原公开DNS安全规则约束，本机代理地址可能使其不可读取。
- 训练：进入详细训练，选择力量目标，填写器械、限制并如实核对一般成人适用声明，保存画像及当天状态；保留慢走和至少一种具备相应器械的力量动作。候选及草稿里可展开NHS/AHA公开依据、日期及摘要hash，核对实际外发预览后才生成。接受训练提案与接受日程是两个动作，反馈填写实际完成情况。当前公开依据组合限健康、日常运动、19–64岁的一般成人，排除声明列明的健康风险/孕期/近期产后等情况；不确定或不符合时请先咨询专业人员，不能为生成建议勾选。其他详细目标暂缺完整依据；1324条外部动作仍不可用于自动规划。疼痛或急性风险保持阻断。
- 本组合只复用慢走、椅子坐站、靠墙俯卧撑，不是医学认证或个人专业审核，也不是覆盖全身所有肌群的完整长期训练方案。慢走热身/放松各5–10分钟；力量动作的阶段和次数受公开来源约束。每次3秒、组间60秒和转换30秒是产品排程估计，非来源声明的医学上限；需要更久休息时应停止并调整，不能赶时间。官方页面核验于2026-09-20，保存的是版本化摘要与出处，不自动监测网页更新。
- 训练审阅页的结构化总时长由本地逐项核算，排程窗口是预留时间。模型标题和自由文字可能把预留时间与实际动作时长混淆；本次真实输出曾出现文字178秒但结构化144秒，不能用自由文字替代参数核对。来源/参数/预算不合规的结构化输出仍会拒绝保存，不自动重试付费调用。
- 恢复承诺：已有证据仅覆盖合成Owner/普通任务关闭重开、SQLite备份校验并恢复到新目录，以及合成artifacts/memory侧车hash一致。未验证真实课表附件引用完整恢复、DPAPI凭据跨用户/跨主机恢复、整机重启或灾难恢复；不得只备份SQLite就宣称全量可恢复。保留数据目录、附件、memory及运行配置，实际恢复不覆盖活跃库。

电脑睡眠、关机或用户未登录时不保证07:00执行；服务运行后按现有规则补当前日并仅生成待审核建议，不自动写入日程。

## 服务器MVP实际验收方案（用户已授权执行）

本轮默认部署到当前Windows主机，电脑浏览器使用`https://127.0.0.1:3443`；Core为`127.0.0.1:4341`，Next为`127.0.0.1:3041`。数据目录为`%LOCALAPPDATA%/EvAiAssistant-mvp`、日志`%LOCALAPPDATA%/EvAiAssistant-mvp-logs`，与旧预览/测试数据分离。不暴露公网或局域网，不改变防火墙。

生产运行继续使用既有Windows启动器及真实Core/Next入口；WebOrigin固定上述HTTPS地址，不能降低生产Secure-cookie/Origin检查来绕过部署。当前机器未发现Tailscale命令，替代方案为官方Caddy本机TLS反向代理，已准备[配置](../scripts/windows/Caddyfile.local-mvp)。[官方说明](https://caddyserver.com/docs/automatic-https)支持本地地址内部CA；该配置关闭自动信任安装和HTTP跳转，固定loopback绑定。配置由官方Caddy v2.11.4解析验证；实际证据及待办只见TASKS。

授权后的具体动作顺序：

1. 从Caddy官方发布获取Windows二进制并核验对应校验和，放入独立工具目录；不使用不明安装脚本。先验证配置。
2. 对最终实际运行的repo建立生产Web构建，不能把带Core junction的验证副本直接登记为服务器；复用已验证源码，不覆盖任何用户库。
3. 启动本机Caddy生成该实例CA，经核对指纹后仅导入当前用户的Root信任库。记录精确指纹供回退；不修改系统级根证书库。
4. 用既有`ev-dashboard.ps1`指向新数据/日志目录及4341/3041，WebOrigin固定`https://127.0.0.1:3443`。确认登录、Cookie/CSRF、Core ready及最小业务路径，再登记当前用户登录自启任务`EV AI Dashboard MVP`和独立TLS任务。主机睡眠/关机/用户未登录时不保证07:00按点执行，启动后只补当前日。
5. 先使用合成MVP记录做一次关闭/重开与恢复演练。SQLite CLI按既有create→verify→restore写入全新恢复目录；同时保留artifacts本体、memory投影及必要配置/证书状态，单一SQLite备份不能称全量恢复。核验恢复记录及引用文件后再讨论真实用户数据迁移；不覆盖活跃库，不自动重启整机。

回退方案是停止仅本轮拥有的进程/任务，撤销本轮记录指纹的当前用户CA信任，保留MVP数据、备份和日志；不删除旧用户目录或系统依赖。本方案中的安装、当前用户信任、自启和合成验收已获明确授权；真实密钥付费调用、旧个人库迁移仍需单独授权。实际进度只见[TASKS](../plans/TASKS.md)。

> 本轮范围更新：手机端已退出MVP，服务器Core/Web与电脑浏览器操作保留，依据[PRD](PRD.md)最新修订。下文专为手机的私有访问及物理iPhone步骤是历史方案，不属于本轮必做验收；不因取消手机而放宽现有生产HTTPS/认证要求，其他服务器运行和恢复边界不变。

## Codex 集成已退出运行要求（2026-09-16）

用户取消项目分析与专属 Codex 集成。运行 EV 不需要构建 Codex 容器、登录 Codex、授权项目目录或启动认证网关。现有 Windows Web/Core、DPAPI 凭据与预览数据位置不因该调整改变，DeepSeek 配置保留。

历史隔离/认证试验见 [C1 记录](../plans/evidence/2026-09-16-codex-c1-r3.md) 与 [C2 记录](../plans/evidence/2026-09-16-codex-c2-auth.md)，不是部署步骤。用户取消前未完成真实登录或推理验证，不应恢复旧任务。已创建的诊断镜像、停止的容器、传输卷与下载缓存本次保留；不卸载 Docker、独立 Codex 或改动其他容器。若需释放这些主机资源，另行列出准确目标确认清理。

> 当前代码0.9.0；本地检查与未测试范围见[V9验收记录](releases/2026-09-08-v0.9-local-acceptance.md)，唯一进度见[TASKS](../plans/TASKS.md)。本轮只运行隔离合成数据，未启动用户日常预览、未验证真实Provider或生产部署；首次体验仍建议独立数据目录，不直接迁移日常库。

## 已核对配置

Windows 10/11 优先；根 package 要求 Node >=24 且 <25。本轮本机核对 Node 24.18、依赖存在，不安装依赖；隔离合成测试可以启动本机服务，不代表生产部署。Frontend 为 `apps/web`，backend 为 `apps/core`。

配置来自 [config.ts](../apps/core/src/config.ts)、[根 scripts](../package.json) 与 [Web env 示例](../apps/web/.env.example)。Core 拒绝非 `127.0.0.1`，默认 4311；Web dev 固定 `127.0.0.1:3000`。无预设 Owner 或默认密码。

## 之后获准进行本机预览时

两个 PowerShell 终端均进入仓库根，选择独立预览数据目录，不能指向生产或测试目录。以下为运行说明，本轮未执行：

终端 1：

```powershell
$env:EV_DATA_DIR = 'C:\Users\asus\AppData\Local\EvAiAssistant-preview'
npm run dev:core
```

终端 2：

```powershell
$env:EV_CORE_URL = 'http://127.0.0.1:4311'
$env:EV_WEB_ORIGIN = 'http://127.0.0.1:3000'
npm run dev:web
```

BFF环境需固定Core上游及单一Web origin（参考env示例；已有.env.local不覆盖）。浏览器地址必须与EV_WEB_ORIGIN一致：配置127.0.0.1就不要改用localhost。缺失/无效origin返回WEB_ORIGIN_CONFIGURATION_ERROR，不是密码错误。以上为本地dev HTTP说明，production模式要求显式HTTPS origin。打开 [本机 setup](http://127.0.0.1:3000/setup) 自建唯一Owner，之后从login登录。

V8页面接线后的操作路径如下；这是代码对应的操作说明，浏览器是否已验证必须查看 [TASKS](../plans/TASKS.md)，不能据此宣称整版交付。本轮没有启动一个供真实Owner使用的新预览。

1. setup/login → `/today` 查看日程 → `/tasks` 管理普通工作待办；不再授权本地项目或生成 Project Brief。
2. `/memory`管理既有分域/实体记忆；生成LOCAL_RULES压缩草案，查看来源、预算和差异，再确认或拒绝。确认及恢复均追加版本；永久删除后不得恢复原内容。历史项目记忆保留数据兼容，不恢复项目分析。
3. `/daily-plan?date=YYYY-MM-DD`选择“按本地静态规则协调”，查看安排、来源、冲突及未安排原因；确认后才写回日程。`/today`的今日计划入口可继续审核。

LOCAL_RULES是确定性本地规则，不是Fake回复或真实模型调用。外部Provider流程保留未配置/不可用状态，本轮没有真实Provider、个人项目或健康数据验证。

## 本地日志

V9的Core日志统一经过allowlist，保留受控事件、状态、耗时及关联ID，不落盘URL/路径、原始error/stack、req/res、凭据或业务正文。EV_LOG_DIR为日志根，实际JSONL位于其受限runtime子目录，固定current.jsonl与3个轮转文件、默认每文件5 MiB、单事件8 KiB；runtime-tmp临时文件不属于该轮转范围。目录权限或磁盘写入失败时日志降级，不能把缺少日志当作业务成功。实现与限定验证/剩余修正只见TASKS，本轮不证明真实长期运维。

## 数据目录

### 历史项目数据

项目目录授权 CLI 退出产品，不再执行 `projects:authorize`。已有数据库中的项目来源与关联事实不清除；代码功能退役不是数据清理操作，也不授权删除用户磁盘上的任何项目目录。

### 存储布局

未设置 EV_DATA_DIR 时，Windows 默认 `%LOCALAPPDATA%\EvAiAssistant`；配置最终解析为绝对路径。SQLite 为 `app.sqlite`，WAL 状态属于同一数据库；现有记忆投影为 `memory/GENERAL/MEMORY.md`，其他三域使用同样的 `<scope>/MEMORY.md` 布局。具体表与迁移见 [DATABASE](DATABASE.md)。预览、测试、生产数据必须隔离，不删除/重置既有数据。

## 停止与回退

开发终端用 Ctrl+C 停止对应服务；不要按端口批量杀死未知进程。应用关闭时执行现有 SIGINT/SIGTERM 清理。更换代码版本不等于回退数据库：追加迁移后的库不能假定被旧代码兼容。回退只在独立副本与已验证一致备份上另行确认，不能清库或覆盖 Owner 的日常数据。

Docker 本轮延期：Windows 密钥保护和本机目录 ACL 尚未证明可移植到 Linux 容器，因此不提供伪可运行的 docker-compose.yml。

## v9 本地工具与真实部署边界

Windows启动脚本、SQLite-only备份CLI和脱敏日志实现已落盘；是否达到本地限定验收见TASKS。真实常驻、自启动、私有HTTPS及物理iPhone证据仍未完成，路线见[ROADMAP](../plans/ROADMAP.md)。不要使用旧蓝图中不存在的evctl命令。

备份CLI通过SQLite backup API获得新快照，转换为独立DELETE journal快照后生成manifest；不复制活跃db/wal/shm。只在隔离副本验证，不提供活跃换库开关。精确命令见[API](API.md#v9-核对起点与目标接口尚非运行证据)；所有路径需显式选择，新备份/恢复目录应在活动数据目录之外、不与源重叠且原先不存在。本轮只检查合成数据，未进行日常库备份、恢复或网络操作。

不建 compose，不把 Core 暴露 LAN/公网。真实 API/网络/数据/项目/凭据/安装/系统服务/生产/push 需另授权。

## V9 增量运行约定（本地实现已落盘，真实部署待验）

现行设计为[TECH_SPEC §13](TECH_SPEC.md#13-v9-私有运维增量设计冻结)，01～06实际状态、检查结果只记[TASKS](../plans/TASKS.md)。上文本地开发命令仅描述已有入口；V9启用Origin安全检查后Web还需显式`EV_WEB_ORIGIN=http://127.0.0.1:3000`，不是Core地址。隔离runner及Playwright config均须传`EV_WEB_ORIGIN=http://127.0.0.1:3217`，Core上游4327；不得从Host/forwarded推断。真实私有HTTPS origin由用户选择，本文不虚构域名或已可达URL。

Windows launcher/install/uninstall及backup CLI参数已按实际源码登记；Core仍运行tsx源码，Web start要求既有build，没有独立migration CLI或Core dist。WhatIf不意味着获准真实注册/删除任务。仅测试本次临时目录，不改日常Owner目录ACL；Node mode0600、LOCALAPPDATA路径及DPAPI CurrentUser均不证明Windows文件ACL。当前共用权限工具只支持Windows，其他平台fail closed，不代表Docker/Linux已适配。

SQLite-only备份包含库内事实/密文，不含artifacts本体、memory投影、日志、外部项目与DPAPI用户环境。不能把它称作全备；孤立SQLite恢复可保留引用但并不保证引用文件或密钥可用。verify只读，restore仅新隔离副本；实际停服/换库/回滚与侧车/凭据恢复须另授权，不执行真实备份恢复，也不覆盖活跃库。

### Windows launcher 参数（V9代码已落盘，当前只验证mock）

使用PowerShell 7；本轮工具环境实际为7.6.5，未安装新软件。Node24与已有依赖、`apps/web/.next/BUILD_ID`是前置条件。launcher运行生产`next start`，只接受HTTPS WebOrigin；仅需HTTP本机预览时使用前文dev命令。参数均显式绝对路径，例中的路径/域名不是已获准操作目标：

```powershell
pwsh -NoProfile -File ./scripts/windows/test-launcher.ps1 -RepoRoot 'C:\path\to\repo' -DataDir 'C:\path\to\ev-data' -LogDir 'C:\path\to\ev-logs' -WebOrigin 'https://your-private-host.example' -CorePort 4311 -WebPort 3000
```

`test-launcher.ps1`只展示WhatIf计划；`ev-dashboard.ps1`接同样的RepoRoot/DataDir/LogDir/WebOrigin/CorePort/WebPort参数，实际运行会启动Core并可能执行现有加法迁移，需先授权精确数据目标。`install-autostart.ps1`和`uninstall-autostart.ps1`另有TaskName（默认`EV AI Dashboard`），均支持`-WhatIf`；实际注册和删除必须另授权。当前用户登录触发不是无用户登录即可运行的系统服务。

WebOrigin为外部HTTPS地址，WebPort为本机loopback端口，两者不必相等；Core始终127.0.0.1。脚本显式传生产模式、安全Cookie及Core端口。后台进程隐藏，无真实反向代理/Tailscale配置，也不安装依赖。TestAdapterPath/RunOnce为隔离测试用途，不用于日常部署。尚未验证真实子进程启动、异常结束及主机重启。

### 实机步骤

每项执行前取得用户对精确设备、目标和动作的单独授权；主Agent不能自行替代。未授权或无证据填NOT RUN，不用本地检查勾选：

1. 用户选定私有HTTPS origin及私网身份范围，另行批准Tailscale安装/登录/Serve、证书或防火墙动作（如需）；只代理loopback Web。记录脱敏配置、时间、证书有效性及未认证私网身份不可达的证据，不公开真实URL/凭据。应用Owner认证独立于私网认证；首次setup应在受控本机完成，不能把未初始化Owner的入口交给非Owner。
2. 只读核对实际监听与代理目标：Core仅127.0.0.1、无LAN/公网Core入口，Web为唯一私有HTTPS入口。配置文本或单元测试不是实际监听证据；不得用开放Core绕过网关阻塞。
3. 在用户批准真实精确任务注册后验证当前Owner最低权限启动、失败回收、重复启动保护；另获重启权限后验证主机重启/登录自启动、数据目录一致与就绪。WhatIf/mock只证明脚本局部行为。卸载也需精确授权，验证仅移除所属任务、数据/备份仍在。
4. 由用户在物理iPhone Safari记录机型、iOS/Safari版本、视口、时间、HTTPS host类别（不泄露完整私有地址）、证书/身份状态。执行登录→Today→查看已有Proposal依据→确认→刷新核对，确认前无事实写入；检查登出、必要详情页面可读、断线重连后幂等无重复确认。保存脱敏截图及console/network摘要；用户操控实机的确认或实际采集证据才可判通过。桌面移动视口/WebKit模拟不能替代。
5. 另获真实数据备份/恢复及目标授权，先保留原库；核对SQLite manifest与Owner/关键对象计数，列出缺失侧车和DPAPI环境，先在隔离恢复位置验证。若要真实换入，另核准停服、同卷原子替换、失败回滚方案，绝不覆盖唯一可用库/备份。没有artifacts/凭据可用性证据不得声明完整应用可恢复。
6. 汇总本地实现、物理私有访问、真实自启动/重启、真实数据恢复及继承Provider证据债。缺任一必需证据保留NOT RUN/阻断原因，overall PARTIAL；版本0.9.0不代表完整V9 PASS或发布。旧全仓/多迁移/浏览器矩阵本轮明确未执行，不能声称已通过；如用户未来要求原完整门禁，另确认验证预算与权限。

上述V9主路径属于已保存阶段。2026-09-19健身增量另使用一条专用fitness浏览器闭环；只复用已装Chromium，不安装浏览器。专用runner使用Web3217/Core4327、独立managed-run数据及日志目录，不接触3000/4311日常预览。其Fake训练Provider仅在测试隔离门禁通过后注入，日程采用LOCAL_RULES；测试结果与具体命令统一见[TASKS](../plans/TASKS.md)，本文不提前声明运行通过。不进行外网、真实设备探测或系统变更来补证据。

### 健身增量的接入与权限

详细训练计划复用DeepSeek凭据设置和现有Windows密钥保护；配置检测不等于实际生成成功。首次生成前需在页面审阅实际外发上下文并同意，模型收到的是限量候选、授权字段与选定记忆，而不是整个本地数据库。尚未配置时不得用假回复替代；测试Fake不进入日常服务。真实API调用、费用及个人健康数据验证本轮仍未授权。

动作目录导入使用本机CLI，必须显式提供已有数据目录、已有JSON文件绝对路径及固定源revision；不自动下载媒体、迁移数据库或授予动作适用资格。命令及限制见[API](API.md)，真实数据集下载和导入另行授权。训练事实已保存而记忆更新降级时，应保留事实并显示独立状态，不清库、不重复提交反馈来“修复”投影。SQLite升级后的回退仍遵守上方副本/备份边界。
