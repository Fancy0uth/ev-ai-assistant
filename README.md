# EV AI Assistant

EV AI Dashboard 是仅供本机使用、单一 Owner 的技术预览。当前 `v0.2` 基础上完成了 `v0.3` Daily AI Control Loop：账号、日程、任务、恢复、记忆和项目快照都只保存在运行 Core 的这台电脑上，不面向团队、局域网或公网部署。

## 当前预览内容

首次启动后，用户在本机创建唯一 Owner 账号并通过 HttpOnly 会话登录；**没有预设账号、默认密码或演示账号**。创建账号后，Dashboard 提供以下真实路由：

- `/today`：展示根据真实任务计算的今日分数、优先项和中文规则解释。
- `/daily-plan`：手动生成或审核每日计划；可查看本次最小 Context 类别、日程版本和本地冲突校验，再逐项采用或拒绝。
- `/tasks`：创建开发、学习和生活任务，设置优先级，并完成、恢复或推迟任务。
- `/agent`：显示 Agent 能力边界与配置状态，不会伪造 AI 回复。
- `/settings/providers`：Owner 可保存、删除并测试 DeepSeek 凭据；浏览器只能读取非敏感状态，不能读取 Key。
- `/schedule`：建立学期锚点和课表导入请求；未接视觉 Provider 时不伪造识别。
- `/learning`：维护课程档案和用户提供的资料链接。
- `/fitness`、`/nutrition`：记录本地恢复打卡和已确认的餐食数值。
- `/memory`：编辑、恢复、删除可检查的本地分域记忆。
- `/projects`：登记项目目录并查看过滤后的只读规划快照；无执行或写入能力。

这是技术预览而非已发布产品。当前分支已提供 Owner 主动配置的 DeepSeek 每日计划链路：Key 只在 Windows Core 内经 DPAPI 保护，模型只得到最小排程 Context，并只生成待审核草案；它不会自动写入日程。Core 会在 `Asia/Shanghai` 每天 07:00 触发一次，若错过则在当天首次打开 Today 时补偿一次。未配置 Key 时系统明确阻断，绝不伪造 AI 结果。课程视觉识别、公开资料搜索、动作 RAG、自然语言营养分析、Codex 项目执行、外部日历与提醒仍未接入。完整边界见[本地 MVP 技术设计](docs/technical/IMPLEMENTED-MVP-DESIGN.md)与[ADR-013](docs/decisions/ADR-013-daily-plan-local-automation.md)。

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

端到端测试会启动独立的 Core 与 Web，并且只使用被 Git 忽略的 `data/e2e-runs/managed-run-*` 及其私有 Next 构建目录。它覆盖首次建号、真实路由、任务闭环、课程/恢复/餐食/记忆/项目工作区、Provider 未配置和多个桌面/移动视口；不会重置用户预览数据或与手工预览抢 `.next` 锁。

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
- `apps/core`：只监听 loopback 的 Fastify 服务，负责身份、日程、专业模块、聚合和本地 SQLite。
- `packages/contracts`：跨端共享的 Zod API 契约。
- `packages/domain`：不依赖 UI/数据库的确定性领域规则。
- [产品 v2 规格](docs/superpowers/specs/2026-08-07-local-first-personal-ai-dashboard-v2-design.md)
- [Milestone 0.1 实施计划](docs/superpowers/plans/2026-08-07-local-foundation-owner-task-dashboard.md)
- [本地 Core 决策 ADR-005](docs/decisions/ADR-005-local-first-owner-hosted-core.md)
- [Agent 路由决策 ADR-006](docs/decisions/ADR-006-agent-routing-and-project-runner.md)
- [当前实际技术设计](docs/technical/IMPLEMENTED-MVP-DESIGN.md)
- [本地 MVP 验收文档](docs/releases/2026-08-17-mvp-acceptance.md)
