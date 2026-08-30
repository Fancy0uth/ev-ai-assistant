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
