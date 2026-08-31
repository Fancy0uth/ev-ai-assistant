# v0.7 third/final repair-cycle handoff

Date: 2026-08-31 Asia/Shanghai
Repair base: `caf4b83`
Committed HEAD: `346e744`
Review state: Terra repairs committed; Main Agent final matrix green; third Sol review pending

## Current state

The first Sol review remains an immutable FAIL record at `docs/reviews/2026-08-31-v0.7-sol-review.md`. The first rereview remains an immutable second FAIL record at `docs/reviews/2026-08-31-v0.7-sol-rereview.md`. The Main Agent accepted only `V07-MIG-006`, `V07-FIXTURE-008`, and `V07-REPLAY-013` for this third and final repair cycle. All three now have TDD-backed local commits.

The retained P2 findings were not changed: `V07-CONTRACT-010`, `V07-BROWSER-011`, and `V07-EVIDENCE-014`. Version remains `0.7.0`. No real Provider, network, credential, personal/health data, external dataset/license, installation, deployment, push, tag, release, or Sol review was used.

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

## Main Agent handoff

Review the three repair commits, the whitespace-only gate commit, and these four handoff documents. The complete local matrix is green. Do not treat test fixtures or preserved synthetic evidence as real-provider evidence. A fresh third Sol whole-version review is still required before v0.7 can close.
