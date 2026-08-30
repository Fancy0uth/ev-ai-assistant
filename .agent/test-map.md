# 测试层级映射

## check_fast

命令：

```powershell
npm test --workspace <受影响 workspace> -- <精确测试文件>
npm run typecheck --workspace <受影响 workspace>
npx eslint <明确列出的改动文件>
git diff --check
```

覆盖范围：当前任务的成功路径、关键边界、主要失败路径和受影响 workspace 类型安全。

预计耗时：通常 10–90 秒。

## check_task

命令：

```powershell
npm test --workspace @ev/contracts -- tests/courses.test.ts
npm test --workspace @ev/core -- tests/course-import.test.ts tests/learning.test.ts tests/provider-credential-service.test.ts tests/migrations.test.ts
npm test --workspace @ev/web -- tests/learning-workspace.test.tsx tests/schedule-workspace.test.tsx
npm run typecheck
npm run build --workspace @ev/web
npm run test:e2e -- e2e/v0.6-learning-loop.spec.ts
```

覆盖范围：v0.6 契约、迁移、课程导入、公开资料、Web 交互和一条关键浏览器闭环。计划冻结后可按真实文件名收窄或修正。

预计耗时：约 2–6 分钟。

## V6-04 已执行证据

```powershell
npm test --workspace @ev/contracts -- tests/courses.test.ts tests/calendar-proposals.test.ts tests/providers.test.ts
npm test --workspace @ev/core -- tests/course-import.test.ts tests/calendar-repository.test.ts tests/learning.test.ts tests/public-resource-fetcher.test.ts tests/proposal-api.test.ts tests/today.test.ts tests/migrations.test.ts tests/v0.5-reliability-storage.test.ts tests/v0.6-capability-gate.test.ts
npm test --workspace @ev/web -- tests/core-client.test.ts tests/core-bff-idempotency.test.ts tests/schedule-workspace.test.tsx tests/learning-workspace.test.tsx tests/course-detail-workspace.test.tsx tests/provider-settings.test.tsx tests/today-dashboard.test.tsx
npm run typecheck
npx eslint [V6-04 focused files and apps/web/e2e/v0.6-learning-loop.spec.ts]
npm run build --workspace @ev/web
npm run test:e2e -- e2e/v0.6-learning-loop.spec.ts
git diff --check
git diff --exit-code -- apps/core/src/storage/migrations.ts
```

已验证：immutable citation hash/refetch、Owner credential metadata→READY disclosure→一次 DeepSeek text adapter、缺失 credential→BLOCKED/零 call、SecretStore/adapter/CredentialNotConfigured 的稳定 503、解密/模型事务外和 key 不入可见 persistence/response、strict Learning Proposal、ACCEPT 原子 Action/TimeRequest、Today course/action lineage、三重 Fake 门、0.6.0 版本一致性，以及同一 Owner 两轮 desktop/iPhone 实际 Core response UUID lineage 的精确集合。最后 capability P1 另证明 production preflight evidence=NONE、仅成功 terminal 按实际 adapterKind 写 REAL_PROVIDER/AUTOMATED_FAKE、Learning 的 credential/unprotect/factory=0 calls 与 generate failure=1、Vision runner-owned artifact read failure=0 与 strict output failure=1。结果：原矩阵 Contracts 25/25、Core 43/43、Web 47/47、E2E 1/1；P1 focused Core 16/16、Contracts 25/25，其余命令 PASS。真实 Provider smoke 不属于自动层，保持 `NOT RUN — APPROVAL REQUIRED`。

## check_full

命令：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
git diff --check
```

覆盖范围：全仓确定性测试、类型、lint、构建和浏览器回归。

预计耗时：约 5–15 分钟；每个里程碑原则上最多运行一次。

## eval_llm_smoke

命令：由获批 Provider 和非敏感测试数据决定，不嵌入普通测试脚本。

允许触发条件：Prompt、模型、Tool/RAG 或上下文逻辑发生变化，并且用户已批准真实凭据、外发内容和可能费用。

## eval_llm_full

命令：发布前单独制定。

允许触发条件：仅 v0.9 发布候选、真实 Provider 已授权、测试数据和费用边界已批准时运行。
