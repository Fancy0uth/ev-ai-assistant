# TASK-V6-01：安全本地课表 artifact 与外发披露

## 目标

以产品比较基线 `155b172`、运行时代码基线 `d5d4ea5` 开始，用 bounded raw image 替换 Base64 JSON，交付 Owner 私有 artifact、MIME/magic/字节/像素/hash/清理、Provider 中立能力披露和 additive migration v19。

## 用户或系统价值

Owner 可先把课表截图安全保存在本地并看清 Provider、外发字段和目的；没有 Vision Provider 时系统诚实阻断，不会上传图片或伪造识别结果。

## 输入

- 产品比较 BASE `155b172de91a62feb2762469536555f9a6b2b025`；运行时代码 BASE `d5d4ea5`。Terra 从包含该提交且其后仅有 `.agent` 控制面提交的最新干净 HEAD 开始。
- 冻结计划 `docs/superpowers/plans/2026-08-23-v0.6-learning-schedule-loop.md` 的 Global Constraints、migration v19 和 V6-01。
- 当前 Base64 `course-import.ts`、calendar import service/routes、BFF/Core client、schedule/settings UI、v18 migration 与 Provider reliability 模式。

## 输出

- Raw `POST /v1/course-artifacts` 与 Owner-scoped metadata/delete lifecycle。
- `POST /v1/course-imports` 本地 preflight 与 `GET /v1/provider-capabilities`。
- `VisionCapability`、`PublicSearchCapability`、`LearningAdviceCapability` 中立 Port 和三重 Fake gate。
- 一次完整 additive migration v19，包含后续 v0.6 需要的 lineage 表但不实现 V6-02–V6-04 业务调用。
- Schedule/Provider UI 的 local-saved、disclosure-ready、blocked-provider 和 evidence-kind 状态。
- 聚焦 RED/GREEN 证据和原子 commit `feat(course-import): secure local timetable artifacts`。

## 前置条件

- 分支 `codex/product-prd`；HEAD 必须包含 `d5d4ea5`，且 `d5d4ea5..HEAD` 在首个产品实现提交前只能有 `.agent` 控制面提交。
- 工作树在本次状态提交后必须干净，没有用户产品改动。
- 不安装依赖；Fastify 5 raw content parser 和 Node built-ins 足以实现。

## 非目标

- 不调用或选择真实 Vision/Search/DeepSeek Provider。
- 不实现 Vision extraction、candidate revision editor、Course/Rule/Event、公开抓取或学习建议；这些属于 V6-02–V6-04。
- 不引入 multipart/native image 包，不登录学校系统，不部署、不 push。

## 允许修改的文件或模块

严格使用 V6-01 `Files` 清单：course-import/providers Contracts 与测试；Core error/app/server/migration/calendar import/artifact/image/capability modules 与聚焦测试；Web Core client/BFF/schedule/provider settings 与聚焦测试。

## 不应修改的区域

- Daily Plan 业务逻辑与 v0.5 recovery/idempotency 语义。
- v0.7–v0.9 领域实现。
- 历史审查、批准规格、依赖清单中的包集合、真实凭据和用户数据。

## 接口约束

- `POST /v1/course-artifacts` 只接受 raw PNG/JPEG/WebP，BFF/Core 上限均为 5,000,000 bytes。
- 最大宽/高 12,000，最大像素 40,000,000；MIME 必须匹配 magic；SQLite 不存 blob/Base64/绝对路径。
- Artifact `ACTIVE→DELETE_PENDING→DELETED` 两阶段清理，文件操作不进 SQLite 写事务；跨 Owner 为 404。
- `POST /v1/course-imports` 只创建本地 disclosure/run，不调用 Provider；无 Vision 时返回持久 `BLOCKED_PROVIDER`。
- Fake 同时要求 `NODE_ENV=test`、`EV_E2E_V06_LEARNING_TEST_ADAPTERS=1` 和解析后位于 `EV_E2E_RUN_DIR` 的数据根。
- Migration v19 只创建新表/索引/immutable triggers；不 drop/rename/rebuild/update 旧数据；历史 `app_version` 不变。

## 验收标准

1. Base64 JSON 上传契约与 UI 路径被 raw body 取代，BFF 无无界 `arrayBuffer()`。
2. MIME/magic/byte/dimension/pixel/hash 与 Owner 隔离测试通过；失败不留活跃 metadata/partial file。
3. 上传、hash replay、删除/retry/recovery 都只作用于已验证 artifact root。
4. 外发前 UI 显示 Provider/未配置、目的、选定数据和 evidence kind；本任务没有外部调用。
5. 生产未配置为 `BLOCKED_PROVIDER`；Fake 任一 gate 缺失时 app composition 拒绝。
6. v1/v2/v16/v17/v18 升级保留旧 ID/计数和历史 app version，v19 表无正文/密钥/blob 字段。
7. 只修改计划列出的文件并形成一个可独立回退 commit。

## 测试计划

### RED / GREEN 聚焦命令

```powershell
npm test --workspace @ev/contracts -- tests/courses.test.ts tests/providers.test.ts
npm test --workspace @ev/core -- tests/course-import.test.ts tests/migrations.test.ts tests/v0.5-reliability-storage.test.ts tests/v0.6-capability-gate.test.ts
npm test --workspace @ev/web -- tests/core-client.test.ts tests/core-bff-idempotency.test.ts tests/schedule-workspace.test.tsx tests/provider-settings.test.tsx
```

### check_fast

```powershell
npm run typecheck --workspace @ev/contracts
npm run typecheck --workspace @ev/core
npm run typecheck --workspace @ev/web
npx eslint packages/contracts/src/course-import.ts packages/contracts/src/providers.ts packages/contracts/tests/courses.test.ts packages/contracts/tests/providers.test.ts apps/core/src/http/api-error.ts apps/core/src/app.ts apps/core/src/server.ts apps/core/src/storage/migrations.ts apps/core/src/modules/calendar/import-service.ts apps/core/src/modules/calendar/import-routes.ts apps/core/src/modules/calendar/image-metadata.ts apps/core/src/modules/calendar/artifact-store.ts apps/core/src/modules/calendar/import-repository.ts apps/core/src/modules/providers/capabilities.ts apps/core/src/modules/providers/capability-run-repository.ts apps/core/src/modules/providers/service.ts apps/core/src/modules/providers/routes.ts apps/core/tests/course-import.test.ts apps/core/tests/migrations.test.ts apps/core/tests/v0.5-reliability-storage.test.ts apps/core/tests/v0.6-capability-gate.test.ts apps/web/src/lib/core-client.ts 'apps/web/src/app/api/core/[...path]/route.ts' apps/web/src/components/schedule/schedule-workspace.tsx 'apps/web/src/app/(dashboard)/settings/providers/page.tsx' apps/web/tests/core-client.test.ts apps/web/tests/core-bff-idempotency.test.ts apps/web/tests/schedule-workspace.test.tsx apps/web/tests/provider-settings.test.tsx
git diff --check
```

### 是否允许真实外部服务

不允许；所有测试使用本地 bytes、注入的 fake/stub transport 和 runner-owned 临时目录，不开真实网络。

### 是否需要数据库

只允许测试临时 SQLite；不得读取用户 `EV_DATA_DIR`。

### 是否需要浏览器或端到端环境

本任务只做 Web component/BFF tests，不运行 Playwright；完整浏览器闭环属于 V6-04。

## 风险

- Fastify body-limit 错误若未映射会误报 500。
- JPEG/WebP header parser 边界不足会放过像素炸弹或拒绝合法最小 fixture。
- 文件/SQLite 两阶段若恢复逻辑不严会误删越界路径。
- Fake injection 若只检查环境变量而不检查 resolved data root，会扩大生产假能力风险。
- v19 一次创建后续表较大，必须用旧库升级计数和 schema 列检查约束范围。

## 回滚方式

回退 V6-01 commit；已应用 v19 表保留并由旧代码忽略，不做 down migration。保留 artifact 文件/metadata，禁止递归删除 artifact root。

## 升级给 Sol 的条件

- 需要新增 multipart/native 依赖或修改依赖集合。
- raw body 无法在 BFF/Fastify 解析前双层限流。
- Windows path containment 或两阶段清理无法证明。
- v19 需要重建/改写旧表或历史版本。
- 同一根因两轮 Terra 修复后仍失败，或必须写 V6-01 清单之外的产品文件。
