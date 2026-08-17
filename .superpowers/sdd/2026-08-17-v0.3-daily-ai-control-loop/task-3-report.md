# Task 3 — V3-03a Core DeepSeek connection test

## RED

- Added `apps/core/tests/deepseek-connection.test.ts` before implementation.
- Command: `npm run test --workspace @ev/core -- tests/deepseek-connection.test.ts`
- Result: failed as expected because `../src/modules/providers/deepseek-connection` did not exist.

## GREEN

- Added migration 12 (`add_provider_connection_tests`) with only owner, provider, status, failure code, and timestamp columns.
- Added a DeepSeek tester with an injected fetch seam and a fixed, minimal structured-JSON probe. It maps 401/403, 429, network/timeout, 5xx, and malformed/invalid success responses to the approved sanitized result codes.
- Added credential-service persistence: one sanitized result row per test run; metadata reads the latest result; save/remove do not fabricate a new result.
- Tests prove injected fakes, all mappings, result persistence, migration columns, and no API key or request body persistence.

## Commands and results

- `npm run test --workspace @ev/core -- tests/deepseek-connection.test.ts tests/provider-credential-service.test.ts` — passed (25 tests).
- `npm run typecheck --workspace @ev/core` — passed.
- `npm test` — passed (Core 109, Web 150, contracts 39, domain 7, legacy 4).
- `npm run typecheck` — passed.
- `git diff --check` — passed.

## Changed files

- `apps/core/src/storage/migrations.ts`
- `apps/core/src/modules/providers/credential-service.ts`
- `apps/core/src/modules/providers/deepseek-connection.ts`
- `apps/core/tests/deepseek-connection.test.ts`
- `apps/core/tests/database.test.ts`
- `.superpowers/sdd/2026-08-17-v0.3-daily-ai-control-loop/task-3-report.md`

## Commit

Commit hash at report finalization: `0457eff` (the final amended commit hash is reported in the task handoff).
