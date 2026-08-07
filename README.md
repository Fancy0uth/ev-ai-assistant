# EV AI Assistant

EV AI Assistant 是一个本地优先的个人 AI Dashboard。当前可运行的 Milestone 0.1 先把基础闭环做实：唯一 Owner 账号、真实任务、可解释的今日状态，以及明确标注能力边界的 Agent 面板。账号、任务和会话数据都留在运行 Core 的电脑上。

## 当前能做什么

- 首次启动时创建唯一的本地 Owner，并使用 HttpOnly 会话登录。
- 创建开发、学习和生活任务，设置优先级，完成、恢复或推迟任务。
- 根据真实任务计算今日分数、优先项和中文解释，来源明确标为“规则引擎”。
- 在桌面、平板和手机宽度使用同一个响应式 Dashboard。
- 显示 DeepSeek 与 Codex 的真实能力状态；Milestone 0.1 中均为“未配置”，不会伪造 AI 回复。

## 环境要求

- Windows 10/11（当前首要支持环境）
- Node.js 24.x
- npm

在仓库根目录安装依赖：

```powershell
npm install
```

## 本地启动

打开两个 PowerShell 终端，均进入仓库根目录。

终端 1：启动本地 Core。未设置 `EV_DATA_DIR` 时，Windows 默认数据目录是 `%LOCALAPPDATA%\EvAiAssistant`。

```powershell
$env:EV_DATA_DIR = "$PWD\data\dev"
npm run dev:core
```

终端 2：启动 Web。示例文件中的地址固定指向本机 Core。

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
npm run dev:web
```

打开 [http://127.0.0.1:3000/setup](http://127.0.0.1:3000/setup)，创建本地 Owner 后会进入 `/today`。之后从 `/login` 登录。

| 服务 | 地址 | 作用 |
| --- | --- | --- |
| Web | `http://127.0.0.1:3000` | Dashboard 与固定来源 BFF |
| Core | `http://127.0.0.1:4311` | 账号、任务、规则计算与 SQLite |

Core 只允许监听 `127.0.0.1`。当前版本尚未开放局域网或公网访问。

## 数据位置

Core 将数据库写入 `<EV_DATA_DIR>\app.sqlite`，并使用 WAL 模式。若采用上面的开发命令，文件位于仓库的 `data/dev`，该目录已被 Git 忽略。原始密码不会写入数据库；清除数据目录会移除本地账号和任务，请先备份。

## 质量检查

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
git diff --check
```

端到端测试会启动独立的 Core 与 Web，并且只重置被 Git 忽略的 `data/e2e`。它覆盖首次建号、创建高优先级开发任务、刷新后仍存在、完成后规则解释变化、退出后接口返回 401。

## 架构

```text
Browser / future iPhone client
            |
       Next.js Web + BFF
            |
       Local Fastify Core
            |
          SQLite
```

- `apps/web`：Next.js Dashboard；浏览器只能通过同源 BFF 访问固定 Core。
- `apps/core`：只监听 loopback 的 Fastify 服务，负责身份、任务和聚合。
- `packages/contracts`：跨端共享的 Zod API 契约。
- `packages/domain`：不依赖 UI/数据库的确定性领域规则。
- [产品 v2 规格](docs/superpowers/specs/2026-08-07-local-first-personal-ai-dashboard-v2-design.md)
- [Milestone 0.1 实施计划](docs/superpowers/plans/2026-08-07-local-foundation-owner-task-dashboard.md)
- [本地 Core 决策 ADR-005](docs/decisions/ADR-005-local-first-owner-hosted-core.md)
- [Agent 路由决策 ADR-006](docs/decisions/ADR-006-agent-routing-and-project-runner.md)

## 尚未启用

DeepSeek API、Codex 项目执行、长期记忆、日程/提醒、Tailscale 手机远程访问和 Docker 打包都不属于 Milestone 0.1。它们会在后续里程碑基于现有模块边界逐步加入；当前界面不会把这些能力伪装成已连接。
