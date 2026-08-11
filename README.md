# EV AI Assistant

EV AI Assistant v0.2 是仅供本机使用、单一 Owner 的技术预览。它用于验证个人任务 Dashboard 的本地闭环：账号、任务和会话数据只保存在运行 Core 的这台电脑上，不面向团队、局域网或公网部署。

## 当前预览内容

首次启动后，用户在本机创建唯一 Owner 账号并通过 HttpOnly 会话登录；**没有预设账号、默认密码或演示账号**。创建账号后，Dashboard 提供三条真实路由：

- `/today`：展示根据真实任务计算的今日分数、优先项和中文规则解释。
- `/tasks`：创建开发、学习和生活任务，设置优先级，并完成、恢复或推迟任务。
- `/agent`：显示 Agent 能力边界与配置状态，不会伪造 AI 回复。

这是技术预览而非已发布产品。当前没有可用的真实 AI Provider、长期记忆或外部集成；不会连接 DeepSeek、Codex、日历、提醒或其它第三方服务。

## 环境要求

- Windows 10/11（当前首要支持环境）
- Node.js 24.x
- npm

在仓库根目录安装依赖：

```powershell
npm install
```

## 使用独立数据目录启动预览

打开两个 PowerShell 终端，均进入仓库根目录。为本次预览指定一个新的、独立的 `EV_DATA_DIR`，避免复用已有的本地数据。

终端 1：启动本地 Core。

```powershell
$env:EV_DATA_DIR = "$env:TEMP\ev-ai-preview-v0.2"
npm run dev:core
```

Core 会在 `<EV_DATA_DIR>\app.sqlite` 写入 SQLite 数据库并使用 WAL 模式。需要重新开始预览时，请停止服务后改用另一个空目录；删除数据目录会移除其中的本地 Owner、任务和会话数据。

终端 2：启动 Web。示例文件中的地址固定指向本机 Core。

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
npm run dev:web
```

打开 [http://127.0.0.1:3000/setup](http://127.0.0.1:3000/setup)，自行创建唯一的本地 Owner，然后进入 `/today`；之后可从 `/login` 登录。

| 服务 | 地址 | 作用 |
| --- | --- | --- |
| Web | `http://127.0.0.1:3000` | Dashboard 与固定来源 BFF |
| Core | `http://127.0.0.1:4311` | 本地 Owner、任务、规则计算与 SQLite |

Core 只允许监听 `127.0.0.1`。当前技术预览不支持局域网或公网访问。

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
