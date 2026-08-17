# EV AI Dashboard：v0.3 Daily AI Control Loop 实施总览

| 字段 | 内容 |
| --- | --- |
| 状态 | In progress — Provider 安全底座、每日计划契约、脱敏 Context Builder，以及 V3-06 的生成、确定性校验和草案保存已完成；下一步为草案编辑、部分确认、拒绝与日程版本冲突处理。 |
| 权威输入 | [v0.3 规格](../docs/superpowers/specs/2026-08-17-v0.3-daily-ai-control-loop.md)、[v0.3 计划](../docs/superpowers/plans/2026-08-17-v0.3-daily-ai-control-loop.md)、[ADR-012](../docs/decisions/ADR-012-dpapi-secrets-and-proposal-only-daily-ai.md) |
| 历史计划 | v0.2 和本地基础 MVP 计划保留在 `docs/superpowers/plans/`；当前文件只跟踪下一条真实 AI 闭环。 |

## 实施顺序

1. **安全 Provider**：DPAPI SecretStore、DeepSeek adapter、连接测试与错误状态。
2. **可确认计划**：最小 Context Manifest、Daily Plan Run、结构化 Proposal、确定性校验与部分确认。
3. **首页产品化**：日程优先 Today、计划审阅、桌面/iPhone 响应式。
4. **调度与验收**：07:00 幂等触发、首访补偿、独立 E2E、缺陷和验收文档。

## 依赖图

```text
SecretStore + Provider profile
  └─ DeepSeek connection test
       └─ Daily plan contracts + migration
            └─ Context builder + deterministic validator
                 └─ Proposal review / partial apply
                      └─ Today redesign + 07:00 + E2E
```

## 质量门

- 每个切片：先写失败测试，最小实现，运行目标测试，独立提交。
- 每两到三个切片：`npm test`、`npm run typecheck`、`npm run lint`、`git diff --check`。
- 进入 E2E 前：所有单元/集成测试绿；E2E 使用独立端口与 `EV_DATA_DIR`。
- 交付前：记录实际测试范围、未覆盖范围、发现的 bug 和对应修复，不以模拟 Provider 伪造真实连接。

## 绝不跨越的边界

- 不让 Agent 写项目、日程或外部系统；日程只由确认 Proposal 应用。
- 不在仓库/日志中存密钥，不上传本地记忆/完整项目/健康历史。
- v0.3 不实现 OCR、公开搜索、Project Agent、健身/饮食智能链路、多 Agent、Apple 日历、手环、学校登录、多用户、Docker、公开 Core 或原生 App。
- 新依赖、SecretStore 实现、不可逆迁移与远程部署按 ADR-012 的安全门审查。
