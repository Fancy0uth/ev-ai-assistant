# Local AI Dashboard MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved local-first daily AI Dashboard MVP through a testable schedule-and-Proposal control loop.

**Architecture:** Keep Next.js Web as the same-origin UI/BFF and Fastify Core as the sole owner of SQLite, background jobs, Agent policy and audits. Add the approved calendar/Proposal domain vertically; every outside capability remains behind a typed Port and every high-impact schedule change remains Owner-confirmed.

**Tech Stack:** Node 24, TypeScript 6, Next.js 16, React 19, Fastify 5, better-sqlite3, Zod, Vitest, Playwright.

## Global Constraints

- Core binds only `127.0.0.1`; browser accesses it only through the fixed Web BFF.
- No API key, password, raw health record or unfiltered local project file enters a commit or ordinary log.
- Model, OCR, web search, nutrition and Codex results are untrusted data and must pass a contract before use.
- Project analysis is snapshot-only and must never write to a user project.
- Proposal confirmation is mandatory before writing Event/Rule/Exception data.
- Each task is a TDD slice with an atomic commit. Run focused tests before the commit.

---

### Task 1: Restore the workspace verification baseline

**Files:**
- Modify: `package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/web/vitest.config.ts`
- Modify: `apps/web/tests/playwright-config.test.ts`

**Produces:** A reproducible package-manager installation boundary and a loadable Web Vitest config.

- [ ] Write a focused config test that imports the configured React plugin.
- [ ] Run `npm run test --workspace @ev/web`; observe the missing-plugin failure.
- [ ] Restore dependencies only from the committed lockfile; do not hand-create `node_modules`.
- [ ] Run `npm ls @vitejs/plugin-react --workspace @ev/web` and Web tests; both pass.
- [ ] Commit `fix: restore workspace test dependencies`.

### Task 2: Repair Core runtime Contract regressions

**Files:**
- Modify: `apps/core/tests/auth.test.ts`
- Modify: `apps/core/tests/agent-api.test.ts`
- Modify: `apps/core/tests/tasks.test.ts`
- Modify: `apps/core/src/http/api-error.ts`
- Modify: the smallest confirmed runtime-resolution/configuration file

**Produces:** Auth session, Agent resource and Task 409 tests use the expected shared contract exports.

- [ ] Add a runtime export regression assertion for `sessionResponseSchema`, `agentSessionResponseSchema` and `apiErrorSchema`.
- [ ] Run `npm run test --workspace @ev/core`; preserve the 14-failure evidence.
- [ ] Fix the confirmed package resolution/error boundary cause; do not weaken assertions.
- [ ] Run Core tests green.
- [ ] Commit `fix: restore core contract runtime`.

### Task 3: Define schedule and Proposal contracts

**Files:**
- Create: `packages/contracts/src/calendar.ts`
- Create: `packages/contracts/src/proposals.ts`
- Create: `packages/domain/src/schedule.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/domain/tests/schedule.test.ts`

**Produces:** `Event`, `Action`, `ActivitySession`, `Signal`, `CalendarRule`, `Proposal`, `TimeRequest`, `expandRule()` and `detectConflicts()`.

- [ ] Test week 1–16 expansion, odd/even weeks, adjacent events and hard-event overlaps.
- [ ] Run Domain test red, implement pure local-time rules with no I/O, then add strict Zod schemas.
- [ ] Run Contracts/Domain tests green.
- [ ] Commit `feat: define schedule proposal contracts`.

### Task 4: Persist calendar and Proposal data without data loss

**Files:**
- Modify: `apps/core/src/storage/migrations.ts`
- Create: `apps/core/src/modules/calendar/repository.ts`
- Create: `apps/core/src/modules/proposals/repository.ts`
- Modify: `apps/core/tests/database.test.ts`
- Test: `apps/core/tests/calendar-repository.test.ts`

**Produces:** Additive Term/Course/Rule/Event/Proposal migration and repositories retaining existing Owner/Task/Agent rows.

- [ ] Test upgrade from migration 002 containing Owner, Task and Agent message.
- [ ] Add one versioned migration, owner indexes, version columns and repository operations.
- [ ] Test retained counts and owner isolation.
- [ ] Commit `feat: persist calendar and proposal records`.

### Task 5: Apply versioned Proposals and expose Day View

**Files:**
- Create: `apps/core/src/modules/proposals/service.ts`
- Create: `apps/core/src/modules/proposals/routes.ts`
- Create: `apps/core/src/modules/day-planning/service.ts`
- Modify: `apps/core/src/app.ts`
- Test: `apps/core/tests/proposal-api.test.ts`

**Produces:** Owner-scoped Proposal read/approve/reject, 409 latest-state semantics and `GET /v1/days/:date` aggregate.

- [ ] Test pending Proposal, stale approval, reject-without-write and confirmed Event in Day View.
- [ ] Implement the transaction that validates version, applies once and writes audit data.
- [ ] Run focused Core tests green.
- [ ] Commit `feat: confirm schedule proposals`.

### Task 6: Build Course Import and daily-planner Runs

**Files:**
- Create: `apps/core/src/modules/agents/provider.ts`
- Create: `apps/core/src/modules/calendar/import-service.ts`
- Create: `apps/core/src/modules/jobs/service.ts`
- Modify: `apps/core/src/app.ts`
- Test: `apps/core/tests/course-import.test.ts`

**Produces:** Vision Provider Port, blocked-unconfigured state, candidate validation, import Proposal generation and idempotent daily-plan Job scheduling.

- [ ] Test fake-provider valid/malformed/low-confidence candidates and startup 07:00 catch-up.
- [ ] Implement Run states, schema validation, rule expansion, Proposal handoff and unique jobs.
- [ ] Run focused Core tests green.
- [ ] Commit `feat: add course import planning runs`.

### Task 7: Add Provider profiles, context manifests and Agent Runs

**Files:**
- Create: `apps/core/src/modules/providers/service.ts`
- Create: `apps/core/src/modules/agents/orchestrator.ts`
- Create: `packages/contracts/src/providers.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/core/tests/agent-run.test.ts`

**Produces:** Non-secret Provider metadata, context manifests, bounded Run states and 503/no-fake-result behavior.

- [ ] Test that unconfigured Profiles neither persist a secret nor create success output; fake typed Provider records a manifest.
- [ ] Implement typed dispatch, limits and audit-safe metadata; leave the OS secret adapter explicitly unavailable until dependency review.
- [ ] Run tests green.
- [ ] Commit `feat: add provider neutral agent runs`.

### Task 8: Implement local memory and read-only Project Brief

**Files:**
- Create: `apps/core/src/modules/memory/service.ts`
- Create: `apps/core/src/modules/memory/markdown.ts`
- Create: `apps/core/src/modules/projects/snapshot.ts`
- Create: `apps/core/src/modules/projects/service.ts`
- Test: `apps/core/tests/memory-project.test.ts`

**Produces:** Versioned Markdown projections and a filtered, zero-write ProjectSnapshot/ProjectBrief path.

- [ ] Test revision/restore, scope isolation, `.env` exclusion, path escape, oversized files and zero filesystem mutation.
- [ ] Implement revision writer, atomic projection and snapshot allowlist.
- [ ] Run tests green.
- [ ] Commit `feat: add local memory and project briefs`.

### Task 9: Build course profiles and learning-plan artifacts

**Files:**
- Create: `apps/core/src/modules/learning/repository.ts`
- Create: `apps/core/src/modules/learning/service.ts`
- Create: `packages/contracts/src/courses.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/core/tests/learning.test.ts`

**Produces:** Per-course profile/resources/current-stage records plus citation-bearing pre-study Action/TimeRequest drafts.

- [ ] Test course owner isolation, user-provided resource attribution, public-search Provider unavailable state and a typed learning artifact.
- [ ] Implement course records and a `PublicSearchProvider` Port use that never fetches authenticated school sites.
- [ ] Run focused tests green.
- [ ] Commit `feat: add course learning artifacts`.

### Task 10: Build fitness and nutrition records

**Files:**
- Create: `apps/core/src/modules/fitness/service.ts`
- Create: `apps/core/src/modules/nutrition/service.ts`
- Create: `packages/domain/src/recovery.ts`
- Modify: `apps/core/src/storage/migrations.ts`
- Test: `apps/core/tests/fitness-nutrition.test.ts`

**Produces:** Check-in → Signal → Workout Proposal and food candidate → confirmation → meal record paths.

- [ ] Test recovery calculation, Provider-unavailable meal parsing, confirmed totals and Proposal-only workout scheduling.
- [ ] Implement deterministic rules and local catalog adapter interface; never diagnose or save model guessed nutrition facts.
- [ ] Run tests green.
- [ ] Commit `feat: add fitness and nutrition records`.

### Task 11: Build Today/Calendar and domain Web workspaces

**Files:**
- Create: `apps/web/src/components/day/day-console.tsx`
- Create: `apps/web/src/components/calendar/course-import.tsx`
- Create: `apps/web/src/components/workspaces/module-workspace.tsx`
- Modify: `apps/web/src/app/(dashboard)/today/page.tsx`
- Test: `apps/web/tests/day-console.test.tsx`

**Produces:** Time line, signals, Actions, Proposal UI, course import and distinct project/course/wellbeing sections.

- [ ] Test no-data, pending Proposal, low-confidence candidate, confirmed Event and unconfigured Provider states.
- [ ] Implement Core client calls, error/409 UI, real accessible routes and mobile-safe layout.
- [ ] Run Web tests green.
- [ ] Commit `feat: add daily calendar control console`.

### Task 12: Add settings, memory and Agent screens

**Files:**
- Create: `apps/web/src/app/(dashboard)/memory/page.tsx`
- Create: `apps/web/src/app/(dashboard)/settings/providers/page.tsx`
- Modify: `apps/web/src/components/agent/agent-workspace.tsx`
- Modify: `apps/web/src/components/shell/app-shell.tsx`
- Test: `apps/web/tests/settings-memory.test.tsx`

**Produces:** Honest Provider configuration status, inspectable memory and Agent run/context state on desktop and iPhone.

- [ ] Test Provider-not-configured, memory restore confirmation and keyboard/touch navigation.
- [ ] Implement page routes and no-secret rendering.
- [ ] Run Web tests green.
- [ ] Commit `feat: expose provider and memory controls`.

### Task 13: Validate, repair and hand off

**Files:**
- Create: `apps/web/e2e/mvp-control-loop.spec.ts`
- Create: `docs/reviews/2026-08-17-mvp-bug-log.md`
- Create: `docs/releases/2026-08-17-mvp-acceptance.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

**Produces:** Minimal desktop/iPhone E2E, bug log, fixes, release notes and an acceptance guide.

- [ ] Cover isolated setup, fixture/manual course Proposal confirmation, Check-in and Provider-unconfigured flow at 1440×900 and 390×844.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`; record actual outcomes.
- [ ] Fix all found P0/P1 with targeted regression tests and document accepted P2/P3.
- [ ] Run Code Intel lite, Sentrux check and `git diff --check`.
- [ ] Commit `docs: record mvp verification and acceptance`.

## Plan self-review

| Requirement | Covering tasks |
| --- | --- |
| Baseline health | 1–2 |
| Event/Action/Session/Signal, Proposal and Today | 3–6, 11 |
| Course screenshot and 07:00 planning | 6, 9, 11, 13 |
| Provider/Agent/local memory | 7–8, 12 |
| Read-only project and learning | 8–9, 11 |
| Fitness and nutrition | 10–11 |
| Desktop/iPhone and real navigation | 11–13 |
| Migration/security/bugs/docs | 2, 4, 7–8, 13 |

All tasks have dependency order, a focused verification path and a bounded file list. The specific OS credential-store Adapter is deliberately unavailable rather than insecure: its dependency choice requires a separate security/dependency review before it can retain real API keys.
