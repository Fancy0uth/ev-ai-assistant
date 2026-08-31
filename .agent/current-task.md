# TASK-V7-01：冻结 v0.7 公共契约

## 当前目标

v0.7 整版执行设计与七任务计划已由 Sol 冻结并经主 Agent 全文审核，计划提交为 `60fca20`。当前由同一个 Terra 从 V7-01 开始，先以 RED 测试冻结 Fitness、Nutrition、health capability 与 `CREATE_WORKOUT_ACTION` 公共契约；完成后自动连续执行 V7-02–V7-07，不在任务间等待用户确认。

## 已知产品缺口

- 健身现状只有 Owner check-in → 确定性 recovery Signal；尚无有来源动作目录、受限检索、Workout Proposal、TimeRequest 和训练反馈闭环。
- 饮食现状要求用户直接填写营养数值；尚无自然语言候选、权威 Food Data Provider、Core 确定性计算和确认后入账闭环。
- v0.7 必须复用 Proposal+Confirm、Owner-scoped 本地数据、v0.5 Provider envelope 和 v0.4 TimeRequest，不做医疗诊断，不把模型猜测数值写入数据库。

## 执行门

- 动作数据集的来源、许可证、版本、hash 和再分发边界必须在导入前冻结；许可不清则不导入。
- 权威营养数据 Provider 的接口、单位、版本和未配置行为必须冻结；任何真实 API、网络、Key、费用或个人数据外发都需要主 Agent 单独审批。
- 自动测试可使用明确标注的本地 fixture/Fake port，但不能冒充真实动作目录或真实营养数据证据。
- Terra 严格按 `docs/superpowers/plans/2026-08-31-v0.7-fitness-nutrition-loop.md` 执行 RED→GREEN→focused gates→原子提交；不得临场改变冻结接口。

## 最近准入证据

- v0.6 root tests 634/634；typecheck/build PASS；lint 0 error、4 个既有 warning；完整 desktop+iPhone E2E 8/8。
- v0.6 最终 Sol rereview-3：P0=0、P1=0、P2=6、P3=0，Verdict=PASS。
- v0.7 整版执行设计/计划提交 `60fca20`；七任务、migration v20、内部 8 项动作目录、BigInt micros 和 production fail-closed 均已冻结。
- 真实 Vision/Search/DeepSeek/在线数据源/个人数据仍为 `NOT RUN — APPROVAL REQUIRED`。
