# v0.7 Sol escalation handoff

Date: 2026-08-31 Asia/Shanghai
Repair base: `caf4b83`
Committed HEAD: `346e744`
Review state: third/final Sol review FAIL at `20d2fa1`; P0=0, P1=1, P2=4

## Current state

The first Sol review remains an immutable FAIL record at `docs/reviews/2026-08-31-v0.7-sol-review.md`. The first rereview remains an immutable second FAIL record at `docs/reviews/2026-08-31-v0.7-sol-rereview.md`. The Main Agent accepted only `V07-MIG-006`, `V07-FIXTURE-008`, and `V07-REPLAY-013` for this third and final repair cycle. All three now have TDD-backed local commits.

The third Sol review at `docs/reviews/2026-08-31-v0.7-sol-rereview-2.md` closes all three previously open P1 findings after 114/114 fresh focused probes, but independently reproduces new P1 `V07-LINEAGE-015`. A reused nutrition source key can silently retain an older legal/source descriptor while accepting a record hash computed from a newer descriptor, and that false lineage can reach a confirmed Meal. Version remains `0.7.0`. No real Provider, network, credential, personal/health data, external dataset/license, installation, deployment, push, tag, or release was used.

## Third-cycle commits

- `a165331 fix(v0.7): fail closed on corrupt lineage upgrades`
- `aad7510 fix(v0.7): enforce provider descriptor invariants`
- `346e744 fix(v0.7): preserve quota retry metadata on replay`

## Focused evidence

- MIG RED: 69 failed / 1 passed. First real failure was corrupt v20 `check-in.signal` upgrading without an error. GREEN: three files / 87 tests; v22 audits all 30 edges for both v20 and v21 corrupt starts, clean v1/v2/v16/v17/v18/v19/v20/v21 starts twice, and preserves legacy snapshots.
- FIXTURE RED: 25 failed / 16 passed. First failure was a production adapter carrying fixture evidence starting without descriptor rejection. GREEN: composition 41/41 and affected three-file suite 53/53; both contracts/core typechecks, focused lint, and diff-check passed.
- REPLAY RED: 3/3 failed because first 429 responses had no `Retry-After`. GREEN: route suite 3/3 and affected four-file suite 22/22; all three capabilities preserve `Retry-After: 86400`, exact body/status, and replay marker.

## Final matrix

- `npm test`: exit 0; Legacy 7/7, Core 54 files / 448 tests, Web 21 files / 246 tests, Contracts 7 files / 85 tests, Domain 4 files / 11 tests.
- `npm run typecheck`: exit 0; Core, Web, Contracts, and Domain passed.
- `npm run lint`: exit 0; 0 errors and four unchanged warnings in `v0.5-recovery-sweeper.test.ts`.
- `npm run build`: exit 0; Next 16.3.0 compiled/typechecked and generated 6/6 static pages. The tracked `next-env.d.ts` was restored to its pre-build content.
- focused v0.7 E2E: exit 0; 1/1 passed, test 24.4 s / total 27.7 s, desktop and iPhone.
- `934ae77 docs(review): normalize v0.7 rereview whitespace` removed only two trailing spaces from the historical FAIL review date line; the verdict and review content remain unchanged.
- `git diff --check 37982d8..HEAD`: exit 0, no output.
- `git diff --check 785b7b6..HEAD`: exit 0, no output.
- Matrix-end status contains only these four handoff documents before their evidence commit.

## Sol escalation decision

The local engineering matrix is green, but v0.7 cannot close because the final adversarial release gate is FAIL. The three-cycle doubt-driven limit has been reached, so no fourth implementation cycle starts automatically.

If the Owner authorizes one bounded exception repair, freeze it to `V07-LINEAGE-015` only: on an existing nutrition source key, compare the full immutable descriptor including redistribution, license decision, adapter and evidence fields; fail the transaction before snapshots/revisions/Meal state advance when any field differs. Add one two-valid-descriptor collision regression proving controlled failure, zero partial persistence and no confirmable Meal. Retain all P2 debt and do not change the public product scope.
