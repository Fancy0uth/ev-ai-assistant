# V07-LINEAGE-015 独立聚焦复核

本轮限定验收：**PASS**。仅针对该缺陷及直接影响，未发现新的严重阻断项；不是整版审查或发布 PASS，不改写历史 FAIL，不代替主 Agent 的后续关门决定。

## 目标与依据

- 工作区：`C:/Users/asus/Documents/ev-ai assistant/.worktrees/product-prd`。
- HEAD：`50b533804be24f8963492679127f72e39ff4f7dd`，加未提交的 nutrition repository/service 补丁及定向测试。
- 历史依据：`docs/reviews/2026-08-31-v0.7-sol-rereview-2.md:71` 的 V07-LINEAGE-015：部分来源键复用造成错误法律元数据、不可验证 record hash 进入已确认 Meal。其他历史条目不在本轮验收范围。

## 核对结果

- 完整身份：`repository.ts:189,338,356` 用 Owner + kind/id/version/datasetHash 定位，再严格比较 redistribution、licenseDecisionId、adapterKind、evidenceKind；补齐历史缺失字段。相同 descriptor 不触发拒绝（静态确认）。
- 受控失败：`service.ts:304` 转换为 `ApiError(409, NUTRITION_SOURCE_DESCRIPTOR_CONFLICT)`。直接关联的 `completeExternal` 会先回滚业务事务，再记录失败终态；HTTP 错误处理器保留该状态及错误码（静态确认，未另跑 HTTP 测试）。
- 原子性：检查处于 `saveMatches` 事务内，早于 food snapshot、revision、草稿状态写入。测试确认冲突后来源/食物快照/revision/Meal/entry 数量不变、原 descriptor 未变，冲突草稿仍为初始 revision/version、UNMATCHED 且无快照；确认返回 `422 MEAL_MATCH_INCOMPLETE`，无新增 Meal。失败运行/幂等记录是有意保留的失败证据，不属于业务回滚对象。
- 正常链：同一测试先完成来源 A 的匹配、选择、确认，断言 CONFIRMED；来源 B 使用同键但不同 redistribution/licenseDecisionId，且记录 hash 按 B 的完整 descriptor 正确计算。既有 provider 边界仍校验 hash 与 descriptor 一致，冲突不再污染持久化 lineage。

## 最小运行证据

独立执行且仅执行一次：`npm test --workspace @ev/core -- tests/v0.7-lineage-015.test.ts`。

结果：exit **0**，**1 文件、1/1 用例通过**（该用例合并正常链和冲突阻断链），Vitest 4.1.10，耗时 822ms。未用 Terra 的成功声明代替独立证据。未扩展字段组合矩阵；相同 descriptor 的重复复用、adapter/evidence 单字段碰撞仅静态核对，不宣称分别有动态覆盖。

运行前后以下 SHA-256 一致，限定结论绑定此内容：

| 文件 | SHA-256 |
| --- | --- |
| `apps/core/src/modules/nutrition/repository.ts` | `5CBF02EEB1459CFB06E5F7825ABD772CBDBFB85CD004BCD5070156CA421CDB3F` |
| `apps/core/src/modules/nutrition/service.ts` | `D390169714D108D9538AA8483A27A7F1F4704436033D59ED379A420435697E04` |
| `apps/core/tests/v0.7-lineage-015.test.ts` | `017158873BBF038FA06AEDFC007233DB4065EA26D493CBDA9720D9AEC546FBCB` |

唯一写入文件为本报告。未改产品代码、测试或历史 review；未审查并行文档收口差异，未执行全量测试、历史迁移矩阵、网络、安装、stage 或 commit。定向测试仅使用内存数据库及本地合成 provider。
