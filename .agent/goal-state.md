# 长任务状态

## 最终目标

从 v0.5 工程 PASS 基线连续交付到 v0.9 本地个人 AI Dashboard MVP：课程与学习、健身与饮食、只读项目与长期记忆、跨模块日程协调、私有 iPhone Web 访问及本地运维均有可验收闭环。

## 当前里程碑

M1 / v0.6：课程、课表截图与学习排程闭环。

## 当前任务

TASK-V6-04 已完成实现、TDD、Sol 身份修复、Owner credential-aware DeepSeek 编排与 capability evidence/call-count P1 修复及冻结工程验证，待主 Agent 创建 `feat(learning): schedule cited study actions`。V6-01 `8ee52e1`、V6-02 `4b4e218`、V6-03 `b99fdce` 均已提交；Terra 不在此工作树执行 Git staging/commit。

## 已完成任务

- v0.4 Action Scheduling Foundation：工程 PASS。
- v0.5 Provider Reliability：工程 PASS；关版提交 `155b172`。
- TASK-V6-00：v0.6 单次 Sol 整版分析与实施契约冻结完成；四个垂直任务已写入独立计划。
- v0.6 计划与长期任务状态已提交为 `d5d4ea5`；该提交不改变产品运行行为。

## 下一任务

主 Agent 代办 V6-04 原子提交后，按冻结流程对 v0.6 执行一次 Sol 里程碑审查；P0/P1 为零且审查 PASS 才可作为 v0.7 入口。

## 当前阻塞

无工程规划阻塞。真实 Vision、Search、DeepSeek 调用和供应商/Key 尚未授权，不阻塞确定性实现；生产必须 `BLOCKED_PROVIDER`，真实验收记录为 `NOT RUN — APPROVAL REQUIRED`。

## 最近测试结果

V6-04：Contracts focused 25/25、Core focused 43/43、Web focused 47/47、root typecheck（4 workspaces）、focused ESLint、Web build、V6 desktop+iPhone E2E 1/1、`git diff --check` 均 PASS。最后 P1 focused 重跑为 Core 3 files/16、Contracts 3 files/25、root typecheck、focused ESLint 全 PASS：production preflight evidence=NONE，成功 terminal 才按实际 adapterKind 写 REAL_PROVIDER/AUTOMATED_FAKE；CredentialNotConfigured/SecretStore/factory 为 0 calls，generate/strict Vision output failure 为 1。Owner configured→AWAITING_DISCLOSURE→一次 text adapter、missing credential→BLOCKED/零 call、解密/模型事务外和无 secret 持久化/response 均有自动断言。E2E 从实际 Core 响应验证每轮 UUID `courseId → actionId →timeRequestId → scheduledEventId`，并验证 desktop 后 1 个、iPhone 后 2 个同名 Action/STUDY Event 的精确集合。`git diff --exit-code -- apps/core/src/storage/migrations.ts` PASS，v19 未改。测试只使用 runner-owned 临时目录与三重门 Fake，未打开真实 socket。

v0.5 关版前主 Agent 复核：Core 20/20、Web 71/71、root typecheck 4/4、关键 E2E 1/1。本次只改规划/状态文档，未运行产品测试或构建。2026-08-31 Level 0：`git diff --check` PASS（仅 LF→CRLF advisory）、允许文件 PASS、基线/分支/必需输入 PASS、声明路径 PASS、package scripts PASS、四任务/关键契约覆盖 PASS、禁用标记与文本完整性扫描 PASS。

## 尚未验证风险

- v0.6 视觉与公开搜索能力没有获批供应商或真实 Provider；兼容 adapter 未配置时完整外部链保持阻断。
- v0.5 仍有一项 P2：自动 E2E 属于混合证据，不能替代真实 Provider 验收。
- V6-01、V6-02、V6-03 已分别提交为 `8ee52e1`、`4b4e218`、`b99fdce`；V6-04 已保留为完整未暂存工作树，等待主 Agent 代办原子提交。
- V6-04 的 citation hash、Owner-scoped credential-aware text adapter、proposal 原子性、Action/TimeRequest/Today lineage、三重门 Fake 与 desktop/iPhone 浏览器证据均完成自动验证；真实 Search/DeepSeek/Vision Provider 和真实网络验收仍未获批。

## 最后更新时间

2026-08-31 Asia/Shanghai
