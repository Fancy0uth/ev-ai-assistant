# Local-First Foundation and Owner Task Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付第一条真实可运行的纵向链路：单所有者本地账号登录，通过 Web 调用独立 Core，把任务持久化到 SQLite，并在 Today Dashboard 中创建、完成和解释性重算状态。

**Architecture:** 建立 npm workspaces monorepo。`apps/web` 是 Next.js 16 Web 与 same-origin BFF，`apps/core` 是仅监听 loopback 的 Fastify 5 Core，`packages/contracts` 保存 Zod 4 HTTP 契约，`packages/domain` 保存不依赖框架的 Today 状态规则。Core 是 SQLite 的唯一写入者；浏览器不直接访问 Core 或数据库。

**Tech Stack:** Node.js 24.18.0, npm 11.16.0, TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, Fastify 5.11.2, Zod 4.4.3, better-sqlite3 13.0.3, Vitest 4.1.10, Playwright 1.62.1, ESLint 9.39.5. TypeScript 与 ESLint 版本按 Next.js 16.3 的当前 peer dependency 上限选择，不追求不兼容的 npm latest。

## Global Constraints

- `docs/superpowers/specs/2026-08-07-local-first-personal-ai-dashboard-v2-design.md` 是唯一产品权威规格。
- Web 监听 `127.0.0.1:3000`；Core 监听 `127.0.0.1:4310`；浏览器只请求 Web 的 `/api/core/*`。
- 持久数据默认位于 `EV_DATA_DIR`；开发默认目录为仓库外的用户数据目录，测试必须使用独立临时目录。
- Core 是 SQLite 唯一写入者，启用 WAL、foreign keys、busy timeout 和版本化迁移。
- 所有 HTTP 输入和输出通过 `packages/contracts` 的 Zod schema 验证。
- 所有错误使用 `{ error: { code, message, details? } }`；不得返回内部堆栈或 SQL。
- 密码不得明文存储；会话数据库只保存随机令牌的 SHA-256 摘要。
- Cookie 使用 HttpOnly、SameSite=Strict、Path=/；生产 HTTPS 时启用 Secure。
- Task 更新必须携带 `version`，过期写入返回 `409 VERSION_CONFLICT`。
- 本计划不启用 Tailscale，不调用 DeepSeek/Codex，不展示伪造 AI 对话，也不实现 Apple 日历。
- 用户可见文案为简体中文；320、768、1024、1440 像素宽度均可操作。
- 每个行为先 RED，再 GREEN，再重构；每个任务通过测试、类型、Lint 或构建后独立提交。

---

## File Structure

```text
apps/
  core/
    package.json
    tsconfig.json
    src/
      app.ts                         # Fastify factory and composition root
      config.ts                      # validated runtime configuration
      server.ts                      # loopback process entry point
      http/api-error.ts              # stable error type and handler
      storage/database.ts            # SQLite open/close and pragmas
      storage/migrations.ts          # ordered atomic schema migrations
      modules/health/routes.ts       # liveness/readiness
      modules/auth/password.ts       # scrypt hash and verify
      modules/auth/repository.ts     # owner/session persistence
      modules/auth/service.ts        # setup/login/session rules
      modules/auth/routes.ts         # auth HTTP boundary and cookie
      modules/auth/guard.ts          # authenticated-owner preHandler
      modules/tasks/repository.ts    # owner-scoped task SQL
      modules/tasks/service.ts       # task transitions and version checks
      modules/tasks/routes.ts        # task HTTP boundary
      modules/today/routes.ts        # Today aggregate endpoint
    tests/
      helpers/test-app.ts
      health.test.ts
      database.test.ts
      auth.test.ts
      tasks.test.ts
      today.test.ts
  web/
    package.json
    tsconfig.json
    next.config.ts
    vitest.config.ts
    playwright.config.ts
    src/
      app/layout.tsx
      app/globals.css
      app/page.tsx
      app/login/page.tsx
      app/setup/page.tsx
      app/today/page.tsx
      app/api/core/[...path]/route.ts # fixed-origin BFF proxy
      components/auth/auth-form.tsx
      components/shell/app-shell.tsx
      components/today/today-dashboard.tsx
      components/today/task-composer.tsx
      components/today/task-list.tsx
      components/today/status-overview.tsx
      components/today/agent-panel.tsx
      lib/core-client.ts
    tests/
      setup.ts
      auth-form.test.tsx
      today-dashboard.test.tsx
    e2e/owner-task-dashboard.spec.ts
packages/
  contracts/
    package.json
    src/api.ts
    src/health.ts
    src/auth.ts
    src/tasks.ts
    src/today.ts
    src/index.ts
    tests/contracts.test.ts
  domain/
    package.json
    src/daily-status.ts
    src/index.ts
    tests/daily-status.test.ts
eslint.config.mjs
tsconfig.base.json
package-lock.json
```

## Task 1: Establish the workspace and versioned contract package

**Files:**
- Modify: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/api.ts`
- Create: `packages/contracts/src/health.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/tests/contracts.test.ts`
- Create: `apps/core/package.json`
- Create: `apps/core/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/index.ts`
- Create: `package-lock.json`

**Interfaces:**
- Produces workspace packages `@ev/contracts`, `@ev/domain`, `@ev/core`, `@ev/web`.
- Produces `apiErrorSchema`, `healthResponseSchema`, `readinessResponseSchema` and inferred TypeScript types.

- [ ] **Step 1: Add exact workspace manifests and tool configuration**

Root scripts must preserve the static Demo test as `test:legacy` and add:

```json
{
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "test:legacy": "node --test tests/dashboard.test.mjs",
    "test": "npm run test:legacy && npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "eslint .",
    "build": "npm run build --workspaces --if-present",
    "test:e2e": "npm run test:e2e --workspace @ev/web"
  },
  "engines": { "node": ">=24.0.0 <25" }
}
```

Use exact dependency versions from the plan header. Configure Next.js ESLint flat config with `core-web-vitals`, TypeScript rules and `settings.next.rootDir = "apps/web"`. Ignore `node_modules`, `.next`, `coverage`, `dist`, `.env*`, `data`, `backups` and Playwright artifacts while retaining `.env.example`.

- [ ] **Step 2: Install dependencies and generate the single root lockfile**

Run: `npm install`.

Expected: all four workspaces resolve from the root and `package-lock.json` records exact transitive versions.

- [ ] **Step 3: Write a failing contract test**

```ts
import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '../src/index';

describe('healthResponseSchema', () => {
  it('rejects a health response without a service version', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});
```

Run: `npm run test --workspace @ev/contracts`.

Expected: FAIL because `healthResponseSchema` is not exported.

- [ ] **Step 4: Define the stable response and error schemas**

```ts
import * as z from 'zod';

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('ev-core'),
  version: z.string().min(1),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({ database: z.enum(['up', 'down']) }),
});
```

- [ ] **Step 5: Verify and commit**

Run: `npm run test --workspace @ev/contracts`, `npm run typecheck --workspace @ev/contracts`, `npm run lint`, `git diff --check`.

Commit: `chore: establish local-first workspace contracts`.

## Task 2: Prove the independent Core health path

**Files:**
- Create: `apps/core/src/config.ts`
- Create: `apps/core/src/http/api-error.ts`
- Create: `apps/core/src/modules/health/routes.ts`
- Create: `apps/core/src/app.ts`
- Create: `apps/core/src/server.ts`
- Create: `apps/core/tests/health.test.ts`

**Interfaces:**
- `buildApp(options?: { databasePath?: string; logger?: boolean }): Promise<FastifyInstance>`.
- `GET /v1/health/live` returns `HealthResponse`.
- `GET /v1/health/ready` returns HTTP 200 when dependencies are ready and 503 otherwise.

- [ ] **Step 1: Write the failing liveness test**

```ts
it('reports the Core service version', async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({ method: 'GET', url: '/v1/health/live' });

  expect(response.statusCode).toBe(200);
  expect(healthResponseSchema.parse(response.json())).toEqual({
    status: 'ok', service: 'ev-core', version: '0.1.0',
  });
  await app.close();
});
```

Run: `npm run test --workspace @ev/core -- health.test.ts`.

Expected: FAIL because `buildApp` does not exist.

- [ ] **Step 2: Implement the minimal app factory and stable error handler**

`buildApp` creates Fastify with request IDs, registers `/v1/health/live`, and maps `ApiError` to the shared error shape. Unknown errors log only server-side and return `INTERNAL_ERROR` without a stack.

```ts
export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  app.get('/v1/health/live', async () => ({
    status: 'ok', service: 'ev-core', version: '0.1.0',
  }));
  return app;
}
```

- [ ] **Step 3: Bind the process entry point only to loopback**

`server.ts` validates `EV_CORE_HOST`, `EV_CORE_PORT` and `EV_DATA_DIR`, rejects non-loopback hosts in this release, and calls `app.listen({ host: '127.0.0.1', port: 4310 })` by default.

- [ ] **Step 4: Verify and commit**

Run: `npm run test --workspace @ev/core -- health.test.ts`, `npm run typecheck --workspace @ev/core`, `npm run lint`.

Commit: `feat: add loopback Core health service`.

## Task 3: Add SQLite lifecycle and atomic migrations

**Files:**
- Create: `apps/core/src/storage/migrations.ts`
- Create: `apps/core/src/storage/database.ts`
- Create: `apps/core/tests/database.test.ts`
- Modify: `apps/core/src/app.ts`
- Modify: `apps/core/src/modules/health/routes.ts`

**Interfaces:**
- `openDatabase(path: string): Database.Database` opens and migrates one SQLite database.
- `runMigrations(db)` applies each migration once inside a transaction.
- Readiness executes `SELECT 1` and returns database `up` or `down`.

- [ ] **Step 1: Write failing migration and persistence tests**

```ts
it('applies the initial schema once and persists data across reopen', () => {
  const path = join(tempDir, 'app.sqlite');
  const first = openDatabase(path);
  first.prepare("insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)")
    .run('owner-1', 'codex', 'hash', '2026-08-07T00:00:00.000Z');
  first.close();

  const second = openDatabase(path);
  const row = second.prepare('select username from owners where id = ?').get('owner-1');
  expect(row).toEqual({ username: 'codex' });
  expect(second.prepare('select count(*) as count from schema_migrations').get()).toEqual({ count: 1 });
  second.close();
});
```

Run: `npm run test --workspace @ev/core -- database.test.ts`.

Expected: FAIL because the database module does not exist.

- [ ] **Step 2: Implement migration 001**

Migration 001 creates `schema_migrations`, `owners`, `sessions` and `tasks`. `owners` enforces a singleton row with `singleton_key INTEGER PRIMARY KEY CHECK(singleton_key = 1)`. `sessions.token_hash` is unique. `tasks` has owner FK, title, area, priority, status, target date, timestamps, completion timestamp and integer `version >= 1`.

- [ ] **Step 3: Apply defensive SQLite settings**

On every connection run:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

Run each unapplied migration and its `schema_migrations` insert in one transaction. `app.close()` closes the connection.

- [ ] **Step 4: Make readiness depend on SQLite**

`GET /v1/health/ready` returns `{ status: 'ready', checks: { database: 'up' } }`; a closed or failed connection returns 503 with `not_ready/down`.

- [ ] **Step 5: Verify and commit**

Run: `npm run test --workspace @ev/core -- database.test.ts health.test.ts`, `npm run typecheck --workspace @ev/core`, `npm run lint`.

Commit: `feat: add local SQLite lifecycle`.

## Task 4: Implement single-owner setup and authenticated sessions

**Files:**
- Create: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/core/src/modules/auth/password.ts`
- Create: `apps/core/src/modules/auth/repository.ts`
- Create: `apps/core/src/modules/auth/service.ts`
- Create: `apps/core/src/modules/auth/guard.ts`
- Create: `apps/core/src/modules/auth/routes.ts`
- Create: `apps/core/tests/auth.test.ts`
- Modify: `apps/core/src/app.ts`

**Interfaces:**
- `GET /v1/auth/setup-status -> { data: { needsSetup: boolean } }`.
- `POST /v1/auth/setup` accepts `{ username, password }`, only while no owner exists.
- `POST /v1/auth/login` accepts the same shape and creates a seven-day session.
- `GET /v1/auth/session -> { data: { owner: { id, username } } }`.
- `POST /v1/auth/logout` revokes the current session and expires the cookie.

- [ ] **Step 1: Define auth schemas and write failing API tests**

```ts
it('allows exactly one owner setup and authenticates the returned cookie', async () => {
  const app = await createTestApp();
  const setup = await app.inject({
    method: 'POST', url: '/v1/auth/setup',
    payload: { username: 'codex', password: 'correct horse battery staple' },
  });
  expect(setup.statusCode).toBe(201);
  const cookie = setup.cookies.find(({ name }) => name === 'ev_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');

  const session = await app.inject({
    method: 'GET', url: '/v1/auth/session',
    cookies: { ev_session: cookie!.value },
  });
  expect(session.statusCode).toBe(200);
  expect(session.json().data.owner.username).toBe('codex');

  const second = await app.inject({
    method: 'POST', url: '/v1/auth/setup',
    payload: { username: 'other', password: 'another safe password' },
  });
  expect(second.statusCode).toBe(409);
});
```

Run: `npm run test --workspace @ev/core -- auth.test.ts`.

Expected: FAIL with route not found.

- [ ] **Step 2: Hash and verify passwords with Node scrypt**

Use random 16-byte salt, `scrypt` with `N=16384`, `r=8`, `p=1`, a 64-byte result and `timingSafeEqual`. Persist the self-describing string `scrypt$16384$8$1$<salt-base64url>$<hash-base64url>`. Reject usernames outside 3–32 characters and passwords shorter than 12 characters before hashing.

- [ ] **Step 3: Create opaque sessions**

Generate 32 random bytes, return only the base64url token in the cookie, and store `sha256(token)` with owner ID and expiry. Session lookup rejects expired rows and deletes them. Logout is idempotent.

- [ ] **Step 4: Add route-level rate limits and auth guard**

Register `@fastify/cookie` and `@fastify/rate-limit`. Setup and login allow five attempts per minute per address. The guard attaches only `{ id, username }` to the request and returns `401 AUTHENTICATION_REQUIRED` for a missing, invalid or expired cookie.

- [ ] **Step 5: Verify and commit**

Run: `npm run test --workspace @ev/core -- auth.test.ts`, then all Core tests, typecheck and lint.

Commit: `feat: add local owner authentication`.

## Task 5: Deliver versioned task CRUD through Core

**Files:**
- Create: `packages/contracts/src/tasks.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/core/src/modules/tasks/repository.ts`
- Create: `apps/core/src/modules/tasks/service.ts`
- Create: `apps/core/src/modules/tasks/routes.ts`
- Create: `apps/core/tests/tasks.test.ts`
- Modify: `apps/core/src/app.ts`

**Interfaces:**
- `TaskArea = WORK | STUDY | LIFE`.
- `TaskPriority = LOW | MEDIUM | HIGH`.
- `TaskStatus = OPEN | IN_PROGRESS | DONE | DEFERRED | CANCELLED`.
- `POST /v1/tasks` creates an owner-scoped task.
- `GET /v1/tasks?page=1&pageSize=50&targetDate=YYYY-MM-DD` returns a stable paginated shape.
- `PATCH /v1/tasks/:id` requires `version` and changes only supplied fields.

- [ ] **Step 1: Define task contracts and write the failing create/list/update test**

```ts
it('creates, lists and completes only the signed-in owner task', async () => {
  const { app, cookie } = await createAuthenticatedTestApp();
  const created = await app.inject({
    method: 'POST', url: '/v1/tasks', cookies: cookie,
    payload: { title: '完成 Core 任务闭环', area: 'WORK', priority: 'HIGH', targetDate: '2026-08-07' },
  });
  expect(created.statusCode).toBe(201);
  const task = created.json().data;

  const completed = await app.inject({
    method: 'PATCH', url: `/v1/tasks/${task.id}`, cookies: cookie,
    payload: { version: task.version, status: 'DONE' },
  });
  expect(completed.json().data).toMatchObject({ status: 'DONE', version: 2 });
  expect(completed.json().data.completedAt).toBeTruthy();
});
```

Run: `npm run test --workspace @ev/core -- tasks.test.ts`.

Expected: FAIL because task routes do not exist.

- [ ] **Step 2: Implement owner-scoped repository queries**

Every select/update predicate contains both `id = ?` and `owner_id = ?`. List ordering is `status rank`, `priority rank`, then `created_at`; page size is clamped to 1–100. Convert snake_case database rows to contract camelCase in the repository boundary.

- [ ] **Step 3: Implement task state rules and optimistic concurrency**

Trim title; reject empty/over-200-character titles. On `DONE`, set `completedAt`; when moved from `DONE` to another status, clear it. Update with `WHERE id = ? AND owner_id = ? AND version = ?`; zero rows after an owner-scoped existence check returns `409 VERSION_CONFLICT`.

- [ ] **Step 4: Add error and isolation cases**

Tests must prove unauthenticated requests return 401, invalid input returns 422, an unknown task returns 404, stale version returns 409, and SQL responses never expose password/session columns.

- [ ] **Step 5: Verify and commit**

Run focused task tests, all Core tests, contracts tests, typecheck and lint.

Commit: `feat: add versioned local task API`.

## Task 6: Build the explainable Today aggregate

**Files:**
- Create: `packages/domain/src/daily-status.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/tests/daily-status.test.ts`
- Create: `packages/contracts/src/today.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/core/src/modules/today/routes.ts`
- Create: `apps/core/tests/today.test.ts`
- Modify: `apps/core/src/app.ts`

**Interfaces:**
- `calculateDailyStatus(input: DailyStatusInput): DailyStatus` is pure and deterministic.
- `GET /v1/today?date=YYYY-MM-DD` returns date, status, tasks, yesterday summary availability and Agent capability states.

- [ ] **Step 1: Write failing domain tests**

```ts
it('marks a day tight when several high-priority tasks remain', () => {
  const result = calculateDailyStatus({
    tasks: [
      { id: '1', title: 'A', priority: 'HIGH', status: 'OPEN', area: 'WORK' },
      { id: '2', title: 'B', priority: 'HIGH', status: 'OPEN', area: 'STUDY' },
      { id: '3', title: 'C', priority: 'HIGH', status: 'OPEN', area: 'LIFE' },
    ],
    yesterday: null,
  });

  expect(result.level).toBe('TIGHT');
  expect(result.reasons).toContain('仍有 3 个高优先级任务');
  expect(result.source).toBe('RULES_V1');
});
```

Run: `npm run test --workspace @ev/domain`.

Expected: FAIL because the calculation does not exist.

- [ ] **Step 2: Implement the transparent rule score**

Start at 78. Add up to 12 points from today's completion ratio. Subtract 7 points per remaining HIGH task, capped at 28; subtract 4 for more than six open tasks; clamp to 0–100. Levels are `STEADY` for 70+, `TIGHT` for 45–69, `OVERLOADED` below 45. Return up to three reasons and up to three priorities, ordered HIGH before MEDIUM before LOW.

- [ ] **Step 3: Add the Today contract and route**

```ts
export const todaySnapshotSchema = z.object({
  data: z.object({
    date: isoDateSchema,
    status: dailyStatusSchema,
    tasks: z.array(taskSchema),
    yesterday: z.object({ taskCompletion: z.number(), studyCompletion: z.number() }).nullable(),
    agents: z.object({
      deepSeek: z.literal('NOT_CONFIGURED'),
      codex: z.literal('NOT_CONFIGURED'),
    }),
  }),
});
```

Until provider configuration exists, Agent states must truthfully remain `NOT_CONFIGURED`; the UI must not imply an AI call occurred.

- [ ] **Step 4: Verify and commit**

Run domain, contract, Today/Core tests, typecheck and lint.

Commit: `feat: add explainable Today snapshot`.

## Task 7: Add the Next.js BFF and owner setup/login experience

**Files:**
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/api/core/[...path]/route.ts`
- Create: `apps/web/src/lib/core-client.ts`
- Create: `apps/web/src/components/auth/auth-form.tsx`
- Create: `apps/web/src/app/setup/page.tsx`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/tests/setup.ts`
- Create: `apps/web/tests/auth-form.test.tsx`

**Interfaces:**
- Browser calls only `/api/core/...`.
- BFF forwards to fixed `EV_CORE_URL` and copies status, JSON body and `Set-Cookie` without exposing the Core URL.
- `AuthForm` accepts `mode: 'setup' | 'login'` and renders validation/server errors accessibly.

- [ ] **Step 1: Write the failing auth form test**

```tsx
it('shows the server error and never reports false success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )));
  render(<AuthForm mode="login" />);
  await userEvent.type(screen.getByLabelText('用户名'), 'codex');
  await userEvent.type(screen.getByLabelText('密码'), 'wrong password');
  await userEvent.click(screen.getByRole('button', { name: '登录' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码错误');
});
```

Run: `npm run test --workspace @ev/web -- auth-form.test.tsx`.

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the fixed-origin proxy**

Use a Next.js Route Handler whose dynamic `params` is awaited. Reject empty segments, `.` and `..`; construct only `${EV_CORE_URL}/v1/${path.join('/')}`. Forward `GET`, `POST`, `PATCH`, `DELETE`, content type and request cookie. Never forward hop-by-hop headers. Copy the Core `set-cookie` response header to the same-origin response.

- [ ] **Step 3: Implement setup/login pages and accessible form states**

Fields have visible labels, browser autocomplete attributes and inline validation. Buttons expose pending text. Setup success and login success navigate to `/today`; 409 setup conflict navigates to `/login`; network failure says `本地 Core 暂时不可用，请确认服务已启动`.

- [ ] **Step 4: Add the base design system**

Define semantic CSS tokens for ink surfaces, warm neutral backgrounds, cyan system accents, green success, amber warning and red danger. Use one radius scale and one spacing scale. Include `prefers-reduced-motion`, visible focus rings and contrast-safe text. Do not add gradients, glassmorphism or generic purple AI styling.

- [ ] **Step 5: Verify and commit**

Run Web component tests, Web typecheck, lint and `npm run build --workspace @ev/web`.

Commit: `feat: add local owner web authentication`.

## Task 8: Deliver the real Today Dashboard and browser flow

**Files:**
- Create: `apps/web/src/components/shell/app-shell.tsx`
- Create: `apps/web/src/components/today/status-overview.tsx`
- Create: `apps/web/src/components/today/task-composer.tsx`
- Create: `apps/web/src/components/today/task-list.tsx`
- Create: `apps/web/src/components/today/agent-panel.tsx`
- Create: `apps/web/src/components/today/today-dashboard.tsx`
- Create: `apps/web/src/app/today/page.tsx`
- Create: `apps/web/tests/today-dashboard.test.tsx`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/owner-task-dashboard.spec.ts`
- Create: `apps/web/.env.example`
- Create: `README.md`
- Modify: `tasks/plan.md`
- Modify: `tasks/todo.md`

**Interfaces:**
- `TodayDashboard` loads `TodaySnapshot`, creates tasks, completes/defer tasks with versioned PATCH, and reloads authoritative state after mutation.
- `AgentPanel` displays real provider capability states and the rules-based recommendation; it never sends a model request in this slice.

- [ ] **Step 1: Write a failing component behavior test**

```tsx
it('creates a task and refreshes the Today status from the server', async () => {
  render(<TodayDashboard initialDate="2026-08-07" />);
  expect(await screen.findByText('今天还没有任务')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('新任务'), '完成第一个真实闭环');
  await userEvent.click(screen.getByRole('button', { name: '添加到今天' }));
  expect(await screen.findByText('完成第一个真实闭环')).toBeInTheDocument();
  expect(screen.getByText('规则引擎')).toBeInTheDocument();
});
```

Run: `npm run test --workspace @ev/web -- today-dashboard.test.tsx`.

Expected: FAIL because the Dashboard does not exist.

- [ ] **Step 2: Implement the responsive Dashboard hierarchy**

Desktop uses a 220px navigation rail, flexible Today canvas and 320px Agent panel. Tablet collapses navigation labels; mobile becomes one column with a fixed bottom navigation and a collapsible Agent section. The first viewport must show date/status, current priorities and task composer before secondary summaries.

- [ ] **Step 3: Implement truthful loading, empty, error and mutation states**

Use skeletons for initial loading, a constructive empty state, `role=alert` for failures and disabled/pending controls during writes. A failed mutation keeps the previous task visible and never displays success. A 401 response navigates to `/login`.

- [ ] **Step 4: Configure the two-process E2E test**

Playwright `webServer` starts Core with an isolated `EV_DATA_DIR` and Web with `EV_CORE_URL=http://127.0.0.1:4310`. The browser test must:

1. open `/setup` and create the owner;
2. land on `/today`;
3. create a HIGH WORK task for today;
4. verify it survives a page reload;
5. complete it and verify the status explanation changes;
6. log out and verify `/v1/tasks` is no longer accessible through the UI.

- [ ] **Step 5: Document the runnable milestone**

README includes prerequisites, `npm install`, development commands, local ports, `EV_DATA_DIR`, first-owner setup, test commands, architecture links and the explicit fact that DeepSeek/Codex/Tailscale are not enabled in milestone 0.1.

- [ ] **Step 6: Run the release checkpoint**

Run in order:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
git diff --check
```

Then use a real browser at 1440px and 390px to verify rendering, keyboard focus, network responses and zero console errors.

- [ ] **Step 7: Commit**

Commit: `feat: deliver local owner task dashboard`.

## Milestone 0.1 Acceptance Gate

- [ ] A fresh data directory allows exactly one Owner setup.
- [ ] Valid login survives reload; logout revokes the session.
- [ ] Password and raw session token never appear in SQLite queries returned to clients, logs or Git.
- [ ] An authenticated owner can create, list, complete and defer tasks.
- [ ] Stale task updates return 409 and preserve the newer row.
- [ ] Today score and reasons are deterministic and clearly labeled `规则引擎`.
- [ ] DeepSeek and Codex are visibly `未配置`, with no fake AI response.
- [ ] Restarting Core with the same data directory preserves account and tasks.
- [ ] Web cannot choose a different Core host through the proxy path.
- [ ] Unit, integration, component, build and E2E commands all pass.
- [ ] 390px mobile and 1440px desktop views have no horizontal overflow or inaccessible controls.

## Official Sources Used

- Next.js installation and Node support: https://nextjs.org/docs/app/getting-started/installation
- Next.js Server and Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js async cookies API: https://nextjs.org/docs/app/api-reference/functions/cookies
- Next.js ESLint flat config: https://nextjs.org/docs/app/api-reference/config/eslint
- Fastify validation and serialization: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Fastify injection testing: https://fastify.dev/docs/v5.7.x/Guides/Testing/
- Zod parsing and inferred types: https://zod.dev/basics
- better-sqlite3 transactions and WAL guidance: https://github.com/WiseLibs/better-sqlite3
- Playwright multiple web servers: https://playwright.dev/docs/test-webserver
