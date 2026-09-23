# 唯一进度与 V8 / V9 小契约

> 2026-09-08 V9增量规划承接V8限定本地验收。最新授权/小契约见下方V9节，历史V8过程与FAIL保留；技术栈继续Node24 + TypeScript + Next Web/BFF + Fastify Core + SQLite。V8规格为TECH_SPEC §12，V9规格为§13；任务编号分别保留01～05和01～06，不另建plan/todo进度。

## 当前进度

### 2026-09-20 最新指令：取消逐条审核，改按训练部位分类（已完成）

用户取消1324条逐项审核，旧审核计划不再继续。已通过应用工具将自动任务ev设为PAUSED，停止后续查证；保留历史证据，不伪造审核通过记录。使用正式库现有body_part/target标签只读分类，10个主部位、1324个唯一动作，遗漏/重复均0。保留目标肌群、辅助肌群、器械、原说明及来源版本。无网络/模型调用，无生产写入。

交付：[完整分类目录](../data/fitness-catalog/按训练部位分类.md)、[机器可读分类](../data/fitness-catalog/by-body-part.json)、[数量核对](evidence/2026-09-20-fitness-classification.json)。本次为动作资料分类，不改现有训练生成和日程确认逻辑。下方自动审核ACTIVE及待查计划均为历史，已由本条取消。


### 2026-09-20 执行1324条动作公开依据自动核验（进行中）

用户批准五阶段计划并要求执行。采用既有隔离worktree，唯一进度仍在本文件；不重开MVP、不改原专业审核资格字段。范围为现有固定版本1324条，允许为核验查找公开权威依据，不扩充动作目录。

实施顺序：① scripts/fitness-audit/建立版本化证据与逐项结论契约，原始目录只读导出；② tests/fitness-audit.test.mjs最小失败→通过验证来源/变式/hash/断点续跑门禁；③20条试审记录真实检索与原文；④每20条分批处理，复用证据但不按名称相近继承结论；⑤符合依据和用户范围才接入推荐，否则保留缺口。受影响定点测试和一次独立复核后更新交付证据。

Ruling：未知不能补造；“当前证据库无匹配”只能作为初筛缺口，不能声称已穷尽网络或完成逐条深入审核。AI核验不写专业review记录；只用公开动作资料，无Owner健康数据外发。用户已批准计划，常规实现选择不再逐步确认。

已只读导出1324条目录至data/fitness-audit/catalog.json（固定revision 7455efae41b330c265e7cd4b78dfa848e7ce5ebd），未读写账号凭据。尚无新增放行动作。

执行记录：已建立scripts/fitness-audit/engine.mjs、run.mjs及续跑说明，单case先RED后GREEN；聚焦复核发现跨revision/同hash内容变更复用和空内容完整结论两项P2，新增失败断言并修复GREEN，复核确认关闭。全部1324条完成离线队列初始化，只有20条实际对照本轮已打开权威原文：17缺依据、2名称/步骤矛盾、1超出LOW范围，1304仍PENDING_RESEARCH。没有条目放行、没有专业review或生产写入。源摘要hash不是整页hash；独立复核只核对代码及证据内部一致性，未冒称独立重新联网查证。2368静态站姿表述已澄清，保留确实缺少的数值剂量。

已创建当前任务自动续跑“EV 动作公开依据分批核验”（id=ev，ACTIVE，每30分钟触发、每轮最多20条），处理真实查证与后续满足条件的推荐接入；普通批次静默，仅有意义结果/阻塞/完成时通知。任务依赖Codex本机调度可运行，不承诺关机离线执行。首次创建缺destination参数失败，补destination=thread后创建成功，无重复任务。最终审核尚未完成，不能将自动任务已创建写成1324条已审完。启动证据见[evidence](evidence/2026-09-20-fitness-audit-start.json)。



### 2026-09-20 最终交付：本轮限定 MVP 主线达标

**结论：按本轮服务器与电脑浏览器、至少一套有依据动作的验收范围，可以提前交付。** 用户授权的公开权威依据路径已落实；下文“等待依据/调用授权/完整未完成”均为历史时点，不再代表当前状态。未声称所有1324条动作可用或具备个人医学审核。

| 验收项 | 结果与可核对证据 |
| --- | --- |
| 首道依据检查 | 前30分钟已暴露并记录适用依据缺口；随后按用户选择，以NHS/AHA公开指南接入现有3动作，未取消适用声明、风险、来源和参数校验。 |
| 有来源训练闭环 | [真实模型PASS](evidence/2026-09-20-live-fit-guidance-r2.json)：画像/状态/候选→855秒三阶段建议→确认训练→9月21日17:00–17:30日程→完成反馈与memory；确认前Action/TimeRequest/Event均0。 |
| 截图课表 | [PASS](evidence/2026-09-20-live-course-loop.json)：真实模型识别合成截图、修正教室、确认课程/规则、排入两周日程；确认前课程/规则/事件均0。 |
| 自然语言日程 | [PASS](evidence/2026-09-20-live-event-loop.json)：真实模型解析、显示既有课程冲突、改为15:30–16:30、确认后新增事件；此前仅存在原有课程。 |
| 学习与来源 | [真实建议原始记录](evidence/2026-09-20-live-learning-extra1.json)保留脚本排程失败；建议本身已成功，修复脚本后[零模型恢复排程PASS](evidence/2026-09-20-live-learning-schedule-resume.json)，19:00–19:25事件可读。[浏览器来源与日程读回](evidence/2026-09-20-learning-browser-readback.json)通过。 |
| 饮食联网与缓存 | 复用[既有PASS](evidence/2026-09-20-live-web-nutrition.json)，本轮未触及，不重复调用或测试。 |
| 构建与更新 | Core/Web类型检查、受影响定点用例、正式Web构建通过；[正式运行](evidence/2026-09-20-guidance-update-runtime.json)HTTPS/CSRF/Core ready均200且Secure cookie，不绕过TLS。更新前后10表数量/hash一致，Owner/DeepSeek配置各1、动作1324保留。 |
| 电脑浏览器 | 复用之前跨模块抽查，补充[当前训练来源/参数/反馈读回](evidence/2026-09-20-guidance-browser-readback.json)。隔离合成账号密码登录成功；正式HTTPS登录入口可见，当前为退出状态，未冒称最后更新后重输过真实Owner密码。 |
| 恢复与说明 | [使用说明](../docs/DEPLOYMENT.md)已明确现有合成重开/SQLite新目录恢复及侧车hash证据；真实附件完整恢复、DPAPI跨用户/跨主机、整机重启/灾难恢复未验证。 |

交付边界：详细训练当前仅力量目标，候选为慢走、椅子坐站和靠墙俯卧撑；限如实确认适用的健康、日常运动、19–64岁一般成人。其他详细目标及1324条未审核动作继续阻断。公开依据不是个人专业审核，组合不是覆盖全身肌群的长期训练处方；模型标题/文字需人工审阅，结构化来源、次数、阶段、总时长仍严格校验。模型与检索真实验收使用隔离合成数据，未给正式Owner写入合成事项。

收尾：正式Core/Web仍监听4341/3041，HTTPS3443；临时4327/3217已无监听，Next生成类型恢复正式构建路径。临时错误标签页清理受到浏览器URL策略阻止，未绕过，不影响正式服务。没有新付费调用、没有全仓测试、没有提交或推送。最后格式核对仅发现既有MVP-SCOPE.md末尾空行，不是本轮代码阻断，未作无关清理。

### 2026-09-20 实施记录：公开依据接入与部署验收

- 用户明确要求自主继续，不再让其逐步决定。沿已授权公开依据方案直接实施：不新增动作，复用easy-walk、chair-sit-to-stand、wall-push-up；仅本轮一般力量组合，其他详细目标明确缺完整依据而不自动生成。外部1324条仍未审核，不填造临床资格或review记录。
- 新政策PUBLIC_GUIDANCE_GENERAL_ADULT_V1：版本化一般成人适用自述（19–64岁、健康、日常运动、无相关健康事件/疑虑、非孕期/近期产后），未确认/不确定阻断。声明与公开指南摘要、URL、审核/核验日期、摘要hash及参数共同绑定来源citation与预览hash；变更后旧预览/修订确认失效。公开指南不是个人专业审核；3秒/次、60秒组间、30秒转换是排程估计，未冒称医学上限。
- 服务端新增阶段/剂量规则：慢走仅热身/放松各300–600秒；椅子坐站仅主训练1轮5次；墙推仅主训练3组5–10次；要求所选候选覆盖三个阶段。来源变化、旧政策、无声明、错误阶段/剂量、时间超限仍拒绝。旧记录schema兼容读取，旧草稿不能绕过新依据继续确认。
- 定点证据：来源映射case RED→GREEN；适用声明/阶段/剂量/时间预算/撤回声明组合case通过；adapter组合case通过。三个受影响旧测试仅把合成画像及模型输出升级至新指南后3/3通过，保留原重放、确认、反馈、来源篡改拒绝、V1兼容断言；不跑全仓。日志public-guidance-checks、guidance-affected-regression。
- 真实验收：最初脚本合成用户名超32字符在本地失败，零外发；缩短后第1次模型把热身写30秒，被新剂量校验拒绝（[FAIL](evidence/2026-09-20-live-fit-guidance.json)）。删除旧30秒算术示例冲突并明确5–10分钟约束后，第2次模型完整闭环PASS：[来源/草稿/确认/排程/反馈](evidence/2026-09-20-live-fit-guidance-r2.json)。新增真实模型2次、零自动重试，全部隔离合成数据，无正式Owner健康数据外发。通过后不再重复模型链路。
- 已完成一次Astra medium只读聚焦复核：未发现本次变更实质阻断；未跑网络/测试、未全面复审。限制：来源变更保护针对保存的版本/摘要，不自动监测远端网页；无临床认证结论。随后受影响构建、服务器更新和浏览器来源展示均已完成，最终结论见本文件顶部。

### 2026-09-20 用户选择公开权威依据：可行性核查结果

- 用户选择“第二条”，授权先查找公开权威适用依据；覆盖此前不扩充依据来源的限制，仅补现有少量动作依据，不扩大动作库。已实际读取下列官方正文，非搜索摘要推断。先前“只能等待个人专业审核材料”的判断过窄：公开指南可支持限定范围的一般健身指导，但不能记作专业人员已审核当前Owner，亦不能满足疾病康复或个体医疗处方。
- NHS [Strength exercises](https://www.nhs.uk/live-well/exercise/strength-exercises/)（页面审核2024-02-28，检索2026-09-20）：椅子坐站目标5次；靠墙俯卧撑3组、每组5–10次；椅子要求稳固、不滑动、无轮，动作逐步增加。可对应现有chair-sit-to-stand与wall-push-up。未给出的精确秒/次、组间休息、安全最大量不能伪称NHS结论。现有坐站2×6/3×8是工程默认值，不能原样加链接后声称受此指南支持。
- AHA [Warm Up, Cool Down](https://www.heart.org/en/healthy-living/exercise-and-physical-activity/fitness-basics/warm-up-cool-down)（页面审核2024-01-16，检索2026-09-20）：低速活动热身5–10分钟，降低步行速度放松5–10分钟。可对应现有easy-walk；指南不证明将鸟狗式/死虫式任意标为热身或放松有效。仅选5分钟属于指南范围内的产品选择，不代表个体处方；整个组合是产品编排，并非AHA/NHS联合发布的成套计划。
- NHS [19–64岁成人活动指南](https://www.nhs.uk/live-well/exercise/physical-activity-guidelines-for-adults-aged-19-to-64/)（页面审核2024-05-22，检索2026-09-20）：长期未运动、有疾病或健康担忧应先咨询GP，活动强度应匹配能力。NHS [热身页](https://www.nhs.uk/live-well/exercise/how-to-warm-up-before-exercising/)的运动视频安全说明另列受伤/症状/近期健康事件/孕期或近期分娩等需先咨询情形；这些不能由“limitations=[]且无痛”推断不存在。产品若限定健康19–64岁成年人，是保守的产品适用范围，不是宣称官方指南排除其他所有人群。
- 接入缺口已落实到代码：`planning-context.ts`当前无Owner适用声明，只检查limitations与疼痛；`easy-walk`仅ENDURANCE/RECOVERY，力量目标筛选会排除它；`validateWorkoutPlanV2`按所有阶段强制目标一致且缺阶段专属依据，模型可错配阶段。现有external review契约要求qualificationRef/impact与全量数值上限，不能把公开页面填成个人审核或将缺失上限补造为医学事实。
- 建议的有限修复范围：复用3个现有动作（easy-walk、chair-sit-to-stand、wall-push-up），为一般成人指导单独记录PUBLIC_GUIDANCE性质、来源/审核日期/摘录摘要hash、适用声明及版本；不改1324条外部动作的UNREVIEWED状态。步行仅用于热身/放松；坐站/墙推用于主训练；参数按来源约束，工程排程估计与来源建议分开标注；未知/不符合适用条件继续阻断。来源、适用声明和阶段/参数依据必须绑定预览hash，并在生成/修订/确认时重验，保留现有总时长/安全/用户确认校验。这是尚未实施的接入方案，不是通过证据。
- 研究结论：已找到可核验的公开依据，后续具备有限接入路径；“专业材料只能外部提供”的绝对阻塞判断已撤回，但完整MVP仍未完成。未新增模型调用、未修改生产数据、未将公开指南写成临床审核。

### 最新授权：继续完成 MVP

- 用户已明确授权不限次数的真实 API 调用，但不得无理由过度调用；这覆盖下文历史每类一次及等待追加授权的限制。每次仅为验证具体修复或定位实际失败，保留尝试证据，不盲目重试。先复用既有学习检索结果验证修复后的学习/训练输出契约，再完成确认、日程及反馈链路。
- 专业动作适用依据仍为独立缺口；调用授权不替代适用审核，不取消现有校验。已通过的饮食联网/缓存和其余无影响链路不重复测试。
- 13:18学习追加真实调用1次：带引用建议成功，接受后Action/TimeRequest=1/1且Event=0。验收脚本随后漏传生产装配已有的newId回调导致Crypto绑定错误；仅修脚本与生产装配一致，复用保存结果、零网络恢复排程，Event=1（9月21日19:00–19:25）。证据[模型与建议确认](evidence/2026-09-20-live-learning-extra1.json)、[零调用恢复排程PASS](evidence/2026-09-20-live-learning-schedule-resume.json)。首份FAIL保留，不重跑已成功模型/检索。
- 13:19–13:21训练追加4次有依据诊断/验证，每次1模型、无自动重试：extra1漏totalDurationSeconds；extra2替代动作在同阶段重复且572秒误报1253；extra3结构正确但总时长不符。依次补明确必填提示、替代引用/逐项算术示例、逐项计算过程要求；没有修改Schema或时长/来源/安全校验。extra4结构化总时长144秒通过严格校验，草案确认前Action/TimeRequest/Event=0/0/0，确认训练1/1/0，确认排程后出现9月21日17:00–17:30的WORKOUT，合成反馈COMPLETED及memory已记录。证据[extra1](evidence/2026-09-20-live-fitness-extra1.json)、[extra2](evidence/2026-09-20-live-fitness-extra2.json)、[extra3](evidence/2026-09-20-live-fitness-extra3.json)、[完整技术闭环PASS](evidence/2026-09-20-live-fitness-extra4.json)。实际结构化动作耗时144秒与预留30分钟是不同概念；模型自由文字仍错误写178秒和30-Minute标题，不能把自由文字当确定性核算或专业指导，此语义限制未掩盖。
- 本次新授权后共5个模型HTTP（学习1、训练4），Wikipedia只重新核验所选来源1次；没有重复饮食/课表/NLP成功路径。全部合成隔离库，未向正式Owner写合成事项。
- 13:22最终受影响训练adapter组合case 1/1与Core typecheck通过，diff格式检查通过；Web未改，不重建。已更新Core正式服务；账号/凭据/1324条目录与业务表保留核验继续记录下方证据。
- **当前结论：学习和内部starter真实服务技术闭环已补齐；完整MVP仍不达标。** 唯一外部前置缺口仍为可核验的动作专业适用依据及对当前Owner范围的接线；现有外部1324条零审核，内部starter非专业认证。浏览器旧主路径与正式页抽查属于已有证据，本轮真实模型闭环经服务执行，未冒称浏览器真实API表单全过程已验收。继续保留目标，不按时间/调用次数宣布完成。
- 正式更新证据：[运行健康、HTTPS/CSRF及保留核验](evidence/2026-09-20-final-update-runtime.json)，[更新前](evidence/2026-09-20-final-before-update.json)/[更新后](evidence/2026-09-20-final-after-update.json)10表数量/hash一致。
- 补充一次隔离电脑浏览器读回：[证据](evidence/2026-09-20-learning-browser-readback.json)。复用真实学习结果的SQLite副本、独立合成登录；课程显示1项行动、Wikipedia来源URL/日期/hash可见，9月21日每日计划显示已全部采用19:00–19:25。零模型/公开请求、没有重跑学习确认、未修改正式数据，浏览器错误日志为空。临时页面已关；清理时会话句柄已不存在，并核实3217/4327无监听、正式3041/4341仍在；恢复本次Next生成的类型路径。
- 恢复目标后的第2轮：上一轮为实际progress（5次有因调用完成两条真实服务闭环及更新），本轮完成浏览器证据落盘/隔离环境收尾。仍未收到动作审核资料答复；不会用内部工程政策或API授权替代外部适用依据。目标保持active，完整验收未通过。
- 恢复目标后的第3轮阻塞审计：直接只读查询正式库仍为catalog=1324、reviews=0，当前代码仍要求专业适用确认，内部starter仍明确非医学认证；未收到新的审核资料或路径。前两轮已完成所有不依赖该材料的本轮收尾，本轮没有可推进的外部依据，属于阻塞复核而非新的实现进展。未重试API、未重测通过链路。相同外部条件已跨恢复后的三轮持续存在，goal标blocked；完整MVP未完成，保留现有服务器和全部证据。继续所需输入为至少一套动作可核验的适用审核材料（出处/审核身份依据、适用人群、限制、参数范围），之后才能落实Owner适用范围接线及验证，不能填造审核记录。

### 2026-09-20 12:43起：4小时主线 / 最多8小时验收执行

- 本轮以北京时间12:43为起点，16:43判断能否提前交付，20:43前交付可核对结果。沿用当前隔离worktree及所有未提交工作；范围仅服务器和电脑浏览器，不新增功能、手机、数据源。唯一进度仍为本文件。
- 首道检查已发现明确阻塞：外部1324条动作reviews=0；`planning-context.ts`对EXTERNAL_DATASET明确拒绝；内部8条starter仅有自有文字/hash和`STARTER_TECHNICAL_V1_NOT_MEDICALLY_CERTIFIED`工程政策，没有专业适用依据。目录许可/hash不等于适用性证明，不能删校验或自编reviewer/qualificationRef。已询问是否存在现成专业审核记录，未收到前外部有依据动作闭环为BLOCKED，继续其他模块。
- 剩余清单及处理：①健身专业适用依据为外部依赖，保留阻塞；内部starter真实模型链路只能作为技术证据单独记录。②课表真实截图→修改→确认；③自然语言事项→冲突说明→确认；④课程资料+既有Wikipedia公开检索→真实模型学习建议→确认/日程；⑤集中受影响构建、服务器账号/配置/记录保留及恢复边界；⑥最终跨模块抽查及使用说明。
- 真实API沿既有五类各最多一次授权；已消耗餐食解析1次，营养另行已批准的1逻辑批次（2个模型HTTP）已通过，均不重复。其他类别调用前建立持久尝试记录，无自动重试；失败先定位，仅复测不付费的受影响部分，需要新增付费调用时明确列出而不擅自重发。
- 复用已通过饮食联网/缓存、FIT04c本地浏览器和合成恢复证据，不跑全仓或全面重审。新验收合成资料和隔离数据，正式库仅按既有授权使用凭据与核对元数据，不写合成日程到用户账号。
- 12:46课表真实服务闭环PASS：合成截图→DeepSeek实际识别1次→修改教室→确认课程→独立接受排程，确认前course/rule/event=0/0/0，课程确认后1/1/0，排程后两周各1事件。证据[course](evidence/2026-09-20-live-course-loop.json)。未重复真实调用；浏览器展示待最终抽查。
- 12:47自然语言日程真实服务闭环PASS：1次DeepSeek识别明确日期/时间→实际固定课冲突说明→改至15:30→提案确认，正式Event只在ACCEPT后由1增2。未同意外发零调用。证据[event](evidence/2026-09-20-live-event-loop.json)。
- 12:49学习真实链路初次FAIL、模型0次：检索API可达但正文全部被DNS安全策略阻断。12:50定点诊断证实en.wikipedia.org解析为198.18.0.80，PUBLIC_RESOURCE_DNS_UNSAFE发生在连接前；证据[初次](evidence/2026-09-20-live-learning-loop.json)、[根因](evidence/2026-09-20-learning-source-diagnosis.json)。修复限定为既有Wikipedia数字pageId走固定MediaWiki正文API；任意链接仍原DNS-pinning，禁重定向/限制大小及时间/校验页面身份及内容hash，不放开198.18段。新增单组合case RED 1失败→GREEN 1通过，日志wiki-resource-red/green。未涉及饮食实现，不重复其验收。学习模型额度仍0/1，后续只恢复失败部分。
- 12:53学习恢复失败部分：R1验收脚本误重用旧幂等键，零外发被正确拒绝；R2使用新检索请求键，真实保存5条Wikipedia引用并重新校验选中正文hash，随后唯一学习模型调用失败，code=LEARNING_PROVIDER_UNAVAILABLE。没有保留该次响应原文，不能断言是网络或输出格式；模型额度现1/1、未重试。证据[恢复R1](evidence/2026-09-20-live-learning-loop-r1.json)、[恢复R2](evidence/2026-09-20-live-learning-loop-r2.json)。公开来源读取阻断已关闭，学习建议确认/入日程尚未实证。
- 12:54内部starter训练真实调用FAIL（1/1）：外部动作拒绝仍成立；内部候选与画像/恢复状态预览后实际HTTP200，但模型输出id/name/block等不兼容字段、缺phase/reason且reps与duration同时非null，严格校验拒绝，无训练草稿/Action/Event生成。合成原响应留隔离目录供诊断；证据[fitness](evidence/2026-09-20-live-fitness-loop.json)。这与外部适用依据缺失是两个独立问题。
- 12:56定点修复：训练提示加入实际契约JSON Schema、三阶段、引用、参数上限、互斥计数/计时、精确时长公式；学习提示补JSON Schema和枚举，后者仅为发现的契约遗漏修复，不冒称已精确查明真实失败根因。两个选定旧case RED 2失败→GREEN 2通过，其余11跳过；Core tsc首次只新测试mock签名类型失败，补正确参数后PASS。见model-contract-red/green及mainline-core-typecheck-r1日志。未修改输出校验、未接受不合法原响应。
- 独立Astra medium一次聚焦只读复核：仅Wiki新适配器/单测试、app包装、两处输出提示，无实质阻断发现；未重跑测试/网络/全仓。复核限制保留。已提出学习/训练各追加最多1次合成模型调用请求，待用户回复；未把时间或无回复视为授权。
- 12:58～13:00正式服务更新：本轮仅Core源码修改，Web/契约未变，复用上一轮已通过生产Web构建而不重复构建。核对准确任务及进程归属后重开Dashboard任务，Caddy/旧数据保留。10张业务/账号/凭据/动作表前后数量与内容hash完全一致；Owner1、DeepSeek凭据1、动作1324。HTTPS setup/CSRF和Core ready均200、Secure cookie、needsSetup=false、数据库up，未绕过TLS。诊断脚本最初路径错误404已更正，非业务故障。证据[更新前](evidence/2026-09-20-mainline-before-update.json)、[更新后](evidence/2026-09-20-mainline-after-update.json)、[运行](evidence/2026-09-20-mainline-update-runtime.json)。
- 13:03电脑浏览器一次只读跨模块抽查：更新后原Owner会话保留，today/schedule/learning/fitness可访问，详细训练入口可切换；默认外发未勾选、缺画像时生成禁用。未向正式账号写入合成业务记录、未付费重发、未重测饮食。证据[browser](evidence/2026-09-20-mainline-browser-check.json)，这是页面/会话抽查而非新密码登录或全表单浏览器闭环。
- 独立复核记录[review](evidence/2026-09-20-mainline-focused-review.md)。失败后事实检查[fail-closed](evidence/2026-09-20-mainline-fail-closed.json)：学习/训练隔离库Action/TimeRequest/Event均0，记录的非法训练原输出仍被当前严格Schema拒绝，未靠取消校验过关。受影响diff格式检查PASS。
- 使用说明与恢复边界已更新[DEPLOYMENT](../docs/DEPLOYMENT.md)。复用既有合成重开/SQLite新目录恢复及侧车hash证据，不声称真实课表附件引用/DPAPI跨用户跨主机/整机重启已经验证。未提交/推送。

**提前判断（13:03，尚未到4小时）：完整MVP目前不达标，不能提前按完整MVP交付。** 已完成课表与自然语言日程真实服务闭环、修复公开来源读取、服务器更新/数据保留和浏览器抽查。剩余两类外部条件：专业动作适用审核材料；学习/训练各1次额外合成真实调用的明确授权（原额度各1/1已耗尽）。两项异步问题尚无回复，继续保留目标与严格校验，不能按时间到点标完成。学习真实失败根因未精确判定，提示完善仅有本地证据。等待期间不重复付费或反复跑已过检查。

- 第2轮目标审计：上一轮属于progress（真实证据、修复、部署均有产物）；本轮从TASKS/原始失败证据重新核对，没有新审核材料或追加调用答复。已准备`data/mvp-acceptance/live-learning-extra1.ts`与`live-fitness-extra1.ts`，**未执行**；必须先获追加授权，才可设置一次性执行开关。学习复验复用已成功检索及引用，仅重新校验选中正文，不重搜5条；增加合成响应留存供定位，单次模型上限和已存在证据禁止重发仍保留。未触碰正式数据或新增网络调用。当前仍缺同两项外部输入，goal保持active，不伪称后台有运行中的验收任务。
- 第3轮阻塞审计：上一轮只有复验准备，未推进实际业务验收，按no progress处理。现再次核对原始证据：学习、训练模型均FAIL且各1次，extra1结果文件均不存在，专业审核来源仍未提供；会话中两项问题无新增答复。当前无运行中的验收任务可等待，也无无需外部输入即可关闭这些门禁的剩余动作。相同阻塞已连续3轮，goal标BLOCKED，停止自动轮询；完整MVP仍未达标，不缩小目标、不取消校验、不重复付费。用户提供材料/追加授权后从现有成果恢复，未受影响证据直接复用。


### 2026-09-20 营养接入变更：真实闭环通过并更新服务器

用户已明确允许最小真实API及固定版本动作文字目录下载/导入；随后要求只配置DeepSeek，工具联网查营养并本地复用。此修订取代USDA必须配置的前置条件，规格见TECH_SPEC §17/MVP-SCOPE。正式独立MVP库已有1个Owner、1条DeepSeek凭据；未输出密钥。已有USDA配置仍可选用；当前用户无需填写USDA。

- 新DeepSeek营养工具和Owner隔离SQLite缓存已装配到正常服务。先读缓存，未命中才调用工具访问固定中/英文Wikipedia；原文、100g/mL基准、四项营养数值及单位逐项校验，保存URL/抓取时间/引用/hash。缓存30天、每Owner最多100条；重复匹配不联网、不解密、不占外部额度。缓存不是已确认餐食。来源覆盖有限，无依据保持未匹配。
- 最小测试：缓存额度/确认组合case1/1；真实适配stub及缓存组合case1/1；Web营养文件6/6。独立限定复核发现并修复USDA折叠读取/保存竞态、脂肪分项被当总脂肪两项P2；后者包含截取`fat 1 g`子串绕过，现同时检查完整来源行。未跑全仓/手机/重复E2E。
- 真实餐食解析一次PASS（合成Cheddar cheese 100g）；真实营养一次逻辑批次PASS：2次DeepSeek、2次Wikipedia请求，无自动重试；查询→选择→确认→新草稿重复匹配全部通过，重复匹配新增外部请求0、actualCalls=0。数据位于隔离验收库，未向正式用户餐食写合成记录。证据：[解析](evidence/2026-09-20-live-meal-parse.json)、[联网与缓存](evidence/2026-09-20-live-web-nutrition.json)。
- Core类型检查PASS。Web初次构建暴露异步ref类型收窄错误，使用读取中止helper修复，最终生产构建PASS：[构建](evidence/2026-09-20-nutrition-production-build-r1.log)。只停止并重开核验归属的MVP任务进程，保留Caddy及旧数据。
- 正式服务已更新：迁移32成功、Owner/DeepSeek凭据仍各1条、缓存表存在；HTTPS setup/CSRF及Core ready均200、Secure cookie、无证书校验绕过，needsSetup=false。证据：[运行元数据](evidence/2026-09-20-nutrition-runtime-metadata.json)、[HTTPS](evidence/2026-09-20-nutrition-runtime-https.json)。页面USDA已折叠为可选，主要说明DeepSeek和本地复用。
- 已批准的健身文字目录固定revision `7455efae41b330c265e7cd4b78dfa848e7ce5ebd`下载并校验Git blob/SHA256，LICENSE/NOTICE保留，未下载媒体；正式MVP导入1324条，全为UNREVIEWED、review=0。证据：[下载](evidence/2026-09-20-fitness-source-download.json)、[导入](evidence/2026-09-20-fitness-source-import.json)。不伪造资格或Owner适用依据，外部详细训练适用契约仍是缺口。

本次DeepSeek联网营养及缓存需求已部署并取得真实最小闭环证据；**完整服务器MVP仍未整体达标**：其他能力真实验收和外部健身动作适用范围接线仍需完成。没有提交/推送。下文未授权、未配置、未安装及未调用为历史，以上最新状态优先。

### 最新：用户再次明确“安装”，实际HTTPS信任验收通过

已将实际自启实例CA `8AE33DEC5D07FEEB277993A2D751F3264A91D139`导入CurrentUser Root。Import-Certificate返回成功；同进程Certificate provider的Test-Path一度返回false，未据此反复安装。随后新进程通过.NET X509Store读取到精确指纹，且未绕过证书校验的真实HTTPS setup-status=200、CSRF=200/Secure cookie、错误Origin=403，证据`evidence/2026-09-20-mvp-https-trusted.json`。正式实例仍needsSetup=true。证书安装/HTTPS入口阻塞已解除，下文未信任与取消记录保留历史；真实API、动作目录授权及外部动作适用范围接线仍未完成，本次“安装”仅对应证书，不扩张成付费API或数据导入授权。完整MVP尚未完成。

### 2026-09-20 完整服务器MVP持续实施（等待用户输入，未完成）

本次恢复后的第3轮阻塞审计：同一证书确认/真实调用授权条件持续未满足。前轮对会话75531及进程11180的观察为verified wait；最新进程11180已不存在；随后会话75531返回exit1及Windows错误“操作已被用户取消”(0x800704C7)，因此已确认导入取消，实际CA仍未受信任，不再宣称窗口仍打开，也不再自动重发导入。真实API和动作目录授权无新回复。没有可据以完成剩余真实验收的新增输入，goal再次标blocked，等待用户主动回复；保留全部成果与完整MVP范围，不重复测试。

恢复后最新核对：原证书进程14344及工具会话40537均已不存在，不能再称原窗口仍在等待；实际CA未受信任，正常HTTPS仍失败，两个自启任务仍Running。原导入终止原因未知，不推断用户已同意或拒绝。沿已批准部署方案核验公开证书指纹后重新发起一次CurrentUser导入，当前工具会话75531仍运行；不重复安装Caddy或重跑业务测试。真实API及动作目录下载授权没有新回复。此为恢复后的第1轮阻塞审计，goal保持active。

最新阻塞审计：部署验收轮及随后两轮均未收到所需交互/授权；本轮重新查询证书导入进程14344仍存活，窗口为“安全警告”，实际CA仍未受信任；两个服务任务继续Running。前轮有新的来源/代码缺口证据，本轮属于对活进程的verified wait，不新增重复测试。真实API及文字动作目录下载/导入的异步授权仍未回复。系统部署已获授权，不重新请求；只等待原生证书窗口操作。当前不能执行剩余真实验收，也不能编造外部动作资格与Owner适用依据。goal标blocked以停止无变化自动轮询；目标仍为完整服务器MVP，非完成或缩小范围。用户回复后继续现有状态，不重新安装或重跑已通过用例。

用户已要求“直接完成项目mvp，自动决策”。在已批准正式需求内连续补齐功能，普通可逆实现不再逐步确认；手机保持移出范围，测试保持最小完整流程。真实付费调用、个人数据、安装及系统部署仍依既有明确边界，在具体方案完成后处理。原FIT修复预算与历史结果不重置。

- 饮食文本：新增有界DeepSeek JSON传输及Owner凭据解析器，正常app装配接通餐食文本解析和既有辅助训练文本入口。单一合成接口场景通过，含未配置/未同意不发送、解析落草稿、同键重放、非法营养输出拒绝。真实API尚未调用。
- 课表：已接DeepSeek视觉适配、Owner配置状态和导入服务；不确定字段保留null，界面补全，未完整不得确认。一个隔离合成场景通过识别→不完整阻断→补全→确认课程/重复规则/日程；不是实际截图API证据。
- 学习公开检索：Wikipedia中/英文适配器完成，正常server启动装配，确认执行前无网络；定点2/2通过。真实网络可达性待核验。
- 营养配置：migration31新增Owner加密凭据表，USDA配置接口与Web设置入口已写入；一个隔离合成场景通过认证、拒绝DEMO_KEY、保存/查询不解密不联网、移除。USDA事实适配器及完整匹配装配仍在集成中。
- 07:00：原实现仅准备上下文，现接已有LOCAL_RULES协调器，在事务中每天只生成一次可审核Proposal，不自动应用、不调用Provider。today定点场景1/1通过，同日重复访问仍只有1份Run/Proposal、Event为0。
- 自然语言日程：已实现只读解析、参考日期/时区、缺字段保留null、已确认日程重叠原因、编辑后撤销旧冲突说明，接回既有提案确认。一个合成服务场景1/1通过，缺确认/缺key不外发，只有ACCEPT后出现Event。解析接口已Owner鉴权及30次/分钟限流。
- USDA适配与Owner接线已完成，源许可/份量依据见TECH_SPEC；单一适配场景1/1通过。现有`mvp-health-text.test.ts`扩为解析→真实适配stub查源→选择→确认的完整接口场景并1/1通过，200g的确定性汇总正确。没有真实USDA/DeepSeek请求。候选Web编辑功能正在补齐。
- 集中Core类型首次失败仅USDA引用了Node环境未暴露的`ReadableStreamReadResult`；改为从reader.read推导类型后第二次exit0，无运行逻辑修改，不重复适配测试。最终Web构建、一次核心浏览器主路径、真实能力与服务器运行恢复门禁尚未完成。不能称完整MVP已达标。

#### 本轮最新集成结果（以上“仍在实施/尚未构建”由此更新）

- 饮食Web候选编辑/排除已补齐，使用既有`REPLACE_CANDIDATES`，保存后清空旧匹配；未保存不得继续匹配/选择/确认。文本解析增加初始未勾选的外发确认，移除“仅本地保存”误导文案；USDA失败提示与小数输入已修正。定点Web文件4/4通过，其中新增一个完整编辑确认场景。
- 独立Astra medium只读检查生产适配、Owner凭据、课表完整性、营养单位来源与自动LOCAL_RULES装配，无实质P0/P1/P2发现；没有再跑测试或复核全库。
- 隔离副本`data/mvp-build-37e25fae5c504791987fcea574727c68/apps/web`生产构建exit0，含源码TypeScript及页面产物。没有改日常预览的.next/tsconfig/next-env，没有复制.env或用户库。日志[Web build](evidence/2026-09-20-mvp-web-build.log)。副本含只读依赖/Core junction，保留，不盲目递归删除。
- 新增服务器桌面浏览器单case：身份→配置营养密钥（合成密钥）→主动同意文本解析→150g改200g→保存→匹配fixture来源→选择→确认→刷新读取。首次仅测试定位歧义失败（“餐食文本”同时匹配新checkbox）；改成exact后同一case1/1通过，4.5s、总5.4s。未改业务绕过校验。失败[日志](evidence/2026-09-20-mvp-browser-initial-failed.log)/[上下文](evidence/2026-09-20-mvp-browser-initial-context.md)保留，成功[日志](evidence/2026-09-20-mvp-browser-r1.log)。测试中明确断言TEST_FIXTURE、确认200kcal/蛋白20g/碳水40g/脂肪10g，不能当真实营养数据。无浏览器error；运行器仅有NO_COLOR/FORCE_COLOR提示。沿用Web loopback网络拒绝保护且无未知目标标记，测试后3217/4327无监听。
- 本轮局部浏览器修复1次（测试定位）；不消耗或重置原FIT04c历史预算。没有跑手机、全站或全仓回归。**当前为服务器功能的本地集成PASS，完整MVP仍缺真实Provider/合法动作数据实际启用和服务器运行恢复证据。**

本轮证据汇总：[服务器MVP本地集成](evidence/2026-09-20-server-mvp-local.md)。已通过异步问题请求真实接口验收授权：合成内容、已保存DeepSeek凭据、五类能力各最多一次、不自动重试/不发送个人记录；等待用户回复，不把等待当同意。只读本机核对Tailscale命令不可用，所查3000/4311/3041/4341/3443端口无监听；未安装软件或启动实际服务器。下一步先在明确授权范围执行真实能力最小路径，并完成独立HTTPS入口/常驻运行及备份恢复方案，具体系统改动仍需按AGENTS单独确认。

部署方案及回退范围已写入DEPLOYMENT顶部，Caddy本机配置已准备（未安装/运行验证）：独立MVP目录、HTTPS127.0.0.1:3443→Web3041→Core4341、仅当前用户CA信任、登录自启任务、合成数据重开与新目录恢复。已发起第二项具体系统部署授权问题，仍等待回复；不会因为“自动决策”自行越过AGENTS明确保留的安装/生产权限。当前goal保持active，未标完整或blocked。

实现由既有Terra Max角色分别负责独立视觉、公开检索/USDA、自然语言日程范围，主Agent维护装配与唯一进度；集中集成检查，避免重复全仓测试。工作保留在当前worktree，未提交/推送/部署。

#### 部署授权后实际结果（2026-09-20 01:21，北京时间）

用户明确回复“允许按此方案部署验收”，覆盖官方Caddy、当前用户CA信任、独立MVP目录、登录自启及合成重开/恢复；未覆盖另一项尚待回复的真实付费API验收。

- 最终实际worktree的生产Web构建exit0，日志`evidence/2026-09-20-mvp-production-build.log`；已安装官方Caddy v2.11.4，release archive SHA256 `1708333f79e274c7697285afe6d592ab39314e0b131e9ec6bea08ad27df62ebf`匹配，配置验证通过。
- 两个当前用户Limited登录任务已登记并Running：`\EV-AI-Assistant\EV AI Dashboard MVP`及`EV Local HTTPS MVP`，无限执行时长、允许电池供电。4341/3041/3443均只监听127.0.0.1。主服务已实际停止并重开，Core ready/database up；新MVP仍needsSetup=true，未用合成Owner占用正式实例。没有主机重启或防火墙变更。
- 自启环境无法看到交互环境安装的LOCALAPPDATA工具目录（同用户名/相同路径，但File/Directory.Exists为false）；核对二进制SHA256后复制到worktree内忽略目录`data/mvp-tools/caddy-2.11.4`，任务使用该绝对路径后运行成功。不是未核对路径就调整系统权限。原始工具保留。两个环境还产生了不同的CA，不能沿用交互实例的信任证据。
- **当前唯一TLS系统交互：实际自启CA `8AE33DEC5D07FEEB277993A2D751F3264A91D139`正在等待Windows“安全警告”中点击是。** 交互实例旧CA `ABCDEA45F98C454BAD3FF641C7EE6BBE316AEFF7`已曾获信任，但不能验证实际服务；当前正常HTTPS请求仍因证书链失败，不绕过校验标PASS。已请求用户完成原生窗口。
- Web本机上游最小检查：CSRF初始化200且Secure cookie；错误Origin403。暂不能替代最终HTTPS端到端验证。状态证据`evidence/2026-09-20-mvp-deployment.json`。
- 1条独立合成恢复流程通过：真实Core HTTP创建Owner/任务→关闭重开→登录/原任务读取→SQLite CLI create/verify/restore至新目录→恢复实例登录/任务读取；artifacts与memory合成侧车文件备份/恢复hash一致。证据`evidence/2026-09-20-mvp-recovery.json`。仅合成内容，未读旧个人库；没有实际课表附件引用或DPAPI密钥恢复证据，不宣称完整跨环境恢复。
- 脚本定点修复：已安装系统的“找不到任务”异常新增匹配CmdletizationQuery_NotFound；自启隐藏窗口且不再受默认3天限制；新TLS wrapper保留简短失败日志。诊断阶段临时日志代码已移除，最终PowerShell语法检查通过。未跑全仓测试。

完整MVP仍未达标：待实际HTTPS信任与最终入口核验、真实Provider授权/调用、合法动作数据实际启用；恢复边界如上保留。goal继续active，没有提交或推送。上文“未安装/未部署/待系统授权”是此前状态，由本节更新。

#### 继续核对：外部动作实际接入缺口

上一轮分类为progress：完成安装、自启修复、真实服务重开和独立恢复证据。本轮核对证书导入进程14344仍活跃且窗口为“安全警告”，实际CA尚未进入CurrentUser Root；两个服务任务仍运行。没有重新发起导入或绕过证书校验。

只读来源元数据已固定：`hasaneyldrm/exercises-dataset` main revision `7455efae41b330c265e7cd4b78dfa848e7ce5ebd`；`data/exercises.json` 17,391,530 bytes，Git blob SHA `3cbb77b678c40d7342897d38e4c61e9502f829a7`（不是SHA256）。尚未下载数据本体/导入。来源README、LICENSE/NOTICE边界保留：文字与媒体分别处理，不下载媒体。

发现需要纠正此前“仅差合法数据启用”的笼统表述：`apps/core/src/modules/fitness/planning-context.ts` snapshots对EXTERNAL_DATASET无条件抛WORKOUT_PROFESSIONAL_CONFIRMATION_REQUIRED；目录独立review存自由文本人口范围，不能证明Owner适用性。因此外部数据完成导入也不能直接进入详细计划。后续须补明确、可核验的适用范围契约与接线，使用真实审核依据；不能以AI自编reviewer/qualificationRef或直接删除阻断来宣称完成。内部starter真实调用与外部动作实际链路必须区分记录。

### 2026-09-20 FIT04c extra1与只读联网已获授权

用户回复“允许”，批准上一轮明确提出的FIT04c额外一次定点诊断修复、原同一隔离场景最多重跑一次，以及只读联网查阅官方接口/数据源资料。原2/2保留，extra1现在开始；只改原测试基础设施范围，不改业务确认规则，不预先豁免取消/网络失败。真实付费调用、个人数据、下载安装和部署未新增授权。当前使用既有失败日志作RED证据，不额外重跑基线；结果在本节追加。

**最新结果：FIT04c本地限定PASS。** 只改原范围三文件，唯一重跑exit0、1/1；原始9次GET取消与9份独立请求ID/AbortSignal证据配对，未解释失败0。Next可选npm版本查询在传输前被精确禁用并记录，未知TCP目的地仍拒绝并阻断归档。两次Fake及最终Action/TimeRequest/Event=1/1/1、反馈与记忆进入下一次上下文、第二份DRAFT均保持。成功证据已归档并复制至plans/evidence；3217/4327无监听。定点类型0诊断、两个脚本语法通过；Astra medium一次只读聚焦复核PASS，未重复测试。预算原2/2+extra1 1/1已用。未提交推送、未真实调用、未部署，不能称完整MVP完成。报告：[extra1](evidence/2026-09-20-fit04c-extra1.md)。下方2026-09-19失败记录是历史，不再作为当前本地闭环阻塞。

#### 缺失真实能力的只读选型结果（待实施，不代表接通）

| 能力 | 最小接入方向 | 已核对事实与剩余条件 |
| --- | --- | --- |
| 课表截图 | DeepSeek `deepseek-flash`，现有凭据保护、直接base64图片，不另建文件上传服务 | [官方视觉文档](https://api-docs.deepseek.com/guides/vision/)提供Chat Completions图片格式；需补Owner凭据工厂到VisionCapability/导入服务的装配，不能启动时解密或提前发送截图。缺真实调用证据 |
| 饮食文本/自然语言日程 | 复用DeepSeek结构化输出、既有确认与确定性校验 | 新文本解析不得给出营养事实，也不直接落Event；服务端适配、路由/UI接线与最小场景仍待实现 |
| 营养数值 | 优先评估USDA FoodData Central作为可替换首个数据来源 | [官方API指南](https://fdc.nal.usda.gov/api-guide/)明确搜索/详情接口、需API key、CC0；DEMO_KEY仅适合限额探索，不作为正式可用配置。中国食物名称映射、克/毫升/份量身份和人工候选确认仍需实现，不能声称覆盖全部中国饮食 |
| 公开学习检索 | 优先评估MediaWiki匿名公开检索作为一条最小公开资料链路；保留可替换接口 | [Search](https://www.mediawiki.org/wiki/API:Search)及[Etiquette](https://www.mediawiki.org/wiki/API:Etiquette)提供查询格式与User-Agent/串行请求要求；百科来源必须标为公开资料，不能标为课程官方资料。不是全网搜索，目标主机实际可达性尚未测试 |

现有默认文本模型常量是`deepseek-v4-flash`，不是早期deepseek-chat；[官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)仍接受该别名并路由到最新Flash。本轮未擅自改动现有模型配置，也不因文档列明能力就将当前项目标为可用。只读选型未使用用户密钥或产生模型费用。

### 本轮最新范围：移除手机MVP门禁

用户明确“手机端从mvp里删除掉，只需要服务器端现在”。正式范围已同步PRD与MVP-SCOPE；沿用服务器Core/Web及电脑浏览器操作，不改为纯API或新增云迁移。手机适配、移动矩阵、物理iPhone/Safari和专为手机安排的远程访问部署退出本轮，不再作为完整MVP阻断。旧V9记录与结果保留历史效力，其手机必达条款不再驱动当前任务。其余领域、真实Provider和服务器运行/恢复要求保留；仍按最小完整流程验证。本次仅调整文档，没有运行业务测试或修改业务代码。

### 本轮最新测试约束：最小完整跑通，优先完成功能

用户明确要求：“现在所有的测试都以最小完整跑通的测试为主，减少大多无须的测试，把token都用在完成功能上”。此约束优先于技能默认的全量测试、重复审查与扩展矩阵；不改变完整MVP范围，不把未运行或失败写成通过。

- 每条新增/实际改动的业务链仅验证1条完整成功路径；涉及未确认写入、身份/数据隔离、无Provider伪成功等实际风险时补必要阻断，优先合并于同一场景，不穷举排列。
- 已有且仍适用于当前代码的证据直接复用；仅因实际改动、失败或尚未解决的具体风险重验，不为文档更新、形式收口或重复审查再次跑测试。
- 集成后集中执行受影响范围的类型检查与必要构建，以及1条贯穿核心操作的浏览器主路径；领域检查与浏览器不重复覆盖同一细节，不运行根全仓测试、全站E2E、全迁移或多浏览器矩阵。
- 真实Provider和服务器恢复等当前正式范围内必要验收只验证最小完整路径；Mock/模拟不能替代这些真实证据。手机已移出范围。缺资源如实列出，不以增加本地测试填补。
- 减少重复读文档、重复汇报与无明确问题的整版复核，把实现工作集中在缺失功能与必要集成。只对具体发现和直接影响做聚焦检查。
- 本条是验证策略调整，不自行追加已耗尽的FIT04c修复次数，也不扩张付费API、真实数据、下载安装或部署权限；已有执行授权继续有效，无需对普通步骤重复询问。

### 2026-09-19 本轮目标：完整 MVP 达标（冲刺安排，尚非验收结果）

用户在本次项目评估后明确选择“完整 MVP 达标”。不以桌面试用版替代正式范围，不恢复已退役项目分析/Codex功能。以PRD最新修订、MVP-SCOPE与V9实际验收边界为准；一晚为冲刺时间目标，不是无条件完成承诺。此节只记录目标与工作安排，不把选择交付目标解释为新增付费调用、个人数据、系统部署或超预算修复授权。下方04c原始失败及2/2预算保留。

#### 工作顺序与交付门禁

| 顺序 | 工作包与主要落点 | 可验收结果 | 依赖/当前状态 |
| --- | --- | --- | --- |
| 1 | FIT04c诊断收口：现有fitness单browser spec、run-e2e、fitness-planning-evidence、专用bootstrap | 四类GET取消具可核对配对；Web网络拒绝可脱敏归因；不放宽未知目标拒绝、业务事实与归档门禁；同一case通过并有归档 | 原extra1仍待明确授权；尚未改码/重跑 |
| 2 | 饮食真实接入：nutrition/provider与service、health-loop、既有凭据及界面 | 文本食物/数量解析→可信营养查询→确定性计算→可编辑确认→本地记录与当日统计；缺源/单位不明不伪造数值 | 需要确定可用营养来源；真实API另核准 |
| 3 | 课程真实接入：providers/capabilities、calendar/import-service、learning/service及对应页面 | 一张截图产生可纠正课程候选并确认入日程；一条公开检索资料形成带引用学习Action/TimeRequest | 需要确定视觉/搜索能力；文本Key不等于视觉可用 |
| 4 | 健身真实链路：fitness/deepseek-workout-planning、planning-context/service、catalog及feedback-memory | 合法来源候选→经批准上下文→真实模型草案→训练确认→独立日程确认→实际输入反馈→下次可选上下文 | 依赖1；外部动作数据资格、真实调用及个人数据分别核准；Fake不计真实效果 |
| 5 | 自然语言日程与每日协调：calendar、daily-planning及schedule页面 | 一句事项→可修改候选/冲突→确认写入；核对07:00与首次访问行为、单日重复触发、未批准外发边界 | 先依据现有提案服务冻结最小输入输出；不另造日程事实系统 |
| 6 | 共同底座核验：auth/tasks/today/memory/providers及app装配 | 唯一Owner、任务生命周期、今日聚合、记忆编辑/删除/存在版本恢复、能力状态与失败提示均真实 | 复用有效证据，仅对实际受影响链路补必要检查 |
| 7 | 最终集成与服务器运行：server、Web BFF、Windows脚本与backup工具 | 正常启动接通已实现能力；受影响类型/构建通过；电脑浏览器核心流程；07:00行为与实际运行相符；备份恢复边界有证据 | 不含手机及专为手机的私有访问；任务注册/重启、真实数据恢复仍在具体方案准备后核准 |
| 8 | 最终交付 | 按正式需求逐项给出已通过、失败或未验证及证据；全部必需门禁满足才声明完整MVP | 未通过不能按时间到点标完成；阶段保存沿既有精确授权，不自动发布 |

#### 冲刺组织与检查约束

- 按北京时间2026-09-20 00:00至08:00作为建议首个冲刺窗口；用户尚未确认通宵截止时间。时间用来安排检查点，不删减完整MVP范围。04:00检查真实能力接入，06:30检查可交付范围；未达标明确延续工作，不自动改称试用版完成目标。
- 可独立推进饮食与课程适配准备；共享app.ts、公共契约导出、迁移及本文件统一串行整合，避免覆盖当前未提交健身工作。当前没有因此启动额外Agent。
- 优先复用既有Provider Port、凭据保护、Proposal/版本/幂等/事务。每个新增闭环先固定1成功及关键阻断的最小检查；遵守当前测试预算，不擅自根test、全站E2E或安装依赖。
- 新视觉/搜索/营养适配器在服务来源与能力确定后，才冻结精确接口与实现步骤；不从旧技术蓝图推定运行代码已存在。
- 不读取凭据正文或日常数据库来完成本轮排期；真实调用先准备脱敏样本、固定目的地、次数/输入输出上限及费用边界，再提交具体核准。系统部署先准备可审阅配置，再核准执行。
- 本轮当前仅完成只读核对与排期写入；没有新增测试通过、业务修复、真实网络调用、部署或发布结果。

### 最新状态：2026-09-19健身业务路径已跑到终点，整体验收未通过

03b extra1、03d R2、04b R2及03e均已限定实现/复核通过，预算原样保留。04c初版+R1+R2已用尽：初版Windows --import原始路径启动失败（0case）；R1修file URL后单case在表单选择器失败；R2修实际可访问选择器后单case走完业务断言，但最终诊断门禁失败。**不能声明健身闭环PASS。**

R2实际证据：2次Fake、训练确认后Action1/TimeRequest1/Event0、LOCAL_RULES单独确认后Event1；实际合成反馈保存201、记忆RECORDED，授权反馈与记忆进入第二次Provider输入，第二份留DRAFT，最终事实1/1/1。consoleProblems/apiFailures/pageErrors/browser externalRequests均0，但failedRequests=9（GET ERR_ABORTED）。另有Web网络拒绝标记，仅denied=true，未记录目标/原因，不能宣称Web零外连尝试；Core拒绝计数0。缺少成功browser artifact/归档。

证据：evidence/2026-09-19-fit04c-final.md及run-initial/r1/r2日志、r2-fake.json、r2-failed-requests.json。失败运行managed-run-8l1XsQ保留；3217/4327已无监听，next-env前后hash一致，未操作日常数据/3000预览，未提交推送。Planck正复核实际失败证据，不重跑或改码。当前唯一下一步：复核后请求一次仅04c诊断/验收基础设施的限定修复授权；未获授权前不再执行或修改该任务，不重置2/2。

Planck实际证据复核完成：NOT PASS。只读核对合成库事实1/1/1、workout2（COMPLETED/DRAFT各1）、feedback1，Fake两次及第二次feedback1/memory1成立；四文件/R2日志hash匹配，成功artifact/归档缺失。代码存在与端点吻合的AbortController生命周期清理，但缺逐请求ID/signal/时序配对，不能直接豁免9次取消；网络拒绝至少一次，不能区分真实外连意图、内部连接或参数解析误判，也不代表外连成功。下一步请求extra1仅四端点取消取证与网络guard脱敏归因、必要定点测试基础设施修复，同一合成case最多再运行一次；保持原始失败计数、拒绝未知目的地和业务/归档门禁，不预先授权扣除错误。阶段交接docs/releases/2026-09-19-fitness-local-loop-handoff.md。

### 2026-09-19 当前授权：03b额外一次定点修复

当前接线进度补记：04b五文件UI已交付，原单Web组合case RED→GREEN，覆盖显式同意、草稿/修订/提案和实际反馈；一次测试扩充按R1/2计。仅Mock接口，不代表Core/浏览器闭环通过。Astra medium Mill进行一次限定只读复核；主继续后端集成准备，03d仍在实施，03e待服务接口稳定。04c最终浏览器仍未运行。证据见evidence/2026-09-19-fit04b.md及同名精确diff、原始日志。

04b限定审查发现两项有效P2，主核实：按body永久缓存check-in幂等键使A→B→A重放旧A；旧手动反馈丢弃返回的safetyNotice。已交原Ohm执行剩余R2/2，保持原五文件和同一个Webcase，成功确认check-in后退役该次键、未知结果重试保留；手动反馈独立展示安全提示。未将Mock绿色当作这两项已验证。03e只读准备完成，实际服务还在03d实施中，默认adapter/路由尚未接通。

03d交付：六文件单组合case 1/1、定点tsc通过，R1/2用于V1夹具类型及同case断言补齐；原Astra Bohr聚焦复核中。服务构造接口已稳定，8秒Provider deadline但不宣称HTTP断连取消；反馈/记忆分事务，V1/V2列表在SQL区分。证据fit03d.md/.diff及日志。04b R2三文件修复交回，原case RED→GREEN 1/1，预算2/2耗尽；Mill仅复核原两项及直接影响。两片均未因本地测试先标整段完成；03e待03d限定复核。

04b R2限定复核PASS：Mill核对原两项、三文件/hash及原单case日志，无剩余有效发现，2/2不重置。主首次Web typecheck exit2，仅报告旧.next/types引用已退役projects页面；不是新UI类型错误，也不标类型通过。不删除或覆盖用户预览缓存，待隔离新产物核验。原始输出fit04b-main-typecheck.log。

03d限定复核发现有效P2：自动记忆证明读取后、只按数字版本写入前，另一连接删除重建同版本人工内容可被覆盖。已交原Lorentz最后R2/2，仅helper与原case；优先复用现有writeForCompaction事务内beforeProjection，以实际parentRevision UUID校验并回滚冲突，避免新记忆框架或重构原投影事务。对应自动证明使用回调revision，不以提交后重读冒充同一写入身份。事实先提交不变，03e仍不越过此复核。

04c准备继续：04b最终UI限定通过后，原Popper获准编写原单browser spec，不启动服务或测试；最终GO仍待03e。沿用0/2预算和原四文件范围，测试两次Fake生成，第二次确认授权反馈/记忆确实交给Provider，第二份只留DRAFT不新增已确认Action/Event。不是额外browser case或真实模型授权；证据helper随原契约同步。

03d R2限定复核PASS：原Bohr确认实际事务内parent/source revision UUID门禁、投影前回滚及同事务自动证明；单case真实第二连接删除重建反例RED→GREEN 1/1、定点tsc通过，原entity-service未改。原2/2已用尽。当前唯一下一步：原Dirac执行03e App/新planning-routes/单routes case接线（新接线0/2，不重置04a旧缺陷预算），通过后04c最终browser；04c现只编写准备。证据fit03d-r2.md/.diff和原始日志。真实API/用户数据/提交权限未扩张。

03e限定复核PASS：Planck核对App/新路由/单case及当前hash，鉴权、默认无Fake、配置零解密外探、注入门禁及响应包装通过；03e R1/2为非法descriptor测试类型标注，保留1轮。04c四文件静态边界也PASS，实际browser尚未运行。主集中Core配置+专用bootstrap共169入口0诊断；隔离Web build R1 exit0（首轮副本漏复制测试配置，补复制后通过，无业务改动），99个Web源码/测试文件与副本hash一致，diff --check exit0。证据fit-web-isolated-validation.md及日志。

当前唯一下一步：Popper已收到04c最终GO，执行原sole fitness-planning-loop.spec.ts，初版0/2、仅测试基础设施允许局部修复；发现已冻结业务缺陷不得越权修或降低门禁。后续主复核实际归档与闭环事实，更新最终交接。未使用真实API/健康数据，也未新增提交。

用户答复“可以”，批准上一轮明确提出的03b新check-in失效缺陷一次限定修复，原2/2保留为2/2+额外1/1。当前执行：原Terra Carver仅改planning-context、必要repository查询和原context单case，先复现新风险状态B之后旧安全状态A仍被使用，再修共享readBasis并覆盖preview/resolve/revalidate。不改迁移/历史报告，不新增产品范围。原Astra Bohr仅复核该发现及修复直接影响，通过后恢复03d/e及04b/c已有契约；不再等待重复同意。

沿用既有隔离worktree、TASKS唯一进度、最小测试和无自动提交边界；用户显式约束优先于新版技能的全套测试/新账本/自动提交或自主超额默认。此前暂停段保留为历史状态，不是当前待授权。真实API、个人数据、安装/下载与发布未新增授权。

已恢复Carver定点实现；Ohm按已冻结接口恢复04b的mock测试与UI实现，Popper恢复04c独立fixture/runner准备（均原0/2，不运行浏览器）。写集合分别是Core上下文3文件、Web5文件、E2E4文件，不重叠；依赖语义保持冻结，03d/e仍等03b限定复核。运行环境只读核对Node v24.18.0、分支/HEAD未变，无安装或基线全套。主整理接线契约与证据，不重复子Agent实现。

03b extra1交回：新增Owner范围、有界LIMIT1的findLatestEffectiveCheckIn，created_at/rowid降序，排除尚未生效的未来时间；共享readBasis在风险时422、其他新状态使旧依据409。原单case RED 1 failed→GREEN 1 passed，原定点tsc无诊断；合成savepoint保留原case，验证同时间戳/UUID无关顺序与零新workout/proposal。证据2026-09-19-fit03b-extra1.md/.diff及日志，预算2/2+额外1/1已用，迁移未改。Bohr限定复核中，尚不提前放行03d。

03b extra1限定复核PASS：Bohr逐项确认旧依据失效、最新风险优先422、安全更新409、同时间戳追加顺序和直接回归，三文件/diff/迁移hash一致。主核对原始RED/GREEN/tsc及当前hash后放行03d。当前唯一下一步：Lorentz实施原03d五文件服务闭环（0/2），Ohm继续04b mock/UI。04c专用bootstrap/runner/evidence已交准备草稿，未执行类型/服务/browser；等最终App/UI就绪再单browser GO，原0/2不重置。此前暂停段仅历史。

03d范围小裁定：如旧训练列表隔离需要，允许repository.ts作为第6文件仅给listWorkouts增加可选revisionSchema SQL过滤，使count与分页一致，默认保留兼容；不得取页后filter造成错误总数，或修改冻结03b上下文/迁移。属于原V1/V2兼容需求，03d预算不变；03b先前hash将因该独立hunk变化，最终证据须记录，不能笼统沿用全文hash。

### 当前安全暂停点（2026-09-18，本轮交回）

- 已批准的03a测试反例、04a响应清理各额外一次修复均实现且原Astra限定复核PASS；每项仍为原2/2+额外1/1，旧证据不改写。
- 03b存储/上下文已实现，migration30，单case1/1及定点tsc通过；独立审查因“新的风险check-in未使旧安全依据失效”未通过。2/2已用尽，**当前唯一下一步：用户授权一次该缺陷的定点修复 → 原case反例验证 → Bohr限定复核**。异步授权问题已发出，未收到答复；不将此前两项授权扩大为第三项。
- 03d服务仍只读准备；03e路由/默认adapter装配未实施。04b仅只读核对接口，5个UI允许文件均未修改、未跑测试（0/2）；此前“并行接线”是派工目标，不是已交付页面。
- 04c仅新增 `scripts/fitness-planning-evidence.mjs` 的独立证据门禁草稿；bootstrap/runner分支/browser case未写，未跑服务、类型或浏览器（0/2），尚未经独立复核，不能当验收产物。
- 所有worker已要求冻结在安全检查点，原dirty保留。未接入真实API、未下载/导入真实外部数据、未碰日常库或预览，未新增提交/推送。健身闭环尚未完成，恢复后沿用原worker与各自预算，不重开任务名。

### 2026-09-18 追加限定修复授权与继续闭环

03a extra1已限定通过：Bohr独立复核单替代940/570秒均合法，组合1280秒精确拒绝；原生产契约/validator未改，RED 1 failed→GREEN 1 passed。证据fit03a-extra1.md/.diff；预算原2/2+额外1/1。03b已GO，独占repository、planning-context、migration30和单context case，接口采用owner/version CAS、当前memory revision UUID、预览选择短时保存与服务端确认时钟；最多2局部修复。04a extra1原case1/1及Core类型通过，Planck限定复核中。

04a extra1限定复核通过：Planck核对精确diff应用后与当前全文相同，未读完body清理、非2xx、终止abort及清理异常保护关闭原P2；迟到响应仅静态核对，未称真实流/Provider验证。证据fit04a-extra1.md/.diff，预算原2/2+额外1/1已满，adapter默认装配仍待03e串行接线。两处前置已关闭，当前唯一下一步为03b存储上下文实现，然后03d服务闭环。

03d只读准备由Terra Lorentz进行，暂不写03b独占文件。预计写planning-service.ts、service.ts（V1保护/反馈接线）、proposal-applier.ts、feedback-memory.ts及一个loop test；以新增小服务保持V1类型与逻辑兼容，沿用已有幂等/配额/事务，不新增通用框架。实际GO须等03b交付及限定复核；main维护规范文档。

04c测试基础设施可独立先行：Terra Popper只写专用fitness-planning-test-bootstrap.ts、runner精确fitness-planning-loop.spec.ts分支、单browser spec和必要fitness-planning-evidence.mjs。当前不启动测试/浏览器，待app/UI就绪主GO；新分支使用独立Fake/数据/日志和自身证据门禁，其余selector原门禁不变，不免除归档检查。整个04c沿用一次实施最多2局部修复，不因准备与最终运行分开重置。专用App option约定workoutPlanningProvider，复用既有TEST_FIXTURE隔离门禁；不造真实凭据。

下游接口冻结：planning/profile GET/PUT返回data.profile（未建null）；candidates与memory GET返回data.items，memory只含当前revision元数据；context/preview POST返回data=preview；capability GET返回独立V2 descriptor；planning/workouts的create/detail/revisions/proposal/feedback使用V2服务，决定仍全局proposals/:id/decision。新反馈响应独立追加memoryStatus，不改变旧strict反馈响应。详细读取需带候选快照供名称/说明展示。03d记忆可复用v07_audit_events的source尝试标记及自动正文hash，无新表：仅首次新feedback尝试，重放不重写；失败DEGRADED不自动补偿，事实仍供下次授权预览；人工改动/无法证明自动来源跳过，删除后不从历史重建。内存/投影写入在反馈事实提交之后，经原EntityMemoryService完成，不扩大为原memory服务事务重构。

04b按冻结HTTP契约并行：Terra Ohm独占fitness-workspace/workout-review、新detailed-workout-workspace/detailed-workout-review和单Webcase五文件。旧手动入口保留，新显眼入口切换详细流程；旧反馈也改为实际输入。只mock单case，无browser运行，最终browser仍04c一次。Core/UI都用profile null、memory metadata、detail citations和独立memoryStatus；列表data.items为workout+revisionSchema有界页，不扩大历史revision浏览功能。独立初版最多2局部修复，具体源码接口不一致先反馈主，禁止静默移除校验。

03b交回待复核：migration30与4文件交付，目标context case最终1/1、定点导入依赖tsc exit0。初版后两轮均Owner fixture约束修复，2/2耗尽，不能豁免。证据fit03b.md/.diff及原始日志；Bohr正在一次限定审查。revalidateCurrent不依赖preview TTL，外部自由文本population无法确定适用性时受控拒绝；本轮仅内置starter执行，外部仍可导入检索，不声称外部动作自动适用已完成。

03b限定审查未通过（2026-09-18）：Bohr发现有效P2，readBasis只按旧checkInId读取，不检查更新的check-in；新增疼痛/急性风险状态不会使旧无痛预览及revalidateCurrent失效。主核对planning-context:63与repository.hasRecentPain仅查feedback确认属实，现有case只覆盖疼痛反馈，非新check-in。2/2已尽，不自行修；已异步请求一次仅当前check-in依据/必要查询/原case反例的授权。03d/e后端接线暂停，04b界面与04c隔离fixture独立准备可继续，不能标闭环通过或运行真实Provider。当前唯一下一步为取得此定点授权并修复/复核；旧单casePASS不抹除也不替代此缺口。

用户明确“批准，修复了之后继续完成闭环”：03a测试反例、04a响应资源清理各追加**一次**定点修正；旧2/2保留，记作2/2+额外1/1，不授权循环扩张。原Terra实现、原Astra限定复核，依然无真实凭据/费用/下载/日常数据/发布授权。技能流程使用已核验的product-prd隔离worktree和本文件唯一进度，用户的小测试/原角色/无自动提交约束覆盖技能默认全套、自动提交、新账本及五轮修复。

第一步并行处理互不重叠的测试反例与adapter清理；主同步冻结03b存储/上下文接口。03a只改原domain单case，分别证明单个替代不超时、组合精确拒绝；04a只改原adapter和单case，超限/非2xx/取消均结束上游body且不掩盖原错误、不等待不结束的清理。每项保留真实日志/前后diff/最终hash，限定复核通过后直接继续剩余FIT任务。

### 2026-09-18 连续完成健身闭环（最新授权）

用户要求“完成修复后直接去跑健身功能，直到完成健身闭环”。授权继续 R4 定点处理已证实的 V9 测试失败链，复核后执行已批准阶段提交/推送，再连续实施 FIT-02/03/04；不逐个小任务索要继续。旧2/2和R3记录不抹除。R4一次实现最多两轮局部修复，健身各任务沿用最小验证/两轮修复边界。

- R4：原 Terra Max Laplace 处理选择器歧义、页面切换预期取消和首错保留；不吞失败或放宽安全断言，同一隔离合成case。主并行核对健身增量技术契约，Astra medium做一次规划校准，随后按任务聚焦复核。
- 完成定义：可用动作候选 → 状态/目标与近期反馈 → 详细训练草案 → 用户确认形成Action/TimeRequest → 日程审核 → 完成/跳过反馈 → 下一次规划读取限量本地记忆；真实DeepSeek适配接线具备但本轮只Fake/合成验证，外部未审核动作不能伪装安全候选。未配置真实Provider保持不可用。
- 限制：不读/改日常数据库、不安装、不自动下载全库/媒体、不执行真实付费请求或使用用户健康数据，不恢复项目模块。提交授权仅本轮阶段保存，不自动main合并/tag/Release。只有本地闭环证据存在才标本地通过，真实模型/生产另列未验证。
- R4 已限定通过：同一 V9 case 初次FAIL，局部修复1/2后 1 passed / exit0；五次计数全部执行，确认前events0、确认后events1、providerCalls0。主核对最后日志及hash CFF7C61E176469A9A523ECBAE7CA260128BE1AF1EE95F4992FA5C316EA2B4D51；Astra medium Darwin 独立复核规格/质量通过。AbortSignal证据只对精确metadata端点、最多5次配对，非逐请求ID关联属于本case有界权衡。其余网络及安全断言保留。证据：[R4](evidence/2026-09-18-project-removal-r4.md)及同名diff；旧FAIL保留，REMOVE-03仅本地限定收尾完成，不等于全量或生产验收。
- 阶段保存已完成：提交 `2634a289a68891e0fb58649838829e1c2f8c81b4` 已推送 origin/codex/product-prd，ls-remote匹配；未合并/tag/Release。150文件为累计阶段源码/文档/测试，忽略个人数据/缓存；历史evidence格式限制见阶段文档。
- 技术校准：[Astra规划建议](evidence/2026-09-18-fitness-planning.md) 作为参考而非新产品范围。主采用版本化目录、V2兼容和现有事务链路；不因建议扩大成通用审核/后台框架。外部未审核动作不自动入计划，内置starter用于本地验证，真实资格/医疗风险不由模型伪造。
- [x] FIT-02 执行契约（已限定通过）：合并目录存储/检索/资格为一个任务，一次实现最多2轮修复。允许6个代码/测试文件（必要的独立contracts导出占1文件）：packages/contracts/src/fitness-catalog.ts、index.ts；Core fitness/catalog-repository.ts、catalog-service.ts；storage/migrations.ts；tests/fitness-catalog-storage.test.ts。按规划§2实现固定来源版本canonical hash/事务幂等冲突、参数化有界检索、独立追加review和资格筛选，外部事实UNREVIEWED不改，旧starter不动。无Web批准医学安全按钮，不下载/seed真实审核。测试一个合成组合case覆盖导入/检索/资格、冲突零写入与撤销拒绝；Core必要类型检查。报告/精确diff至evidence/2026-09-18-fit02.*；主维护正文，不准worker提交或派agent。起点最大迁移27，实际追加28。
- 当前唯一下一步：执行已获批的03a与04a各一次定点修正及原审查复核，随后接03b上下文存储和后续闭环；不重置各2/2，不重复询问常规步骤。

FIT-02 初版：Terra Max Carver交付6文件、v28，单组合case RED→GREEN 1/1，Core typecheck exit0，diff主核对SHA84B94795518EB71A9135B468874FD039DC416A2126766FCE88296295FF0DE84A。Astra medium Epicurus复核发现有效P2：listEligible先all()载入所有review/动作再限量，违反有界读取；其余同版冲突事务/不可变来源/撤销及旧迁移保护正向。R1/2已派回原实现者，只修有界读取并复验同一case，不能提前标FIT02完成。03a纯逻辑继续独立进行，旧契约不变。

FIT-03c 可独立先行：FIT02 R1只改catalog-repository/test，已释放迁移文件；03c独占migrations及health-capabilities、health-loop/repository、fitness/service（只V1配额调用点）与新capability test五文件。追加新能力/HEALTH_DISCLOSURE_V2，旧V1保持兼容，V1与V2合计每日5次训练调用（不能只新接口计总数）。保留现有capability运行表/claim/边界，必要重建表时必须保留全部旧行、索引、owner约束及被其他表trigger引用的语义；不改已编号迁移，不用writable_schema或清库。一个合成迁移/配额组合case含旧记录和相关引用保留，V2声明配对及第6次拒绝。一次实现最多2局部修复；报告与diff用fit03c。此项不消费03a新DTO，不改其文件/公共index，不接真实Provider。

健身剩余执行映射（复用规划建议，不是新增产品）：

| 任务 | 交付/文件边界 | 消费与产出 / 检查 |
| --- | --- | --- |
| FIT-03a | contracts/fitness-planning.ts + index；domain/fitness-planning.ts + index；domain/tests/fitness-planning.test.ts | FIT02候选 → V2上下文/计划strict契约、纯校验与Provider Port。一个组合case验证三阶段、固定引用及总时长/替代参数拒绝。 |
| FIT-03b | fitness/repository、planning-context；追加migration；Core定点context test | V2契约 → 本Owner画像、最近14天至多5反馈、授权FITNESS记忆/候选hash与预览。旧revision保留，缺失风险信息不推定安全。 |
| FIT-03c | health-capabilities契约、health-loop/repository、追加migration、Core定点capability test | V1/V2共享每天5次训练预算；V2声明与运行日志，不假装已有真实调用；旧行保留。 |
| FIT-03d | fitness/service、repository、proposal-applier、feedback-memory、Core定点loop test | Fake V2 → 草案/编辑/提案/确认待办与TimeRequest → 反馈/记忆 → 下次上下文；重放不多调用，风险/版本/来源失效不写入。 |
| FIT-03e | fitness/routes、app装配、Core定点routes test | `/v1/fitness/planning/*`接口接通（覆盖规划建议的/v2路径），不改BFF任意版本转发；旧入口兼容，鉴权/Owner隔离。 |
| FIT-04a | fitness/deepseek-workout-planning、app、fitness/routes、Core adapter test | 既有凭据服务 → 有界真实adapter；Fake HTTP验证，未配置503零fetch，坏输出受控；不得连带使饮食READY。 |
| FIT-04b | fitness-workspace、workout-review、Web定点test | 画像/授权预览/详细计划/确认/真实反馈输入/记忆状态；响应式沿用，失败不能显示成功。 |
| FIT-04c | 合成E2E adapter/bootstrap、专用fitness spec、runner/必要evidence helper | 整个健身版本一次聚焦浏览器：草案→确认→静态排程→反馈→再次规划；专用数据目录、Fake标识、零外网。 |

接口依赖预检：FIT02输出不可变来源/独立资格，03a不得修改其上游原文；03b和03d共用repository须串行；03c扩展能力SQL CHECK与TS契约必须同步；03e与04a共用app/routes须串行；04b消费03e稳定响应和04a可用状态。各子切片证据独立，但FIT03整体修复问题连续计数，不能重命名重置失败预算。类型/构建在最终受影响workspace集中检查，不每步全套；具体新增函数以已核对的交付接口更新，不盲抄规划建议。无真实权限时仍完成本地程序闭环，真实外部数据/调用另标未验证。

并行边界：03a纯schema/validator不读取FIT02数据库或review DTO，消费独立的冻结候选值，允许与02并行。03a暂不写contracts/index.ts（归02）；只写fitness-planning新契约、domain新纯逻辑/index和定点test。公共导出及import归03a后续集成，在02释放文件后完成，未集成前不标完成。两者不共享写文件/迁移/测试端口；不运行全套。FIT02实际定义PlanCandidateV2为外部资格候选；03a通用候选采用WorkoutPlanningCandidateV2避免同名，03b显式转换而非修改上游。

预算解释校正（尚未发生FIT03修复）：上表是预先划分的独立可验收任务，每项按用户“每任务最多2轮”执行；同一缺陷跨任务继续累计，不能挪到新编号重置。此前“FIT03整体连续计数”指同一问题，不把相互独立的首次实现错误任意汇总成整版停止门槛。

03b集成准备：保留旧FitnessRepository方法返回类型，追加V2专用读取/写入方法，内部复用SQL，避免一项存储任务使全部V1调用方类型失效。V1误读V2的受控409由03d/e接线时落实，不能留下500。预览建立owner+contextHash绑定的有界本地request记录（保存选择/引用而非复制完整健康正文），创建时从该记录重建相同候选/记忆选择与当前版本进行hash复验；不能从客户端hash臆造曾经同意的payload。预览时间不等于实际同意时间，consentedAt必须在真实确认创建时记录。记忆选择用当前有效revision的UUID映射到实体/领域，删除后不读历史revision补回。此段待03a最终契约/复核后再执行，不是新功能已落盘。

03a实施交回：Terra Max Dewey已交5文件，单Domain case1/1及contracts/domain类型通过，测试夹具窄类型修复1/2；独立通用候选WorkoutPlanningCandidateV2与02名称分离。报告/精确diff遗漏已要求补交，不重跑、不算业务新修复轮次；随后聚焦review，未标完成。主核对contract hash528460d8b372734552c44a8a6d8d1a367157b3f42046f5433b7f6265697f98fa、validator hash ee14c981a52bd834c2c60e3aa8adbed5064cd813867e722f36acf6f31b8e3544。

03a证据已补交，Astra medium Bohr进行只读限定复核。02的R1已将完整资格过滤和LIMIT下推SQL，同case1/1；测试固定27→28，最终hash3477A800CC2F7866A3BDAF699400077DE880EEEDBCA0EF2E84FB5B4EA15B382F。后次Core typecheck受并行03c未完成接口影响exit1，未把早先类型PASS当最终工作区PASS；Epicurus正在限定复核，不重跑。

FIT04a独立adapter可先行：Terra Max Dirac仅写fitness/deepseek-workout-planning.ts和对应单测试，消费已存在V2端口；app/routes仍后续串行接线。固定既有endpoint/model、凭据短暂解密、8秒取消、24KB输入/64KB响应信封/12KB内容、无重试/工具/redirect、无配置503零fetch。Fake credential/HTTP单组合case，不真实联网，不提前宣称默认服务已可用；本项与后续接线共用修复预算，不以子名称重置。

03a限定审查：Bohr实际spawn为gpt-6-astra/medium，复用1case及哈希，发现4项有效P2：预览强制consentedAt、可选身体正文缺授权交叉校验、receipt与payload字段/候选集合不完整匹配、多个替代项组合可能超预算。原Terra正在R2/2最后一轮合并修正，保持单case和旧V1；同一缺陷不能在后续任务重置预算。Core身份/14天查询/资格实时性仍属于后续任务，不误要求纯校验器读库。尚未观察真实数据泄露或实际用户计划受损。

FIT02 R1限定Spec/Quality已通过（Epicurus）：SQL完整过滤后LIMIT≤5，排序靠前的不匹配记录不遮蔽后续匹配；固定27→28及原来源/事务边界保留，无新增有效阻断。此为切片本地通过，后续集中类型检查仍待执行。原Carver接03b上下文/仓储切片，先只读准备接口，迁移等03c释放后由主明确GO；共享迁移不并发写入。

FIT02-IMPORT独立交付入口：原parser/repo只有程序内调用，不能当作用户已能导入。新增本机cli/fitness-catalog.ts及一个合成import test，显式已有data-dir/JSON绝对路径/固定revision，文字32MiB边界，已有库/表才可导入，不自动迁移、下载或制造审核资格；同版冲突零写入。此为原数据接入需求的操作入口，不是增加外部服务或重置02缺陷预算；初次实现最多2局部修复。由Terra单独实现，其他repo/migration不改，真实下载/导入仍待授权。

03a R2限定复核（实现已修、验收PARTIAL）：Bohr核对最终hash531ebb8a（契约）/6422ddbc（validator）与报告一致，原4个实现问题均已解决。新增证据缺口：单case双替代反例的第一替代单独已2140秒>1200秒，先触发单个超时，generic错误前缀断言不能证明组合门禁。未观察业务算法错误；但不能把1case绿色当组合分支覆盖。2/2预算耗尽，Dewey已要求停止改测；主异步请求一次仅改反例数据/精确错误断言的额外授权，待答复。03b不越过此门禁，03c/04a独立adapter/离线导入可继续不受影响部分。证据见evidence/2026-09-18-fit03a-r2.md/.diff，原FAIL与预算保持。

03c实现交回：追加29，旧运行30列、索引及跨表Owner trigger保留，增加WORKOUT_DETAILED_PLANNING/HEALTH_DISCLOSURE_V2与countReservedWorkoutCalls。主读取原始日志：目标单case1/1、Core typecheck exit0；第6次V1调用在新旧合计5次后429，providerCalls0。Astra medium Planck限定复核中；迁移文件写入已释放但03b仍受03a门禁。报告初称业务修复1/2、另3个fixture调整未计，主要求补真实失败/修改顺序再裁定，不能只因测试调整就排除预算。初版.diff实际是摘要而非完整补丁，也已要求补真实差异；不把证据补交当新业务修复授权。

03c限定复核通过：Planck实读5文件hash/日志，旧表30列/约束及三个跨表trigger静态一致，无有效P0/P1/P2；不宣称测试逐列覆盖全部旧行或所有跨Owner分支。完整diff已补交（40416bytes，SHA96C26110146DC2555AE8B1809E3276DF2612C8E5408BC49C9E52E1089E3D2910）。计数纠正为**至少2轮、预算视为2/2已用尽**：初始RED之外保存日志显示2次失败重验，最终1/1；另外500/422诊断无独立原始日志，不能断言全部修复仅两轮，也不因fixture标签豁免。后续同问题无剩余修复额度。源码未因补证据再改。

FIT02-IMPORT初版：Godel交回2文件，合成1case1/1（含真实子进程CLI重放及冲突exit1），实现后修复0/2；没有真实导入。Planck正在限定复核。Core类型检查待适配器稳定后集中一次，不用此前03c的类型PASS覆盖晚落盘CLI。

FIT02-IMPORT复核：Planck静态无有效P0/P1/P2，但初交报告没有可定位原始运行输出，证据PARTIAL。主于17:09:10仅补跑原同一文件 `npm run test --workspace @ev/core -- tests/fitness-catalog-import.test.ts`，exit0/1文件1case通过；原始日志 `C:/Users/asus/AppData/Local/Temp/fit02-import-main-6cb3f647c68d411ab3efaa44981a3ed4.log`。没有业务/测试修改，修复仍0/2；路径拒绝/超限/缺schema等未动态穷举，只有静态检查，不扩展覆盖声明。

FIT04a独立adapter交回：Dirac新增adapter/test，2/2修复已尽（预取消promise未处理拒绝、async iterable类型收窄），同case最终通过；尚未装配app/routes，不能从网页使用。主于17:12:47补原始输出 `npm test --workspace @ev/core -- tests/deepseek-workout-planning.test.ts` exit0/1文件1case，日志 `C:/Users/asus/AppData/Local/Temp/fit04a-main-492e9b6fcae747c6a5d85575cc0cca7a.log`；仅Fake HTTP/credential，未真实调用。Planck限定复核中。

集中Core类型检查发现FIT02-IMPORT的 `cli/fitness-catalog.ts:215 TS2366`，非adapter错误；已交Godel R1/2仅修never/return控制流，再同case+Coretypecheck一次。不能把此前import运行通过当作类型通过；旧失败记录保留。

FIT04a限定复核PARTIAL：Planck核hash/主1case原始日志，确认配置/请求/解析主要边界，但发现有效P2响应清理缺口。超64,000字节或非2xx直接抛错时signal尚未abort，iterator.return/reader.cancel条件不成立；外层finally又清除8秒timer，响应资源可能继续存活。只有静态控制流证据，未证实泄露或实际网络故障；原Fake测试仅验证拒绝错误码，没验证cancel。阻断本片有界资源验收。预算2/2已尽，源码已冻结，主另异步请求一次仅清理/同case断言修正授权。不得以03e装配任务名修此旧问题或重置预算。

### 本轮暂停交接（等待限定授权，不是健身闭环完成）

| 项目 | 最终状态与证据边界 |
| --- | --- |
| 原项目退役修复R4 / 阶段保存 | 限定浏览器1case通过并独立复核，2634a28已推现有分支；不合并/tag/Release。 |
| FIT02目录与资格 | DONE（限定）；固定27→28合成1case、独立复核通过，无真实下载/导入。 |
| FIT02-IMPORT本机入口 | DONE（限定）；R1仅两处return fail，17:14:13原case1/1、Core typecheck exit0，Planck R1复核通过。最终CLI hash4BB69A53…，test未变；修复1/2。 |
| FIT03a详细计划契约/纯校验 | PARTIAL；4项实现静态已修，2/2已尽，单case未真正覆盖组合替代超时门禁，等待额外仅测试修正。 |
| FIT03c运行/额度/迁移29 | DONE（限定）；1case及独立静态复核通过。修复预算按至少2轮视为耗尽，不豁免未完整保存的fixture诊断。 |
| FIT04a独立DeepSeek适配器 | PARTIAL；Fake同case1/1，2/2已尽，响应提前拒绝后的资源清理P2未修；未装配默认server。 |
| FIT03b/d/e与FIT04b/c | 尚未实现；上下文/画像持久化、计划服务/反馈记忆、API、页面和最终健身浏览器闭环均不能标完成。 |

主最终核对HEAD2634a28、codex/product-prd、暂存区为空；上述健身新增改动仍未提交/推送。CLI/adapter最终hash与各报告一致。最新Core类型检查已通过；contracts/domain复用03a最后代码的类型结果。Web构建、最终健身浏览器路径、全仓测试、真实Provider、真实数据和生产验证均未运行。`git diff --check`排除历史evidence补丁后无诊断；该检查不声称覆盖所有未跟踪文件。

没有重启用户预览或触碰日常数据。已更新TECH_SPEC/API/DATABASE及本唯一进度；原FAIL/初版证据保留。恢复只需先处理顶部两个限定授权，批准后在原任务上追加一次修正并原审查复核，不以新任务重置预算；随后继续既定健身链路，不重做规划、不恢复项目分析。

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
