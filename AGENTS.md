# 文档与执行约定

先读 [PROJECT_BRIEF](docs/PROJECT_BRIEF.md)，再读任务对应规格；[plans/TASKS.md](plans/TASKS.md) 是唯一进度，其他入口只链接，不双写。

## 执行授权与边界（2026-09-08）

- 2026-09-18 最新授权优先：定点修复项目退役的 V9 浏览器测试后连续实施已批准 FIT-02/03/04 健身闭环；无需小步骤再次询问。用户另明确授权在限定复核/敏感检查通过后将累计阶段改动提交并推送 `codex/product-prd`，不合并 main、tag 或 Release。此项覆盖下方历史禁止提交/推送条款，仅限已授权阶段保存；真实数据、API费用、下载安装和生产权限仍单独确认。当前契约/修复预算只见 TASKS 顶部。

- 2026-09-16 最新产品决策：项目分析/本机项目授权/项目对话/晨间项目分析/专属 Codex 接入取消。旧 V8-01/02、PC、C1/C2 计划与历史授权不再驱动继续开发或调用。保留普通任务、日程、其他领域及历史数据/迁移兼容。唯一当前退役契约见 TASKS 顶部；不清理用户仓库、独立 Codex 或 Docker 资源。

- 最新 V9 授权优先于下方 V8 历史轮次约束：沿用 V8 实际 Terra Max 实现、Astra medium 少量聚焦只读审查，继续既有 V9-01～06，不从零架构。V8 是本地限定 PASS，不是真实 Provider/生产 PASS，也没有 PASS commit。唯一现行契约见 TASKS 的 V9 节、技术正文见 TECH_SPEC §13。
- V9 可开发业务代码、可逆脚本及隔离合成测试；实际网络、Tailscale 安装/登录/Serve、防火墙、任务注册/删除、主机重启、真实库备份/恢复、个人数据、付费 API、push/发布均须用户另授权。主 Agent 不能自行代替用户授权。禁止 stage/commit；全部 dirty 保留。
- 文档规划Agent已完成并交回规范文档写入权；实现Agent仅写各自明确代码范围，主Agent维护规范文档与唯一TASKS，避免并发双写。每任务1成功+关键阻断（可合并一case），最终affected typecheck/build+至多1本地浏览器主路径；缺已装WebKit标NOT RUN、不安装。物理部署门禁保留，缺证据overall PARTIAL，不称完整V9 complete。

- 用户本轮允许定点修复、前置独立复核，并在门禁通过后实施 V8 业务与最小测试；具体门禁、任务范围、修复次数与当前状态只见 TASKS。不得以其他 agent 的成功报告替代独立复核。
- 本轮禁止 stage、commit、push、网络与安装。真实 API、真实数据/项目目录、凭据、生产/部署/发布等超出当前范围的动作需另授权。
- frontend = `apps/web`，backend = `apps/core`。文档规范化不授权重构业务目录、建空壳或 compose；业务实施按任务文件范围复用现有服务。
- 一个内容一个权威正文；旧入口改链接。保留 PRD 批准记录，历史 review/release/ADR 原样保留；目标设计不得宣称已经实现。
- V8 保持 01～05 映射与三条增量链。进度、证据、下一步与最小验证预算只维护在 TASKS，不在 .agent 或旧 plan/todo 双写。
- 对业务改动仅执行任务小契约的最小测试，禁止根 npm test、全迁移、全站 E2E；整版仅一条聚焦 browser happy path。修复轮次与用户最新持续收尾授权以TASKS为准，保留历史计数、不换任务名重置。
- 明确区分 LOCAL_RULES 静态建议与外部 Provider 模式；后者无配置返回 503，不静默降级或伪造调用结果。
