# 2026-09-16 项目分析模块移除（REMOVE-01 / REMOVE-03）

## 基线与机械 delta

- 分支 / HEAD：`codex/product-prd` / `50b533804be24f8963492679127f72e39ff4f7dd`（开始与结束相同；未 stage、commit、push、stash 或 reset）。
- 本轮前快照：`C:\Users\asus\AppData\Local\Temp\codex-project-removal-20260916-89c81befc1cc408482dd997251ee898f`，建立时间 `2026-09-16T20:12:06.3265479+08:00`。它覆盖本轮候选文件及原有未跟踪候选内容。
- 机械 delta：`plans/evidence/2026-09-16-project-removal.diff`；由快照与当前文件逐项执行 `git -c core.autocrlf=false diff --no-index --binary` 生成，64 个 diff header（34 删除、28 修改、2 新增），无手写 diff 内容。
- delta SHA-256：`CEBFCA61D6179FC293AA3302FA2A35DB071B661D5E2277571ED5BA457E079CA6`（370,756 bytes）。

## 文件与移除内容

新增定点回归：

- `apps/core/tests/project-retirement.test.ts`：组合覆盖 Core `/projects` 路由退役、历史 `PROJECT` ACCEPT 的 409/零写入，以及普通 `WORK` 任务仍可创建。
- `apps/web/tests/project-retirement-navigation.test.tsx`：保留五个非项目导航入口、移除项目入口并校验计数。

删除的纯项目专属文件（34）：

- Core CLI / 模块：`apps/core/src/cli/projects.ts`；`apps/core/src/modules/projects/{conversation-context,conversation-repository,conversation-service,proposal-applier,repository,routes,scope-service,service,snapshot}.ts`。
- 项目契约与项目页面：`packages/contracts/src/projects.ts`；`apps/web/src/app/(dashboard)/projects/{page.tsx,[id]/page.tsx}`；`apps/web/src/components/projects/project-workspace.tsx`。
- 纯项目测试：`apps/core/tests/{m1-project-external-preflight,project-conversation-context,project-conversation-repository,project-scopes,v0.8-project-brief,v0.8-project-cli}.test.ts`；`apps/web/tests/{m1-project-external-preflight,project-workspace,v0.8-project-scope}.test.tsx`。快照检查显示这些文件的测试入口或 import 均直接绑定 `modules/projects`、项目 CLI 或 `ProjectWorkspace`，没有独立的非项目断言。
- Codex 专属脚本源：`scripts/codex-container/{.dockerignore,auth-client.py,auth-gateway.py,Dockerfile,fetch-codex.py,isolation-probe.py,test_auth_transport.py,test_fetch_codex.py}`；`scripts/diagnostics/{codex-gateway-boundary.mjs,codex-gateway-boundary.test.mjs,codex-offline-probe.mjs}`。

修改的入口、契约与共享测试（28）：

- Core：`apps/core/{package.json,src/app.ts,src/modules/proposals/service.ts,src/modules/providers/service.ts,src/modules/today/routes.ts,tests/agent-run.test.ts,tests/memory-project.test.ts,tests/today.test.ts}`。
- 契约：`packages/contracts/src/{index.ts,providers.ts,today.ts}`。
- Web：`apps/web/src/app/api/core/[...path]/route.ts`、详情/内存/Provider/Today 组件，以及 `app-shell`、`core-proxy`、`provider-status`、`today-dashboard`、`v0.4-scheduling-workspaces`、`v0.8-memory-scope`、`v0.9-private-boundary` 定点测试。
- 共享 E2E：`apps/web/e2e/{domain-workspaces,v0.4-ui-origin-scheduling,v0.8-project-memory-coordination,v0.9-private-iphone}.spec.ts`。

共享文件恢复判断：

- `apps/core/tests/memory-project.test.ts` 已从快照恢复，保留两条内存 SQLite/Markdown 原子写入与投影失败回滚断言；仅删去单独的只读项目快照 `describe`。
- `apps/web/e2e/v0.8-project-memory-coordination.spec.ts` 已恢复，保留内存压缩、浏览器错误边界和 `LOCAL_RULES` 协调；用真实 UI 创建的普通 `WORK` 任务提供时间请求，不以假 stub 替代协调断言。
- `apps/web/e2e/v0.9-private-iphone.spec.ts` 已恢复，保留 setup/login、CSRF、CSP nonce、loopback 限制、浏览器诊断和 `LOCAL_RULES` 审核；同样以普通 `WORK` 任务替换原项目 Brief 输入，并继续校验已采用日程。

## 退役与兼容性

- `buildApp` 不再装配项目 repository/routes/services；Web 没有项目页、组件、导航或详情链接；BFF 对整个 `/api/core/projects/**` 分支返回 `405 PROJECT_MODULE_RETIRED`，且不转发到 Core。
- 旧 `PROJECT` 提案的 `ACCEPT` 在 repository 的事务回调内、提案状态和审计更新前抛出 `409 PROJECT_PROPOSAL_RETIRED`，外层幂等事务同样回滚。组合回归在同一合成 SQLite 数据库中比较提案行、审计数、actions 和 time_requests，确认完全无写入。`REJECT` 仍走通用拒绝决策，且已无项目 applier；本轮对 REJECT 仅静态复核，未运行专属 case。
- 运行时只接受 DeepSeek：Provider profile、Today status 和 agent-run 创建契约均没有活动 Codex/PROJECT_ANALYSIS 入口；DeepSeek 的既有用途保留。
- 为读取历史数据，`providerKeySchema` 中的 `CODEX_LOCAL`、`agentRunCapabilitySchema` 中的 `PROJECT_ANALYSIS`、历史 `PROJECT` memory/entity/proposal 数据与 migrations 均未删除或改写。`apps/core/src/storage/migrations.ts` 未改。
- 普通任务未删除，组合回归和恢复后的共享 E2E 均使用普通 `WORK` 任务。
- 定点生产源码扫描命中 4 处，全部为上述两处迁移和两处宽松历史读取枚举；没有运行时项目模块 import。隔离 Web build 列出 19 条路由，未含 `/projects`。

## 验证记录

| 阶段 | 命令 | 实际结果 / 退出码 |
| --- | --- | --- |
| RED Core | `npm test --workspace @ev/core -- tests/project-retirement.test.ts tests/agent-run.test.ts tests/today.test.ts` | 3 文件失败、4 测试失败、7 通过；退出 `1`。预期暴露 `/projects` 仍为 200、Codex profile/status 尚在。 |
| RED Web | `npm test --workspace @ev/web -- tests/project-retirement-navigation.test.tsx tests/core-proxy.test.ts tests/app-shell.test.tsx tests/provider-status.test.tsx tests/today-dashboard.test.tsx` | 已实际观察到导航、BFF、Provider status 三项失败；执行器在完成前返回，未取得最终退出码，未将其误报为通过。 |
| GREEN 首轮（保留记录） | Core 加 `v0.8-entity-memory`；Web 加 `v0.4-scheduling-workspaces` 的批次 | 两者均退出 `1`：Core 为 agent 测试期望 400/实际统一校验 422，以及历史测试期待 migration 26/实际 27；Web 为既有 daily-plan 生成断言 0/期待 1 和源码行数 577/期待少于 516。 |
| GREEN Core | `npm test --workspace @ev/core -- tests/project-retirement.test.ts tests/agent-run.test.ts tests/today.test.ts tests/memory-project.test.ts` | 4 文件、13 测试通过；退出 `0`。 |
| GREEN Web | `npm test --workspace @ev/web -- tests/project-retirement-navigation.test.tsx tests/core-proxy.test.ts tests/app-shell.test.tsx tests/provider-status.test.tsx tests/today-dashboard.test.tsx tests/v0.8-memory-scope.test.tsx tests/v0.9-private-boundary.test.ts` | 7 文件、64 测试通过；退出 `0`。 |
| 共享保留断言 | `npm test --workspace @ev/web -- tests/v0.4-scheduling-workspaces.test.tsx -t "uses strict Task and Event reads"` | 1 通过、48 按名称过滤跳过；退出 `0`。 |
| Core typecheck | `npm run typecheck --workspace @ev/core` | `tsc --noEmit` 通过；退出 `0`。Core 无 build script，按契约未造脚本。 |
| Web typecheck（首次） | `npm run typecheck --workspace @ev/web` | 退出 `1`：运行中预览遗留 `.next/types/validator.ts` 仍引用已删项目页面；未清理/覆盖 `.next`。 |
| Web 隔离 typecheck | PowerShell：`$env:EV_NEXT_DIST_DIR = '.next-project-removal-20260916'; node ..\..\node_modules\next\dist\bin\next typegen`（Web 目录）；随后 `npm run typecheck --workspace @ev/web` | typegen 与 `tsc --noEmit` 均通过，均退出 `0`。临时 `tsconfig` / `next-env.d.ts` 已恢复到本轮前 SHA-256：`A2278BDC56BDFEE8100383E17B85EF259ED63D2D8BBD03521142F694F5D19A81` / `B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`。 |
| Web 隔离 build | PowerShell：`$env:EV_NEXT_DIST_DIR = '.next-project-removal-20260916'; npm run build --workspace @ev/web` | Next 16.3.0 编译、内置 TypeScript、静态页生成全部通过；退出 `0`。 |

## 未验证、基线与受限清理

- 按要求未运行完整仓库测试或完整 E2E；未访问网络、真实 Provider、用户数据库，也未启动/停止预览。
- 两个首轮共享失败未修：同一工作树中 `apps/core/src/storage/migrations.ts` 的最后写入时间为 `2026-09-16T10:49:33.2424548+08:00`、`apps/web/src/components/daily-plan/daily-plan-workspace.tsx` 为 `2026-09-08T10:54:16.4116983+08:00`，均早于本轮快照建立时间，且本轮无补丁触及它们；这是相关未变代码证据，而非仅依赖 HEAD diff。
- `scripts/codex-container/__pycache__/fetch-codex.cpython-311.pyc` 仍是唯一 `codex` 命名残留。它是失去源文件后的 Python cache，不构成可调用入口；精确 `Remove-Item` 被执行策略拒绝，`apply_patch` 也因二进制非 UTF-8 无法删除。未绕过该策略。其余 Codex 容器源和三个诊断脚本已删除。
- `apps/core/src/modules/projects` 与 Web 项目目录仅剩空目录壳；没有文件、路由或 import，Git 不跟踪空目录。

局部修复计数：`2 / 2`。

1. 以实际 schema 边界为准，把 Codex/PROJECT agent-run 的定点期望从 400 改为受控的 `422 VALIDATION_ERROR`；持久化前拒绝行为不变。
2. 收到共享测试边界澄清后，从同一快照恢复上述三份文件并仅剥离项目分支；没有追加无意义 mock 或弱断言。BFF 全分支拒绝属于原 REMOVE-01 边界完成，而非额外重构。

## 主 Agent 核验与独立复核（最终状态：实现完成，验证收口 PARTIAL）

- Astra medium Darwin `01a0aa3d-dbd7-7030-acbd-4f13a6bb40e9` 独立复核：核心退役符合要求，未发现 P0/P1；30 个新增/修改文件与 delta 匹配，34 个删除目标不存在。主核对 delta SHA256 与上文一致，迁移 SHA256 `8B70CD9BDC0E803A7776A71A1C6AF9B43009EBC1070839EE1783561D44B33C82` 与删除前一致。
- 主读取隔离 build 的 `app-path-routes-manifest.json`，包含20个内部/页面路由记录，没有 `/projects`；普通任务、课程、健身、饮食、记忆入口仍在。`git diff --check` exit0，有既有 LF/CRLF 提示；权威正文相对文件链接检查缺失0。未另跑成功测试、真实浏览器或真实模型。
- **有效 P2 / 尚未修复：** `apps/web/e2e/v0.9-private-iphone.spec.ts` 恢复时漏掉了旧混合计数中的非项目断言：协调后采用前 `events=0`、采用后 `events=1`、`providerCalls=0`。现有页面/状态断言不能等价证明无提前或重复落库、无 Core Provider 调用。主对照原始快照确认缺口，不能声称该文件“只剥离项目分支”。需要以普通 WORK 输入补回这些断言；其他访问安全、记忆及协调断言保留。
- **文档更正：** 上文抛错发生在事务内而非事务前，已改正；此项不是业务实现缺陷。
- **保留权衡：** 已编号迁移/历史读取类型保留；原 `.next` 旧类型缓存不清理，只有隔离类型/构建通过；无源 `.pyc` 和主机 Docker/下载资源不作本轮清理。
- **未测试 / 不宣称通过：** 共享两组旧失败仍保留在上文；根据未变代码和时间可说明其基线关联，但没有重建完整修改前环境再运行，不能当作完整因果排除。未运行 E2E、生产或真实 Provider。两个局部修复已用完；不自动扩大范围修复 P2，不将本轮标为完整验收 PASS。
- **唯一下一步：** 请求一次仅补回 V9 E2E 三个共享计数断言的授权；不改业务代码、不跑全站矩阵，定点验证后由原独立角色聚焦复核。
