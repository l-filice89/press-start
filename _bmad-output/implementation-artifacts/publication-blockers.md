# Publication Blockers — single-user → multi-user

Things that are correct while `AUTH_ALLOWED_EMAIL` is one address but **break the moment a second user exists**. The app deliberately ships single-tenant (FR-48 "the app is mine today"); this doc is the gate to clear before opening it to other users. Each entry names the code and the fix. Cross-referenced from `deferred-work.md`.

**Owned by Epic 8 (Multi-user Readiness — post-v1.0.0, demand-driven)** in `epics.md`; this table stays the live source of *what breaks and where*, and as of 2026-07-13 each blocker has a story with acceptance criteria in `epics.md`:

| Blocker | Story |
|---|---|
| — | **8.0** — auth-model + data-scoping design gate (gates 8.2 onward, **not** 8.1) |
| B1a | **8.1** — Sign in with Google |
| B1b | **8.2** — Real users can register |
| B2 + B3 | **8.3** — Per-user PS+ facts (region + catalog flag; one story) |
| B4 (+ B5, retired) | **8.4** — The scheduled refresh serves every region |
| — | **8.6** — Free-tier read-budget hardening (added 2026-07-17; not a blocker — capacity headroom, single-tenant-safe like 8.1) |
| B6 | **8.5** — Backfill legacy `owned_via` rows |

Status: **ALL RESOLVED — Epic 8 complete 2026-07-17** (B5 retired 2026-07-17 by Epic 11's credential removal). Every blocker shipped on `epic/8-multi-user-readiness`; awaiting the main merge + deploy (migration 0016 gate). This doc is now a historical record.

| # | Blocker | Where | Fix |
|---|---------|-------|-----|
| B1a | **No Google sign-in** — magic link is the only path in (FR-47). | `src/services/auth.ts` (better-auth config) | Add Google to better-auth alongside magic link; the `AUTH_ALLOWED_EMAIL` gate stays and applies to the callback. Single-tenant-safe → **pullable into v1.x ahead of this epic**; independent of the B1b→B6 ordering. |
| B1b | **Auth allowlist is one email** — only `AUTH_ALLOWED_EMAIL` can sign in; there is no registration. | `src/services/auth.ts:34` (`isAllowedEmail`) | Real multi-user auth: registration/invite, drop the single-email gate (or make it a list). Gates everything below. |
| B2 | **`ps_plus_extra` is a global column on the shared `game` row**, but the PS+ check sets/clears it from ONE user's ownership. User B's flag write lands on user A's shared row. | `src/services/psplus.ts` → `setPsPlusExtraFlags` (writes `game.psPlusExtra`); `src/schema/catalog.ts` | Per-user flag: move membership to a user-scoped table or derive per-user. Same shape as region (B3). |
| B3 | **PSN region is a single global `env.PSN_REGION`** (`it-it`), seeded into every user's SETTING; no per-user region, no UI. A user in another region gets the wrong catalog — and a global `ps_plus_extra` can't represent two regions at once. | `src/services/settings.ts` `getPsnRegion`; `wrangler.jsonc` `PSN_REGION` | Per-user region setting + editor, ideally derived from PSN on first sync. Ties to B2 (both are "global fact that must become per-user"). |
| B4 | **Scheduled cron refreshes only THE allowlist user** — resolves one user by `AUTH_ALLOWED_EMAIL`. | `src/services/psplus.ts:140` (`runScheduledPsPlusCheck`) | Fan out over the **distinct regions of registered users** (anonymous fetch, shared snapshot — never per-user: per-user snapshot writes cap the app at ~100 users/day on D1's write budget). Region-state ledger + retry-failed-first; skip regions idle 60 days or cycle-complete; a sign-in against a >35-day-old snapshot triggers a `waitUntil` refresh. See story 8.4 (reworked 2026-07-17) + `sprint-change-proposal-2026-07-17-epic8-capacity.md`. |
| B5 | ~~PSN cookie is per-user in SETTING but the cron only reads one.~~ **Retired 2026-07-17:** Epic 11 removed all per-user PSN credentials — the catalog fetch is anonymous, so there is nothing per-user to fan out over. Folded into B4's per-region model. | — | — |
| B6 | **`owned_via = NULL` legacy dev rows** — pre-FR-9 rows have no acquisition source. Data hygiene, not a correctness gate. | `game_tracking.owned_via` | Backfill or accept NULL as "unknown"; low priority. |

**Order:** B1b first (nothing else matters until real users exist), then B2+B3 together (the global-fact-must-be-per-user pair), then B4 (B5 retired), then B6. **B1a sits outside this ordering** — it is a v1.x feature that happens to live in this epic, not a blocker for anything below it. B2/B3 are also in `deferred-work.md`.

**Epic 10 additions to B2's inventory (2026-07-16 retro):** the global-game-fact set B2/B3 must move grew — `game.ps_plus_left_on` (10.2) and `game.ps_plus_leaving_on` + `psn_concept_id` (10.4) are written by the leaving sweep from ONE user's region, exactly the `ps_plus_extra` shape. `critic_score`/`user_score`/`ttb_*` (10.1/10.3) are region-independent shared facts and stay on `game`. Story 8.0's design gate must scope all three departure columns alongside the flag. **2026-07-17:** the departure columns follow B4's per-region refresh shape — written once per region snapshot, derived per-user via the user's region, never per-user copies.
