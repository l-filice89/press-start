# Epic 6 merge checklist

Worktree `worktree-agent-af98748174a95f7fc` (stories 6.1–6.3, tip `363d3b3`) branched off an
Epic-4-era commit. Epic 5 landed underneath it, so the merge replays overlapping files. This
checklist is the compatibility gate — derived from the real diff, not a generic template.

## Phase A — land Epic 5 on main (the dance)

- [ ] `feat/epic-5/know-whats-playable` green locally (vitest, playwright) and pushed
- [ ] PR → `main`, CI gate green, merged as a merge-commit (matches PRs #4–#8)
- [ ] `git checkout main && git pull` fast-forwards to the merge

## Phase B — Epic 6 branch

- [ ] `git checkout -b feat/epic-6/add-at-discovery` off the updated main

## Phase C — merge the worktree, resolve the known overlaps

`git merge --no-ff worktree-agent-af98748174a95f7fc`. Files changed on **both** sides:

- [ ] **`src/providers/igdb.ts` + `igdb.test.ts`** — KEEP main's DEGENERATE-RESPONSE array-guard
      and stable-auth from Epic 5; port Epic 6's new search/enrich methods on top. Do **not** let
      the worktree version clobber the guard. (retro action item 2)
- [ ] **`src/repositories/games.ts`** — union both changesets (Epic 5 flag columns + Epic 6 adds)
- [ ] **`src/routes/index.ts`** — keep both route registrations (psplus + games/stragglers/export)
- [ ] **`src/routes/settings.ts` / `src/services/settings.ts`** — Epic 5 region setting +
      Epic 6 handedness/sign-out/about coexist; keep both
- [ ] **`deferred-work.md`, `sprint-status.yaml`** — union entries (same conflict Epic 5 merge had)

## Phase D — compatibility checks (the "since implementation" part)

- [ ] typecheck + full vitest + playwright all green
- [ ] **DEGENERATE-RESPONSE guard on add-by-name:** an empty/error IGDB response must NOT create a
      garbage game or wipe state. Verify against `igdb-failure-mode-probe-2026-07-11.md` payloads
      (error, empty, rate-limit, missing-title). (retro action item 2, the carry-forward)
- [ ] **Modal focus-restore:** new `AddGameDialog` / `StragglersDialog` use the `useModalTrap`
      focus-restore fix from Epic 5 item 3 — no regression
- [ ] **FAB shell:** Epic 6 adds only its own drawer items need-scoped; shell not duplicated
      (Epic 4 stood it up)

## Phase E — finalize

- [ ] Merge commit in the `Merge epic 6 … worktree into branch` style
- [ ] Stamp Epic 6 stories done in `sprint-status.yaml`
