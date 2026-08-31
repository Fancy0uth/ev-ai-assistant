# v0.7 goal state

## Milestone

M2 / v0.7 fitness, recovery, reviewed workouts, sourced nutrition, and deterministic meal totals is implemented at version `0.7.0`. The first Sol review found nine P1 defects; all nine now have committed local fixes at HEAD `d728936` and a green final engineering matrix. Main Agent review and any later Sol rereview remain outside this Terra run.

## Achieved invariants

- Existing Owner auth protects `/v1/health-capabilities` and every v0.7 route.
- Fixture use requires test runtime, explicit flag, and Windows-safe DB/data/artifact containment inside the runner root.
- All v0.7 local/external commands use crash-safe idempotency with collision, live-claim, exact replay, stale recovery, and atomic finalization semantics.
- All three Provider boundaries reject at eight seconds, enforce canonical UTF-8 byte budgets, validate strict schema/correlation before domain writes, and terminalize failures as controlled 503 responses.
- Decimal values use one canonical grammar and BigInt micros with bounded parse/scale/entry/total paths; range failures map to 422.
- Original v20 remains intact. Additive v21 supplies composite unique indexes plus equivalent trigger-based Owner correlation without rebuilding existing tables. v1/v2/v16/v17/v18/v19/v20 upgrades are covered.
- Synthetic nutrition `datasetHash` covers the complete canonical fixture preimage; `recordHash` is independently recomputed. Unknown synthetic input fails loudly.
- Core E2E writes a redacted `v0.7-health-evidence.json`; the runner validates and preserves it before cleanup.

## Deliberately retained debt

- `V07-CONTRACT-010` remains P2: nested public response objects still include frozen `z.unknown()` placeholders.
- `V07-BROWSER-011` remains P2: the browser/component matrix does not yet cover every intermediate/error state and per-stage overflow check.
- The six inherited v0.6 P2 items remain out of scope.

## Approval-gated evidence

Approved local nutrition datasets, real nutrition APIs, real health-text/DeepSeek providers, network access, credentials, personal/health data, external datasets/licenses, installation, deployment, push, tag, release, and Sol rereview are all `NOT RUN — APPROVAL REQUIRED`.
