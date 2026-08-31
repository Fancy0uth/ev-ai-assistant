# v0.7 goal state

## Milestone

M2 / v0.7 fitness, recovery, reviewed workouts, sourced nutrition, and deterministic meal totals remains implemented at version `0.7.0`. The first Sol review and first rereview both remain FAIL history. The third/final Terra repair cycle committed all three authorized P1 fixes at `346e744`; the Main Agent independently reran a green complete matrix and normalized only the historical rereview's trailing whitespace at `934ae77`. A fresh third Sol review remains pending.

Final engineering status is not a claimed PASS: all observed workspace test results are green, but the root-test parent PTY exit was not captured, and both mandatory range diff-checks exit 1 on trailing whitespace already committed in the immutable rereview at base `caf4b83`.

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
- The six inherited v0.6 P2 items remain out of scope.

## Approval-gated evidence

Approved local nutrition datasets, real nutrition APIs, real health-text/DeepSeek providers, network access, credentials, personal/health data, external datasets/licenses, installation, deployment, push, tag, release, and Sol rereview are all `NOT RUN — APPROVAL REQUIRED`.
