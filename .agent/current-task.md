# TASK-V0.6-SOL-REREVIEW-2-P1-REPAIR：主 Agent 全矩阵 PASS，等待 Sol 终审

## 当前目标

Sol rereview-2 唯一 P1 `P1-ARTIFACT-001` 已在未提交工作树中按 TDD 定点修复：精确长度但仅含 VP8 10-byte 或 VP8L 5-byte frame header 的 WebP 现在在 artifact write、SQLite insert 和 Vision call 前以 `422 IMAGE_DIMENSIONS_INVALID` fail closed。主 Agent 已独立完成代码复核、Chromium 正例解码、根测试、全仓 typecheck/lint/build 与完整 E2E 8/8；当前只等待原子提交和新的 Sol 整版终审，不提前表示 v0.6 PASS。

## 本轮边界

- 只修复 `P1-ARTIFACT-001`；未实现 rereview 的六个 P2，未扩大 API/contracts/schema。
- migrations 与三份不可变 FAIL review 零差异。
- 主 Agent 已运行 full build 与完整 E2E；生产 build 产生的 `next-env.d.ts` 临时差异已恢复至仓库基线。
- 未运行真实 Vision/Search/DeepSeek/network：`NOT RUN — APPROVAL REQUIRED`。

## 根因与最小修复

- `webpDimensions()` 把结构合法的 VP8 10-byte frame header 或 VP8L 5-byte header 视为完整 image-bearing payload，仅从 header 得到 1×1，未读取压缩像素；因此 upload 可达到 artifact write 和 insert。
- `readImageMetadata()` 现为 async：先完成既有 RIFF/chunk/padding/feature/canvas、12,000 dimension 和 40M pixel 检查，再仅对 `image/webp` 调用 `sharp(..., { failOn: 'error', limitInputPixels: 40_000_000 }).stats()`。任何 decoder 失败转换为既有 `IMAGE_DIMENSIONS_INVALID`，不记录 decoder path/error 或原图。
- `@ev/core` 显式精确依赖本地已安装、lockfile 已存在的 `sharp@0.35.3`；没有联网、下载或安装新包。PNG/JPEG 合同、5 MB limit、动画拒绝和唯一生产 caller 之外的流程未改。

## RED / GREEN

```powershell
npm test --workspace @ev/core -- tests/course-import.test.ts -t "rejects exact-size VP8 and VP8L frame headers before persistence or any Vision call"
# RED: 1 failed / 13 skipped; expected [422, 422], received [201, 201]

npm test --workspace @ev/core -- tests/course-import.test.ts
# GREEN: 1 file / 14 tests PASS

npm test --workspace @ev/core
# PASS: 45 files / 303 tests

npm run typecheck --workspace @ev/core
npx eslint apps/core/src/modules/calendar/image-metadata.ts apps/core/src/modules/calendar/import-service.ts apps/core/tests/course-import.test.ts
# PASS

npm test
# PASS: root command exit 0
```

## 主 Agent 独立最终矩阵

本轮 focused course-import 14/14；根 `npm test` 为 legacy 5/5、Core 303/303、Web 242/242、Contracts 77/77、Domain 7/7；全仓 typecheck 与 build exit 0；lint 为 0 error、4 个未改动 v0.5 测试的既有 warning；完整 E2E 8/8、exit 0。两个固定 VP8/VP8L 正例由独立 Chromium `createImageBitmap()` 解码为 2×3。离线 manifest/lockfile/installed tree 均为 direct `sharp@0.35.3`。Git 未暂存、未提交；真实 Provider/network 未运行。
