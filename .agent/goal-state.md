# 长任务状态

## 最终目标

从 v0.5 工程 PASS 基线连续交付到 v0.9 本地个人 AI Dashboard MVP：课程与学习、健身与饮食、只读项目与长期记忆、跨模块日程协调、私有 iPhone Web 访问及本地运维均有可验收闭环。

## 当前里程碑

M1 / v0.6：课程、课表截图与学习排程闭环。

## 当前任务

v0.6 Sol rereview-2 的唯一 P1 `P1-ARTIFACT-001` 已完成 Terra 定点修复：WebP upload 仅在完整本地 VP8/VP8L 像素解码成功后可进入 artifact persistence。主 Agent 已独立完成代码复核、Chromium 正例解码、全套单元/集成测试、typecheck、lint、build 与完整 E2E 8/8；当前等待原子提交和新的 Sol 整版复审。不得在复审归零前声称 v0.6 PASS。

## 已完成任务

- v0.4 Action Scheduling Foundation：工程 PASS。
- v0.5 Provider Reliability：工程 PASS；关版提交 `155b172`。
- TASK-V6-00：v0.6 整版计划与冻结契约完成。
- V6-01 `8ee52e1`、V6-02 `4b4e218`、V6-03 `b99fdce` 已提交；V6-04 产品闭环、0.6.0 版本更新与确定性验证已实现。
- v0.6 Sol 最终审查发现的 Vision 幂等、capability policy/evidence、WebP artifact 与 diff gate P1/P3 已按两轮 TDD 修复；配额按 claim 的 Asia/Shanghai 执行日原子 reservation。
- stale capability lease 已按保守 quota 与三类业务状态原子恢复；本轮另修复 Daily Plan preflight 的测试时钟 composition，并同步 v19/APP_VERSION 测试期望。

## 下一任务

原子提交当前 P1 修复并发起 Sol 里程碑复审。只有复审确认 P0/P1 为零并 PASS，才可进入 v0.7。

## 当前阻塞

- 本轮确定性门无已知阻塞；只剩新的 Sol 整版复审尚未给出 P0/P1 归零结论。
- 真实 Vision、Search、DeepSeek 与真实凭据/DPAPI/网络未获授权，继续记录为 `NOT RUN — APPROVAL REQUIRED`，不由 Fake 替代。

## 最近测试结果

- Sol rereview-2 `P1-ARTIFACT-001` RED：exact-size header-only VP8/VP8L upload 分别错误返回 201；GREEN 后相同两个请求均为 `422 IMAGE_DIMENSIONS_INVALID`，且测试断言 artifact rows/files=0、Vision calls=0。固定离线 VP8 与 VP8L 正例先由同一 sharp `stats()` 完整解码，再各返回 201 和正确的 2×3 尺寸。
- 本轮 `tests/course-import.test.ts` 14/14、Core 45 files/303、Core typecheck、focused ESLint 与 root `npm test` 均 exit 0。`git diff --check`、migrations 和三份 immutable FAIL review zero-diff；offline manifest/lock/installed tree 均为 exact direct `sharp@0.35.3`。
- Terra 交接时未运行 full build/E2E；主 Agent 已在同一未提交差异上补齐。真实 Provider/network 未运行，保持 `NOT RUN — APPROVAL REQUIRED`。
- 主 Agent 独立复跑：两个固定 VP8/VP8L 正例由 Chromium `createImageBitmap()` 解码为 2×3；focused course-import 14/14；根测试 legacy 5/5、Core 303/303、Web 242/242、Contracts 77/77、Domain 7/7；全仓 typecheck/build exit 0；lint 0 error、4 个既有 warning；完整 E2E 8/8、exit 0。生产 build 的 `next-env.d.ts` 临时差异已恢复。
- 主 Agent 独立复核：`tests/course-import.test.ts` 1 file / 7 tests PASS，包含 Vision 第 21 次路由拒绝与 WebP padding guard。
- Terra 最终修复轮：capability gate 8/8、course import 7/7、learning 11/11 PASS。
- `npm run typecheck --workspace @ev/core`、focused ESLint、`git diff --check` PASS。
- `git diff --exit-code 8ee52e1..HEAD -- apps/core/src/storage/migrations.ts` 与工作树 migration zero-diff PASS；migrations 001..020 未改。
- 跨日 quota RED 证明 8 月 31 日创建的 run 在 9 月 1 日 claim 被错误按创建日阻断；GREEN 后 claim 使用 `providerUsageLocalDate(new Date(now))` 查询并写回 `local_date=2026-09-01`，9 月 1 日第 21 次拒绝，其他 Owner/能力不受影响。
- 本轮 recovery RED：`tests/v0.5-recovery-sweeper.test.ts` 2 failed / 3 passed；GREEN：5/5。
- 本轮五文件 focused：5 files / 24 tests PASS；Core full：45 files / 297 tests PASS；Core typecheck 与 focused ESLint PASS。
- Web RED：三文件 focused 2 failed / 61 passed；首轮简单 `indexOf` 取样仍为 1 failed / 62 passed，证明普通样式污染取样窗口。
- Web GREEN：三文件 focused 63/63、Web full 239/239、Web typecheck 与 focused ESLint PASS。
- Tasks focus flaky：Main Agent root RED 时更新后的编辑按钮已存在但 focus 仍在 body；最终 `toHaveFocus` 改为条件等待后，精确 `-t` 连续三次均 1/1、Tasks 全文件 43/43 PASS，未提高 timeout、未改组件。
- 同根 heading fallback：empty page 与“任务工作台” heading 已存在但 focus effect 尚未提交；仅该 post-save 断言改为默认 `waitFor`，两个 post-save focus 测试一起连续三次均 2/2，取消编辑同步焦点断言未改。
- 根 `npm test`：legacy 5/5、Core 297/297、Web 239/239、Contracts 77/77、Domain 7/7 PASS；整仓命令 exit 0。
- E2E focused：owner、v0.4、v0.6 各 1/1 PASS；全套使用共享 runner dir 时 6/8、exit 1。v0.4 读取到前序三条 Fake evidence，v0.6 捕获 422 console error；原 keyboard 与 401 失败未复现。
- trace 定点修复后 focused v0.4 与 v0.6 各 1/1 PASS；完整矩阵中 v0.4 已 PASS，证明 baseline 完整追加与 excluded Task CANCELLED cleanup 生效。全套现为 7/8、exit 1；新首个失败是 v0.6 desktop `applyDailyPlan` decision POST 返回 422，附件无 console warning/error。
- 最新 trace 根因修复仅把 v0.6 desktop/iPhone 固定学习窗口改为 16:00–17:00、18:00–19:00；focused v0.6 1/1 PASS、exit 0。完整 E2E 中 v0.4 仍 PASS，但总计 7/8、exit 1；新首个失败为 Fake 摘要严格文本 locator 命中两个元素，两个浏览器附件均无 console warning/error。
- pending proposal card 改为由唯一 exact `采用安排` 按钮过滤，严格断言 card count=1，并在 card 内断言 exact Fake summary/apply button；未使用 `.first()`/`.last()`/`.nth()`。修复后 focused v0.6 1/1、完整 E2E 8/8 均 PASS、真实 exit 0；Web typecheck、v0.4/v0.6 focused ESLint、diff-check PASS，migration 与 immutable review zero-diff。
- 主 Agent 最终独立复跑：根 `npm test` 全部通过；`npm run typecheck` 与 `npm run build` exit 0；完整 `npm run test:e2e` 8/8、exit 0。全仓 lint 为 0 error、4 个未改动 v0.5 测试的既有 warning；迁移、不可变 FAIL review、版本、凭据字面量、报告行尾和 Next 生成文件检查全部通过。

## 尚未验证风险

- 仍需 Sol 对 BASE `155b172` 至修复提交执行整版复审；P0/P1 未由最终复审归零前不得进入 v0.7。
- v0.5 `P2-EVIDENCE-001` 以及三类真实 Provider 成功证据仍是明确证据债。

## 最后更新时间

2026-08-31 Asia/Shanghai
