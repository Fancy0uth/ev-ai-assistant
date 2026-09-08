# v0.7 goal state

## Milestone

M2 / v0.7 remains open at version `0.7.0`. The Main Agent's complete local matrix is green, and the third/final Sol whole-version review is frozen at `20d2fa1` with verdict FAIL: P0=0, P1=1, P2=4. All previously open P1 findings are closed, but new `V07-LINEAGE-015` proves that a reused nutrition source key can persist false immutable legal/hash lineage into a confirmed Meal.

The three-cycle doubt-driven limit is reached. Work is paused at the release quality gate pending an explicit Owner decision on one bounded `V07-LINEAGE-015` exception repair; v0.8 has not started.

## Achieved invariants

- Existing Owner auth protects `/v1/health-capabilities` and every v0.7 route.
- Fixture use requires a strict, runtime-parsed descriptor plus test runtime, explicit gate, and Windows-safe DB/data/artifact containment inside the runner root. Fixture, approved-local, and production descriptor markers cannot be mixed.
- All v0.7 local/external commands use crash-safe idempotency with collision, live-claim, exact replay, stale recovery, and atomic finalization semantics.
- Daily capability quota failures return stable `Retry-After: 86400`; terminal same-key replay preserves status/body and emits both retry metadata and `Idempotency-Replayed: true`.
- All three Provider boundaries reject at eight seconds, enforce canonical UTF-8 byte budgets, validate strict schema/correlation before domain writes, and terminalize failures as controlled 503 responses.
- Decimal values use one canonical grammar and BigInt micros with bounded parse/scale/entry/total paths; range failures map to 422.
- Original v20 and committed v21 remain unchanged. Additive v22 audits every established v0.7 Owner-lineage edge before recording itself and fails closed without changing corrupt rows. Clean v1/v2/v16/v17/v18/v19/v20/v21 upgrades are covered through two startups.
- Synthetic nutrition `datasetHash` covers the complete canonical fixture preimage; `recordHash` is independently recomputed. Unknown synthetic input fails loudly.
- Core E2E writes a redacted `v0.7-health-evidence.json`; the runner validates and preserves it before cleanup.

## Deliberately retained debt

- `V07-CONTRACT-010` remains P2: nested public response objects still include frozen `z.unknown()` placeholders.
- `V07-BROWSER-011` remains P2: browser coverage still lacks every intermediate/error state and per-stage overflow check.
- `V07-EVIDENCE-014` remains P2: preserved evidence is not target-bound strongly enough for promotion.
- `V07-REPORT-016` was a stale state sentence at reviewed HEAD and is corrected by this handoff update; the immutable review retains the original P2 evidence.
- The six inherited v0.6 P2 items remain out of scope.

## Approval-gated evidence

Approved local nutrition datasets, real nutrition APIs, real health-text/DeepSeek providers, network access, credentials, personal/health data, external datasets/licenses, installation, deployment, push, tag, and release are all `NOT RUN — APPROVAL REQUIRED`.
