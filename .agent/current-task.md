# TASK-V0.7-00：Sol 整版规划与执行门冻结

## 当前目标

v0.6 已由全新 Sol 在 TARGET `7ba44fb` 上整版复审为 PASS：P0=0、P1=0、P2=6、P3=0；准入文档提交为 `b3b6409`。当前进入 v0.7 Fitness and Nutrition Loop 的整版分析阶段，由 Sol 基于 v0.6 PASS 入口重新审视既有计划、现有 v0.3 健身/饮食底座和执行期依赖门，再冻结一个可由 Terra 连续完成的整版任务文档。

## 已知产品缺口

- 健身现状只有 Owner check-in → 确定性 recovery Signal；尚无有来源动作目录、受限检索、Workout Proposal、TimeRequest 和训练反馈闭环。
- 饮食现状要求用户直接填写营养数值；尚无自然语言候选、权威 Food Data Provider、Core 确定性计算和确认后入账闭环。
- v0.7 必须复用 Proposal+Confirm、Owner-scoped 本地数据、v0.5 Provider envelope 和 v0.4 TimeRequest，不做医疗诊断，不把模型猜测数值写入数据库。

## 执行门

- 动作数据集的来源、许可证、版本、hash 和再分发边界必须在导入前冻结；许可不清则不导入。
- 权威营养数据 Provider 的接口、单位、版本和未配置行为必须冻结；任何真实 API、网络、Key、费用或个人数据外发都需要主 Agent 单独审批。
- 自动测试可使用明确标注的本地 fixture/Fake port，但不能冒充真实动作目录或真实营养数据证据。
- 先由 Sol 输出一份新的 v0.7 整版分析/执行文档；主 Agent 审核边界后，再交由 Terra 按 TDD 连续实现。

## 最近准入证据

- v0.6 root tests 634/634；typecheck/build PASS；lint 0 error、4 个既有 warning；完整 desktop+iPhone E2E 8/8。
- v0.6 最终 Sol rereview-3：P0=0、P1=0、P2=6、P3=0，Verdict=PASS。
- 真实 Vision/Search/DeepSeek/在线数据源/个人数据仍为 `NOT RUN — APPROVAL REQUIRED`。
