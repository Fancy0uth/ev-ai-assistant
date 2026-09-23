# ADR-011: Windows E2E 由受管 Runner 独立启动和回收服务

## Status

Accepted

## Date

2026-08-17

## Context

在 Windows 上，Playwright `webServer` 通过嵌套 npm 启动 Core/Web 时，测试结果可以已经输出，但其子进程仍保留并占用端口。按端口停止进程会误伤用户正在手工运行的预览服务，也使测试数据和实际数据混用。

## Decision

根目录 `npm run test:e2e` 使用 `scripts/run-e2e.mjs`：

1. 为本次运行创建唯一、Git 忽略的 `data/e2e-runs/run-*` 目录并作为 `EV_DATA_DIR`，并将其子目录作为 `EV_NEXT_DIST_DIR`；
2. 直接启动自己拥有的 Core（4327）和 Web（3217）子进程；
3. 等待健康端点后以 `EV_E2E_MANAGED=1` 运行 Playwright；
4. 在 `finally` 中仅终止已记录 PID 的进程树；Windows 使用 `taskkill /pid <owned-pid> /T /F`，其他系统发送 `SIGTERM`；
5. 结束时还原 Next 自动修改的 `next-env.d.ts`；成功运行删除其唯一临时目录，失败保留现场供排查；
6. Playwright 配置保留普通 `webServer` 路径，供独立运行单个 spec 时使用。

## Alternatives Considered

### 继续依赖 Playwright `webServer`

配置更短，但当前 Windows 进程树清理并不可靠，且已实际造成命令不退出。

### 按端口停止所有进程

可以解决残留，但会关闭用户的本地预览，违反测试隔离原则。

### 不自动运行浏览器测试

失去桌面和移动端真实路由、表单和无控制台错误的验证。

## Consequences

- E2E 每次运行都有独立数据和 Next 构建目录，永不迁移/删除用户数据，也不会与手工 `next dev` 抢同一 `.next` 锁。
- runner 略多于默认配置，但它的进程、类型文件和临时数据归属均可审计；成功测试不会累积缓存。
- 端口仍是固定的测试端口；若被非测试进程占用，测试应失败并提示，而不是擅自终止未知进程。
