# 项目退役额外 R3 限定修复证据（2026-09-18）

状态：断言补回已完成；唯一 E2E 执行失败，按授权停止修复与重跑，交原 Astra 聚焦复核。此前两轮仍记 2/2，本次为额外 R3 一次，不重置计数。历史 FAIL 与 2026-09-16 证据保持原样。

## 范围与最终 hash

仅手工修改 `apps/web/e2e/v0.9-private-iphone.spec.ts` 和新增本报告；未修改 TASKS、业务代码、runner 或 Playwright 配置。HEAD：`50b533804be24f8963492679127f72e39ff4f7dd`。

- test 修改前 SHA-256：`482A5C5ABA0899F3FCF2242A126A76913AC63E8151404D03FDFBBB257FEA48BD`。
- test 最终 SHA-256：`1D214367AFC519783F494EC825145F0E7602E09FB8F99261165C2BFD415A7426`。
- runner.log SHA-256：`468F02F26C7495D11C6C3BA521C7E49CCA6598FB34FAA6BF56A474A981AF7794`。

补回只读 SQLite `events` / `provider_call_logs` 断言，以合成 Owner 为范围，统计所有日期的记录，避免日期过滤漏报 Provider 调用。读取要求 `EV_E2E_MANAGED=1`，真实路径必须为当前工作树 `data/e2e-runs/managed-run-*` 的直接子目录；数据库真实路径也必须位于该运行目录，使用 `fileMustExist:true, readonly:true`。

五个检查点：登录后的初始状态、普通 WORK 创建后、LOCAL_RULES 协调后确认前均期望 `{events:0,providerCalls:0}`；确认与 Today 刷新后均期望 `{events:1,providerCalls:0}`。现有 WORK 输入、CSP/CSRF、loopback 与浏览器诊断断言保留，没有引回项目 API。

## 唯一执行与隔离

已检查 `scripts/run-e2e.mjs` 和 `apps/web/playwright.config.ts`：指定 V9 选择器启用生产 Core server 入口，不加载 Fake/fixture adapter；runner 创建全新的合成 `EV_DATA_DIR`，先检查专属 4327/3217 端口空闲，Next 产物也位于该运行目录。runner 在 finally 关闭自己创建的进程并恢复 `next-env.d.ts`；失败时保留合成目录。

执行的唯一测试命令：`node scripts/run-e2e.mjs v0.9-private-iphone.spec.ts`。

调用前在本次 PowerShell 子进程中设置 `EV_LOG_DIR=C:\Users\asus\AppData\Local\Temp\ev-project-removal-r3-fa1b444ab62b4d51abbddd7639ab9da8\core`，覆盖继承值；设置 `NEXT_TELEMETRY_DISABLED=1`；通过 Tee-Object 保存 stdout/stderr。没有使用用户数据目录，未操作现有 preview，未安装依赖、发起外部网络/付费 API、提交或暂存。

- 实际用例数：1，worker：1，重试：0。
- 结果：0 passed / 1 failed；runner 最终退出码：1。
- 模式：预期且保留 `LOCAL_RULES`，非 Fake。执行止于 WORK 创建后的原有 UI 断言，尚未进入协调请求；不能将本次失败运行表述为已完成 LOCAL_RULES 闭环或全程 providerCalls=0 已验证。
- 合成目录（失败保留）：`C:\Users\asus\Documents\ev-ai assistant\.worktrees\product-prd\data\e2e-runs\managed-run-fBbQuw`。
- 控制台日志：`C:\Users\asus\AppData\Local\Temp\ev-project-removal-r3-fa1b444ab62b4d51abbddd7639ab9da8\runner.log`。
- 配置的 Core 日志目录为上面的 `core` 子目录；启动输出 `EV_RUNTIME_LOGGER_DEGRADED`，未声称该目录中有可用 Core 日志文件。
- Playwright 证据目录：`C:\Users\asus\Documents\ev-ai assistant\.worktrees\product-prd\apps\web\test-results\v0.9-private-iphone-V9-05--ea43e-es-facts-after-confirmation`，含 `trace.zip`、`error-context.md`、`test-failed-1.png`、`video.webm`。

## 实际失败与验证限制

只读检查本次 trace（未重跑）显示最先失败在 test 第 221 行原有任务详情链接断言：`getByRole('link', {name:'查看任务详情：Confirm the V9-05 ordinary work action'})` 同时匹配“在控制台查看任务详情…”和“查看任务详情…”两条链接，触发 strict-mode violation。

随后 finally 第 276 行保留的 `diagnostics.failedRequests` 空数组断言失败，记录两次 `net::ERR_ABORTED GET http://127.0.0.1:3217/api/core/providers/deepseek/credential`，并覆盖最终主报错。没有弱化此安全断言，没有顺手修正选择器；交主决定后续。

初始数据库断言已执行通过；WORK 后新增数据库断言位于失败链接断言之后，协调前/确认后/刷新后的数据库断言亦未执行。未进行额外 typecheck、build、完整 E2E 或重跑。

执行后核对两份 runner 可能触及的文件 hash 与执行前相同：

- `apps/web/next-env.d.ts`：`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`。
- `apps/web/tsconfig.json`：`A2278BDC56BDFEE8100383E17B85EF259ED63D2D8BBD03521142F694F5D19A81`。

R3 当前交付为可复核的限定测试补丁及失败证据，不是通过验收。

## 独立复核（主记录）

Astra medium Darwin `01a0aa3d-dbd7-7030-acbd-4f13a6bb40e9` 只读核对完整报告和 trace：原遗漏在代码中已补回，但仅第201行初始计数实际通过；第221行严格选择器失败后，其余计数未执行；finally 第276行请求中止掩盖首错。结论为 1 case FAIL，限定验收未通过。复核未改代码、未重跑，允许留存补丁与失败证据，不允许标验收完成。最小后续是获准定点处理该失败链，再验证同一 case。
