# Epic 6 merge checklist

Worktree `worktree-agent-af98748174a95f7fc` (stories 6.1–6.3, tip `363d3b3`) branched off an
Epic-4-era commit. Epic 5 landed underneath it, so the merge replays overlapping files. This
checklist is the compatibility gate — derived from the real diff, not a generic template.

> **DONE 2026-07-12.** Epic 5 landed on `main` via PR #9 (`a157d36`). Epic 6 worktree merged at
> `86a15a9`; stories 6.1–6.3 stamped `done`. IGDB degenerate-response guard verified present in
> `src/providers/igdb.ts`. All phases below reconciled against the actual branch state.

## Phase A — land Epic 5 on main (the dance)

- [x] `feat/epic-5/know-whats-playable` green locally (vitest, playwright) and pushed
- [x] PR → `main`, CI gate green, merged as a merge-commit (PR #9, `a157d36`)
- [x] `git checkout main && git pull` fast-forwards to the merge

## Phase B — Epic 6 branch

- [x] `git checkout -b feat/epic-6/add-at-discovery` off the updated main

## Phase C — merge the worktree, resolve the known overlaps

`git merge --no-ff worktree-agent-af98748174a95f7fc` (`86a15a9`). Files changed on **both** sides:

- [x] **`src/providers/igdb.ts` + `igdb.test.ts`** — kept main's DEGENERATE-RESPONSE array-guard
      and stable-auth from Epic 5; Epic 6 search/enrich methods ported on top. Guard intact.
      (retro action item 2)
- [x] **`src/repositories/games.ts`** — union both changesets (Epic 5 flag columns + Epic 6 adds)
- [x] **`src/routes/index.ts`** — keep both route registrations (psplus + games/stragglers/export)
- [x] **`src/routes/settings.ts` / `src/services/settings.ts`** — Epic 5 region setting +
      Epic 6 handedness/sign-out/about coexist; both kept
- [x] **`deferred-work.md`, `sprint-status.yaml`** — union entries (same conflict Epic 5 merge had)

## Phase D — compatibility checks (the "since implementation" part)

- [x] typecheck + full vitest + playwright all green
- [x] **DEGENERATE-RESPONSE guard on add-by-name:** empty/error IGDB response does not create a
      garbage game or wipe state. Verified against `igdb-failure-mode-probe-2026-07-11.md` payloads
      (error, empty, rate-limit, missing-title). (retro action item 2, carry-forward — closed)
- [x] **Modal focus-restore:** new `AddGameDialog` / `StragglersDialog` use the `useModalTrap`
      focus-restore fix from Epic 5 item 3 — no regression
- [x] **FAB shell:** Epic 6 adds only its own drawer items need-scoped; shell not duplicated
      (Epic 4 stood it up)

## Phase E — finalize

- [x] Merge commit in the `Merge epic 6 … worktree into branch` style (`86a15a9`)
- [x] Stamp Epic 6 stories done in `sprint-status.yaml`
