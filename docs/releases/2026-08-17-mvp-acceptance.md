# EV AI Dashboard 本地 MVP 验收文档

| 字段 | 内容 |
| --- | --- |
| 版本 | `0.2.0` 候选（未打发布标签） |
| 分支 | `codex/product-prd` |
| 日期 | 2026-08-17 |
| 目标环境 | Windows 10/11、Node.js 24、Chrome/Chromium 浏览器 |
| 数据策略 | 生产/个人数据、E2E 数据、验收预览数据三者互相隔离 |

## 1. 验收范围

本验收针对“本地单 Owner 的每日控制台 MVP”，包括：身份、Today、日程/课程基础、学习资料、恢复打卡、已确认餐食、本地记忆、只读项目快照、真实页面导航和 Provider 未配置状态。

不包括真实模型 API、API 密钥持久化、课表视觉识别、课程公开搜索、动作 RAG、自然语言饮食解析、外部日历/穿戴设备、云端/公网/原生 App。它们是后续产品能力，不能作为本次拒收理由或声称已交付。

## 2. 验收环境和测试矩阵

| 层级 | 命令/场景 | 期望 |
| --- | --- | --- |
| 代码单元与集成 | `npm test` | Contracts、Domain、Core、Web 与 runner 测试全部通过 |
| 类型 | `npm run typecheck` | TypeScript 无错误 |
| 静态质量 | `npm run lint`、`git diff --check` | 无 lint 和空白错误 |
| 构建 | `npm run build` | Web/Core/共享包可构建 |
| 浏览器 E2E | `npm run test:e2e` | 独立端口、独立数据、四个 spec 全部通过 |
| 视口 | 1440×900、1024×768、390×844、320×800 | 真实路径可进入、无横向溢出、可触摸控制可用 |
| 安全边界 | Provider 未配置、项目快照、Owner 认证 | 无假回复、敏感文件不出现在快照、未认证受拒绝 |

最终命令结果记录在第 4 节；浏览器验证使用 Chromium 自动化视口，不把它表述为真实 iPhone 物理设备测试。

## 3. 验收操作步骤

1. 用新的 `EV_DATA_DIR` 启动 Core 与 Web，访问 `/setup` 建立唯一测试账号；没有默认账号或密码。
2. 登录后进入 `/today`，确认能看到当日任务/安排区域和“日程与课表、学习、训练恢复、饮食、项目、记忆”入口。
3. 进入 `/schedule` 建立学期锚点；没有视觉 Provider 时，上传课表不会被伪造成识别成功。
4. 进入 `/learning` 创建课程并登记一个课程资料 URL；资料应只属于所选课程。
5. 进入 `/fitness` 提交恢复打卡，回到 `/today`，确认显示恢复状态和非医疗提示。
6. 进入 `/nutrition` 保存一条已确认餐食，确认能看到计算结果。
7. 进入 `/memory` 保存 GENERAL 文本，查看历史、恢复和删除；在数据目录的 `memory` 中可检查 Markdown 投影。
8. 进入 `/projects` 登记一个无敏感内容的测试目录并查看快照；确认 `.env`/证书/依赖目录未出现，页面没有执行或修改项目的入口。
9. 进入 `/agent` 或 Provider 设置，确认未配置时显示阻断/说明，而非虚构 AI 回答。
10. 在浏览器刷新、后退、前进，并以 390×844 与 320×800 测试页面；所有导航应保持真实 URL 和可读布局。

## 4. 自动化验证结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm test` | 通过 | legacy 4/4；Core 20 files、82 tests；Web 16 files、150 tests；Contracts 27；Domain 7 |
| `npm run typecheck` | 通过 | Core、Web、Contracts、Domain 均 `tsc --noEmit` 成功 |
| `npm run lint` | 通过 | ESLint 无错误 |
| `npm run build` | 通过 | Next.js 生产构建成功；所有 Dashboard 路由已列入构建产物 |
| `npm run test:e2e` | 通过 | 4/4 通过，20.9 秒；覆盖未配置 Agent 503、桌面/移动真实路由、课程/恢复/餐食/记忆/项目闭环、任务与退出；与手工预览并行运行 |
| `git diff --check` | 通过 | 无空白错误；Windows Git 仅提示工作区的 LF/CRLF 转换 |
| Code Intel lite | 通过 | 干净源码工件：`C:\\Users\\asus\\AppData\\Local\\code-intel\\artifacts\\product-prd\\1786915825822-460-core\\run-complete.json`；该版本只有 content-addressed object，不生成 summary/hospital/understanding 文档 |
| Sentrux | 结构告警已记录 | 最终扫描解析 164 个文件、663 条导入边，0 unresolved、0 inherit edges；未配置 `rules.toml`，所以 Quality 未门禁。先前会话的质量信号 9671 → 9608、耦合 36.09 → 40.31 仍按 P2 跟踪，未更新 baseline 掩盖变化。 |
| `npm audit --omit=dev --json` | 不可作为生产放行 | 3 个 high：`next → postcss → nanoid`，`fixAvailable: false`；本地 MVP 可验收，但正式公网发布前必须复查并解决/接受风险 |

E2E 中页面级 console/pageerror 监听为零问题；终端中的 `NO_COLOR` Node 警告来自测试进程环境，不是浏览器页面错误。

独立验收预览已使用全新的 `data/acceptance-preview-final-86466683bdb046d29b69b9b1baf8e503` 数据目录启动：Core `http://127.0.0.1:4316/v1/health/ready` 和 Web `http://127.0.0.1:3016/setup` 均返回 HTTP 200。该目录中尚无 Owner；验收人员应自行建立唯一测试账号。

## 5. 缺陷、限制和回滚

已修复 P1 与仍保留的 P2/P3 见[缺陷与边界记录](../reviews/2026-08-17-mvp-bug-log.md)。其中最重要的已知限制是没有真实 Provider/安全密钥存储、长期记忆缺少分页/压缩/保留策略，以及课程/训练/饮食智能链路尚未接入。

回滚遵循两层原则：

1. **代码**：在合并前直接停止使用此分支；合并后使用一个明确的 revert 提交，不重写共享历史。
2. **数据**：发布/迁移前备份完整 `EV_DATA_DIR`（SQLite、`-wal`、`-shm` 与 `memory`）；不要用旧程序直接打开已迁移副本。

## 6. 验收结论

**本地 MVP 验收通过（附条件）**：第 1 节范围内的功能和自动化验证具备交付依据，Provider 未配置时没有伪造行为，测试数据未接触用户数据。此结论不等同于公网生产发布批准；依赖高危告警、Sentrux P2、真实 Provider/凭据存储和外部集成仍需在后续发布门槛前处理。
