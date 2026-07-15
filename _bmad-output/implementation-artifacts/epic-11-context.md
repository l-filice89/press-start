# Epic 11 Context: PSN Account Safety — Sanitize the Credentialed Surface

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Remove every code path that puts Luca's PSN credential (NPSSO token) on the wire, so his real account can never again be the actor in a reverse-engineered PlayStation call — the account was locked once (2026-07-15) immediately after credentialed calls. The credentialed flow impersonates the PSN Android app against undocumented endpoints (a ToS breach with documented ban risk), while the only unattended PSN traffic — the monthly PS+ catalog cron — is fully anonymous and cannot trip an account lock. This epic deletes the entire credentialed surface (library sync, trophy sync, platinum backfill, NPSSO auth machinery, trophy display) and keeps everything carrying no account identity: the anonymous PS+ Extra catalog (check + monthly cron), manual add-by-name, and manual milestone tracking. HIGH PRIORITY, sequenced first — ahead of Epics 8 and 10. Supersedes Epic 4 and the credentialed half of Epic 9; PS+ awareness (Epics 5/7) untouched.

## Stories

- Story 11.1: Sever the credentialed PSN operations
- Story 11.2: Strip PSN credential auth from the provider and settings
- Story 11.3: Remove the trophy display and schema

## Requirements & Constraints

- This is a removal epic: forward-only excision, not a git rollback (reverting Epics 4/9 would tear out shared infra the catalog features still use). Deletion + schema migration + UI trims; add no new behavior.
- Success criteria for the whole epic:
  - Grep proves no `fetchPurchasedGames` / `fetchTrophyTitles` / NPSSO / bearer-exchange code remains.
  - App builds and runs; anonymous PS+ catalog check, monthly cron, and CSV export still pass their suites.
  - Manual add-by-name and manual milestone (platinum/completion) flows are byte-for-byte unchanged.
  - A migration cleanly drops the `trophy_*` columns and the `psn_npsso` / `psn_auth` settings rows.
  - Full unit suite + e2e green (minus deliberately deleted suites).
- The removed credentialed routes (`POST /sync`, `/sync/trophies`, `/backfill/platinum-dates`) must 404 after removal.
- Test scope: delete the credentialed provider/route/service suites and `playwright/e2e/epic9-trophies.spec.ts`; keep all anonymous catalog suites.
- Library-sync FRs are rescinded, not re-implemented: new purchases enter via the existing manual add-by-name flow; ownership fields are now seed- or manually-set only. Do not add any replacement sync.
- A recent `login_required` provider fix in `src/providers/psn.ts` is subsumed by Story 11.2's deletion of that code path.

## Technical Decisions

- `PsnProvider` seam narrows to anonymous store-browse only: keep the PS+ Extra catalog fetch (sends only `accept`/`content-type`/`x-psn-store-locale-override` — no cookie, no bearer). Remove `exchange`/`getBearer`, `getNpsso` plumbing, `fetchPurchasedGames`, `fetchTrophyTitles`, and the credentialed `PsnAuthError` paths.
- Single-flight PSN lock stays, but its `PsnOp` set reduces to `catalog-refresh` only; delete the lock ops that existed solely for credentialed work.
- Settings cleanup: remove the NPSSO field, the expired-token banner (`markPsnAuthExpired`, `psn_auth` setting), and the Settings backfill panel.
- Schema migration drops: `trophy_earned_*`, `trophy_defined_*`, `trophy_np_comm_id`, `trophy_np_service_name` columns, and the `psn_npsso` / `psn_auth` setting rows. Must NOT touch `platinum_on`, `completed_on`, `owned_via`, `bought_on` (the manual milestone and manual purchased-vs-claimed ownership models).
- Migrations run from CI, never at deploy: drizzle-kit generates versioned SQL; `wrangler d1 migrations apply` runs in CI before the Worker deploy. A column-dropping migration is the "destructive" case the CI manual-approval gate exists for.
- Retire the Wrangler `PSN_NPSSO` secret from the deploy pipeline.
- Delete `core/trophy.ts` and its tests; delete `services/sync.ts`, `services/trophies.ts`, `services/backfill.ts`.

## UX & Interaction Patterns

- FAB drawer loses "Sync library" and "Sync trophies"; it keeps exactly "Check PS+ Extra" and "Export CSV". Delete both readout modals (`SyncSummaryModal`, `TrophySyncModal`).
- `Card.tsx` and `DetailPanel.tsx` lose the trophy %/grade/tier readout entirely.
- Manual milestone entry in the detail view (platinum / story-completion dates) must record and display exactly as before.
- Settings page: no NPSSO token field, no expired-token banner, no backfill panel.

## Cross-Story Dependencies

- Order is 11.1 → 11.2 → 11.3. 11.2 depends on 11.1 having removed the callers of the credentialed provider methods; 11.3 is independent but sequenced last for a clean single migration.
- 11.2's lock trim must not break Epics 5/7: the monthly catalog cron and the PS+ check still run under the single-flight lock (`catalog-refresh`).
- 11.3 must preserve Epic 2's manual milestone flow and Epic 6.4's `owned_via`/`bought_on` ownership model.
- Future revival note (out of scope): if trophies ever return, the only sanctioned path is a dedicated burner account reading the public profile — never the main account's credential.
