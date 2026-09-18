# 项目退役 R4 限定修复（2026-09-18）

结果：同一 V9 隔离合成用例第二次运行通过，1 passed / 0 failed，runner exit 0。R4 一次实现加 1 次局部修复（上限 2）；此前 2/2 与额外 R3 保持，不重置。未修改业务、TASKS、runner 或直接相关 helper 以外文件；实际源码改动仅 `apps/web/e2e/v0.9-private-iphone.spec.ts`，另生成本报告及机械 diff。

## 根因与修复

R3 trace 已定位原第 221 行选择器同时匹配“在控制台查看任务详情…”与“查看任务详情…”，因此添加 `exact:true`。保留原认证、CSP/CSRF、普通 WORK 输入、LOCAL_RULES 审核、事件计数与 providerCalls 计数断言。

新增导航 helper 在触发页面进入前订阅精确同源 credential metadata GET，最多等待响应 8 秒，检查 200、响应正常完成及“DeepSeek：未配置”UI。认证进入、初次 Today、daily-plan、返回 Today、reload 均使用它。

finally 使用 soft 安全断言，记录所有失败但不覆盖 try 中首个异常；诊断附件失败也单独以 soft 断言报告。没有吞掉错误或删除网络安全检查。

第一次 R4 运行已经通过全部业务及数据库计数，但每次挂载仍产生一次 metadata 主动取消。`ProviderStatus` effect 清理会 abort，开发模式 StrictMode 会重启 effect；导航等待不能消除这类挂载取消。因此局部修复 1 在测试 init script 中观察真实 fetch 的 AbortSignal，只有同源 GET `/api/core/providers/deepseek/credential`、signal.aborted 与 DOMException AbortError 同时成立才上报证据，原请求及原错误继续返回/抛出。只对完全匹配的 Playwright ERR_ABORTED metadata 记录与该证据一一配对，独立记录 cancelledMetadataRequests；至多 5 次（5 次挂载），未匹配信号证据也失败。其他或缺乏证据的请求失败仍保留在 failedRequests，必须为零。没有泛化忽略 ERR_ABORTED。

日志降级最小原因：R3 只创建临时根目录，却将 EV_LOG_DIR 指向尚不存在的 core 子目录。runtime logger 创建 runtime 时要求直接父目录已存在，private-directory.assertSafeParent 因而拒绝。R4 运行配置先创建 core 父目录，业务代码不变；两次 R4 日志没有 EV_RUNTIME_LOGGER_DEGRADED，最终产生 core/runtime/current.jsonl。

## 命令与实际结果

两次均只执行 `node scripts/run-e2e.mjs v0.9-private-iphone.spec.ts`，每次 1 test / 1 worker / retries 0。运行前在 PowerShell 子进程中创建新的临时日志根及 core 子目录，将 EV_LOG_DIR 指向它，并设置 NEXT_TELEMETRY_DISABLED=1；stdout/stderr 由 Tee-Object 保存为 runner.log。

1. 首次：1 failed，exit 1。普通 WORK 创建、协调、确认、刷新及五次事实计数均通过；failedRequests soft 断言因 5 条 metadata ERR_ABORTED 失败。合成目录 `data/e2e-runs/managed-run-Tp36D8` 保留。控制台及 Core 日志根：`C:\Users\asus\AppData\Local\Temp\ev-project-removal-r4-7cae3a7a7b1b44cb970b90ae4e49c07f`。失败 Playwright trace/video/screenshot 在重跑前复制到该目录的 `playwright-failure`，保留失败证据。
2. 局部修复 1 后：1 passed（7.1s），exit 0。实际闭环为普通 WORK → LOCAL_RULES 协调待确认 → APPLY → Today 刷新；确认前 events=0、确认后 events=1，五个数据库检查点 providerCalls=0。认证、安全诊断及 CSP/CSRF 全部通过。不是 Fake，不调用外部 Provider。

最终日志路径：

- 控制台：`C:\Users\asus\AppData\Local\Temp\ev-project-removal-r4-c800ec9929544f7d8b5c04c238615a00\runner.log`。
- Core：`C:\Users\asus\AppData\Local\Temp\ev-project-removal-r4-c800ec9929544f7d8b5c04c238615a00\core\runtime\current.jsonl`。

runner 使用新建 managed-run 合成 EV_DATA_DIR、专属 4327/3217 端口与该目录内 Next 输出；成功后按 runner 既有逻辑删除本次成功合成目录，关闭自己创建的服务。未接触用户数据库或已有 preview，未安装、发起外部网络/付费 API、stage/commit，未派 agent。未运行全套、额外 build/typecheck 或健身用例；健身契约由主并行准备，交回主接续。

## R3 → R4 精确 diff 与 hash

原始 R3 快照：`C:\Users\asus\AppData\Local\Temp\ev-project-removal-r4-before-6a2447ef60bb496e8fff9fc903a00caf\v0.9-private-iphone.spec.ts`。

`plans/evidence/2026-09-18-project-removal-r4.diff` 由 `git -c core.autocrlf=false diff --no-index --binary` 对该快照与最终 test 机械生成，不使用 HEAD 混合脏基线。

- R3 test SHA-256：`1D214367AFC519783F494EC825145F0E7602E09FB8F99261165C2BFD415A7426`。
- 最终 R4 test SHA-256：`CFF7C61E176469A9A523ECBAE7CA260128BE1AF1EE95F4992FA5C316EA2B4D51`。
- R3→R4 diff SHA-256：`C8FE5B684BA73E0FCAF616E3C675A056A58082C424FD939BAEE9BFD5C8E6F230`。
- HEAD：`50b533804be24f8963492679127f72e39ff4f7dd`。

runner 结束后 `next-env.d.ts` hash 仍为 `B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`；`tsconfig.json` 仍为 `A2278BDC56BDFEE8100383E17B85EF259ED63D2D8BBD03521142F694F5D19A81`，与 R3 前后相同。

## 独立复核（主记录）

Astra medium Darwin 只读核对精确diff、最终hash及日志：原断言遗漏、locator歧义、导航取消与首错保留均 ADDRESSED；规格限定通过，质量无阶段保存阻断。metadata取消是按端点/数量与AbortSignal证据配对，不是逐请求ID关联；在本case最多5次及正常响应等待约束下接受此权衡，不当成通用网络豁免。主另读取最终runner尾部确认1 passed；未重跑、未扩全仓。日志降级已由测试父目录配置纠正，未改生产logger。
