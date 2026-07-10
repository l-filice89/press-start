# Epic 3 Follow-up Retrospective — Stories 3.5 & 3.6 (post-retro addendum)

Date: 2026-07-10 · Facilitator: Amelia (Developer) · Participants: Luca (Project Lead), Alice (PO), Charlie (Senior Dev), Dana (QA), Elena (Junior Dev)

Scope: the two stories spawned by the morning's Epic 3 retro (`epic-3-retro-2026-07-10.md`) — 3.5 (reveal-pill exclusive mode, c78e6ce) and 3.6 (write-path hardening pre-sync, a3afc85). Both shipped the same day the retro assigned them. Epic 3 closes at 6/6.

## Delivery

| Metric | 3.5 | 3.6 |
|--------|-----|-----|
| Review findings | 0 high; 7 patches (4 med), 1 defer, 10 rejects | 0 high; 6 patches (1 med), 0 defer, 7 rejects |
| Tests after | Vitest 547, Playwright 49/49 ×2 | Vitest 551, Playwright 49/49 ×3 (retry loop deleted) |
| Deferred ledger | 3 closed; DW-9 + Escape-greedy defer added | 3 closed |

## Morning-retro action-item follow-through (5 items + critical path)

| Item | Status |
|------|--------|
| 1. Story 3.5 — exclusive reveal semantics, FR-4/20/21 amended, e2e rewritten | ✅ done |
| 2. Invalidate `['shelf-search']` on all writes | ✅ done — one `invalidateShelfQueries()` helper, 6 sites incl. 409 paths |
| 3. Latest-write token for stale UNDO | ✅ done — per-game `WRITE_GEN` + "Undo expired" toast (NFR-4) |
| 4. Shared modal focus-trap ×3 consumers | ✅ done — `web/components/useModalTrap.ts` |
| 5. Status-popover hoist + `openStatusMenu` retry-loop removal | ✅ done — see finding below |
| Critical path: merge `feat/epic-3/filter-focus-backlog` to main | Executed at close of this retro (PR through CI OK gate, CD watched) |

## What went well

- **Five-for-five same-day follow-through.** The morning retro's entire action list closed before end of day — the retro→triage→spec→ship loop is tight enough that "before Epic 4 kickoff" deadlines resolve in hours.
- **3.6's Block-If condition fired and was handled right.** Removing the retry loop still flaked; instead of re-papering, trace analysis found a *second* race the loop had silently absorbed (pill click vs refetch re-chunk commit). Fix was a deterministic networkidle quiescence gate, not a retry — a masked product regression would still fail.
- **Morning Significant Discovery fully absorbed:** code, copy ("Show only X games"), FRs, summary sentence, and e2e all agree on the exclusive reveal contract; the superseded additive path was deleted, not flagged off.
- Review quality held at zero-high with meaningful medium catches (untested headline-fallback path, handoff arming proxy, missing stale-id cleanup on the popover hoist).

## Key finding — retry loops are bug amnesties

The `openStatusMenu` retry loop had masked **two distinct bugs** across its lifetime: the Card-remount menu death (the known one) and the click-vs-refetch race (discovered only when the loop died). The suite now contains zero retry loops, and the full parallel run went green 3× consecutively without one. Standing posture: a retry loop in a test helper is a deferred-work entry, never a fix.

## Watch items

- **DW-9:** epic1 1.7c (infinite-scroll sentinel timing) flaked once under heavy parallel machine load, plus one broad 13-test contention wobble. Ledgered watch-only — loadAllPages-style mitigation if it recurs. Last known flake candidate in the suite.
- **Escape-greedy trap convention** (deferred in 3.5 review): `useModalTrap`'s document-capture Escape dismisses the whole modal; becomes real the first time a modal gains an Escape-owning inner popup without wiring `enabled`.

## Epic 4 readiness — updated

Both pre-4.2 hazards from the morning retro are closed (search staleness, stale UNDO), and the popover survives refetch re-chunks — sync's automated writes land on a hardened write path. All Epic 4 prerequisites from the morning retro remain in place (SETTING table, append-only guard, normalizer, EXTERNAL_LINK, attention banner, documented GraphQL query). **Nothing blocks story 4.1 or 4.2.**

## Action items

None new. The single open critical-path item (branch merge) is executed at the close of this retro; Epic 4 branch created immediately after.

## Key takeaways

1. Same-day retro follow-through works — assign stories in the retro, ship them before the merge gate, and the epic closes with zero carried debt.
2. A test-helper retry loop is a bug amnesty: it masked two independent races. Delete on sight, diagnose what falls out.
3. Block-If clauses in specs earn their keep — 3.6's fired, forced a real diagnosis, and produced a deterministic fix instead of a re-paper.
