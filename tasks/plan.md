# EV AI Dashboard：MVP 实施总览

| 字段 | 内容 |
| --- | --- |
| 状态 | 已获目标模式授权，待执行 |
| 权威输入 | [PRD](../docs/product/PRD.md)、[MVP](../docs/product/MVP-SCOPE.md)、[TECH_SPEC](../docs/technical/TECH_SPEC.md)、[ARCHITECTURE](../docs/technical/ARCHITECTURE.md) |
| 历史计划 | v0.2 Dashboard 稳定化历史保留在 `docs/superpowers/plans/2026-08-10-v0.2.0-dashboard-stabilization.md` |

## 实施顺序

1. **基线恢复**：先使 workspace 安装、Core 契约和 Web 测试恢复可信。
2. **日程核心闭环**：Contracts/Domain、SQLite 加法迁移、Event/Action/Signal、Proposal 事务与 Today 聚合。
3. **课表输入与每日协调**：上传、Provider Port、候选/周次展开、确认、07:00 Job。
4. **专业模块**：本地记忆、项目快照、课程、健身、饮食；每个模块只完成 MVP 最小纵向链路。
5. **Web 控制台**：真实路由、首页、日程与详情页、设置/记忆/Agent 状态；桌面和 iPhone 响应式。
6. **验证与交付**：最小自动化、浏览器流程、缺陷记录和修复、质量/验收文档。

## 依赖图

```text
Baseline
  └─ Contracts + Domain
       └─ Migration + Repositories
            └─ Proposal + Day View
                 ├─ Course import + daily scheduler
                 ├─ Memory + Provider configuration
                 ├─ Project snapshot / Learning
                 └─ Fitness / Nutrition
                      └─ Web pages + iPhone layout
                           └─ E2E, bug fixes, acceptance
```

## 质量门

- 每个切片：先写失败测试，最小实现，运行目标测试，独立提交。
- 每两到三个切片：`npm test`、`npm run typecheck`、`npm run lint`、`git diff --check`。
- 进入 E2E 前：所有单元/集成测试绿；E2E 使用独立端口与 `EV_DATA_DIR`。
- 交付前：记录实际测试范围、未覆盖范围、发现的 bug 和对应修复，不以模拟 Provider 伪造真实连接。

## 绝不跨越的边界

- 不让 Agent 写项目、日程或外部系统；日程只由确认 Proposal 应用。
- 不在仓库/日志中存密钥，不上传本地记忆/完整项目/健康历史。
- 不实现 Apple 日历、手环、学校登录、多用户、Docker、公开 Core 或原生 App。
- 新依赖、外部 Provider、不可逆迁移与远程部署按 TECH_SPEC 的安全门审查。
