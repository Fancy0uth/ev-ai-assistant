# v0.7 Sol P1 remediation handoff

Date: 2026-08-31 Asia/Shanghai
Remediation base: `d9da50d`
Committed HEAD: `d728936`

## Current state

The first Sol review remains an immutable FAIL record at `docs/reviews/2026-08-31-v0.7-sol-review.md`. All nine P1 findings were fixed by the same Terra agent with TDD and local atomic commits. The required `V07-REPORT-012` diff-gate repair was also committed. `V07-CONTRACT-010` and `V07-BROWSER-011` remain intentionally unfixed P2 items.

The first final `npm test` attempt failed in Core with 12 failed / 338 passed because additive v21 owner triggers exposed a valid initial parent/revision cycle and three current-migration expectations still named v20. Commit `d728936` changed only the transaction order and the three current-version expectations. Its focused rerun passed 23/23. The complete final matrix was then rerun and passed.

## Final committed remediation chain

- `767b118 fix(v0.7): enforce owner and fixture boundaries`
- `274ff1c fix(v0.7): make health commands crash-safe`
- `40d517d fix(v0.7): harden health provider boundaries`
- `8767f52 fix(v0.7): enforce decimal range invariants`
- `0633fc8 fix(v0.7): enforce owner-safe additive migrations`
- `7b47190 fix(v0.7): preserve synthetic health evidence`
- `eefd3bc docs(v0.7): repair execution report gate`
- `d728936 fix(v0.7): link initial revisions transactionally`

## Final gate state

- `npm test`: exit 0; Legacy 7/7, Core 350/350, Web 246/246, Contracts 85/85, Domain 11/11.
- `npm run typecheck`: exit 0; all four workspaces.
- `npm run lint`: exit 0; 0 errors and four unchanged v0.5 warnings.
- `npm run build`: exit 0; tracked `apps/web/next-env.d.ts` was restored after build.
- focused v0.7 E2E: exit 0; 1/1 passed, desktop and iPhone.
- both requested range diff-checks: exit 0.
- matrix-end `git status --short`: empty before this handoff update.

## Main Agent handoff

Review the eight remediation commits and these four uncommitted state documents. Do not treat the synthetic evidence as real-provider evidence. No Sol rereview, push, tag, release, deployment, installation, network, credentials, personal data, or external dataset operation was run.
