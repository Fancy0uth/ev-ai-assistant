# 公开依据核验工具

此工具处理固定版本动作资料，不写生产数据库，不生成专业审核资格，不直接放行推荐。
`PUBLIC_EVIDENCE_COMPLETE` 只代表证据包通过当前结构检查；语义真伪必须独立复核，接入推荐还需用户适用范围与运行时校验。

## 输入与执行

- `data/fitness-audit/catalog.json`：从正式库只读导出的公开动作行，不含Owner信息。
- `pilot-evidence.json`：20条试审的已读取来源摘要、日期、逐项比较与缺口。摘要hash不是完整网页hash。
- 每条assessment绑定sourceId、revision、upstreamId、itemHash和完整输入hash；任何输入改动使旧结论失效。
- `prepare-pilot.mjs`仅用于重建最初试审，不在续跑时执行，避免覆盖后续研究。

```powershell
node scripts/fitness-audit/run.mjs data/fitness-audit/catalog.json scripts/fitness-audit/pilot-evidence.json data/fitness-audit/results
node --test tests/fitness-audit.test.mjs
```

一次最多20条；相同输入/证据不重复处理。CLI本身零网络/模型调用，真实查证由当前Codex任务使用联网工具完成，调用记录另计，不能把CLI的零调用当作整体研究成本。

## 续跑规则

1. 从全量results找PENDING_RESEARCH；每轮最多20条，先读完整英文/中文步骤，不只读名称。
2. 使用权威原文按动作族检索，缓存已读来源；同族仍逐条核对负重、支撑面、单/双侧、动态/静态、动作幅度。确实无对应依据时列明已查范围与缺项，不能宣称全网不存在。
3. 为每条写实际查证结果，已有相近文献不能冒充精确变式。检索失败保留待查和失败原因，不标研究完成。记录搜索词、实际打开URL、访问日期和段落位置。
4. 仅有充分证据时准备完整结论；严格检查两位核验者标识、精确变式、人群、器械、限制、数值剂量及逐条来源定位。AI身份不得冒称临床资格。
5. 独立复核与程序校验通过后，才讨论对应候选接入。当前所有结果recommendationEnabled=false；没有通过条目时保持生产原样，不为了非零通过率降低标准。
6. 每批更新唯一plans/TASKS.md：新增比较数、待查数、缺口、实际外部调用、异常原因。源资料或政策变化重新查受影响结论，成功无变化的不重复研究。

状态：PENDING_RESEARCH=未完成查证；MISSING_EVIDENCE=已查范围内缺依据；CONFLICTING_EVIDENCE=有具体矛盾；PROFESSIONAL_REVIEW_REQUIRED=当前产品范围不能解决；PUBLIC_EVIDENCE_COMPLETE=结构完整且独立复核后待接入。最终验收要求1324条无待查、每条有真实依据或具体缺口、运行时放行/阻断及来源变化验证；全量初筛不等于最终完成。

来源归档保留短摘要及定位，不收录整页版权正文或媒体。不要并发写同一个输出目录。
