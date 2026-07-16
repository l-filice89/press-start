# Publication Blockers — single-user → multi-user

Things that are correct while `AUTH_ALLOWED_EMAIL` is one address but **break the moment a second user exists**. The app deliberately ships single-tenant (FR-48 "the app is mine today"); this doc is the gate to clear before opening it to other users. Each entry names the code and the fix. Cross-referenced from `deferred-work.md`.

**Owned by Epic 8 (Multi-user Readiness — post-v1.0.0, demand-driven)** in `epics.md`; this table stays the live source of *what breaks and where*, and as of 2026-07-13 each blocker has a story with acceptance criteria in `epics.md`:

| Blocker | Story |
|---|---|
| — | **8.0** — auth-model + data-scoping design gate (gates 8.2 onward, **not** 8.1) |
| B1a | **8.1** — Sign in with Google |
| B1b | **8.2** — Real users can register |
| B2 + B3 | **8.3** — Per-user PS+ facts (region + catalog flag; one story) |
| B4 + B5 | **8.4** — The scheduled refresh serves every user |
| B6 | **8.5** — Backfill legacy `owned_via` rows |

Status: none resolved — B1b–B6 are latent by design; B1a is a v1.x feature not yet built.

| # | Blocker | Where | Fix |
|---|---------|-------|-----|
| B1a | **No Google sign-in** — magic link is the only path in (FR-47). | `src/services/auth.ts` (better-auth config) | Add Google to better-auth alongside magic link; the `AUTH_ALLOWED_EMAIL` gate stays and applies to the callback. Single-tenant-safe → **pullable into v1.x ahead of this epic**; independent of the B1b→B6 ordering. |
| B1b | **Auth allowlist is one email** — only `AUTH_ALLOWED_EMAIL` can sign in; there is no registration. | `src/services/auth.ts:34` (`isAllowedEmail`) | Real multi-user auth: registration/invite, drop the single-email gate (or make it a list). Gates everything below. |
| B2 | **`ps_plus_extra` is a global column on the shared `game` row**, but the PS+ check sets/clears it from ONE user's ownership. User B's flag write lands on user A's shared row. | `src/services/psplus.ts` → `setPsPlusExtraFlags` (writes `game.psPlusExtra`); `src/schema/catalog.ts` | Per-user flag: move membership to a user-scoped table or derive per-user. Same shape as region (B3). |
| B3 | **PSN region is a single global `env.PSN_REGION`** (`it-it`), seeded into every user's SETTING; no per-user region, no UI. A user in another region gets the wrong catalog — and a global `ps_plus_extra` can't represent two regions at once. | `src/services/settings.ts` `getPsnRegion`; `wrangler.jsonc` `PSN_REGION` | Per-user region setting + editor, ideally derived from PSN on first sync. Ties to B2 (both are "global fact that must become per-user"). |
| B4 | **Scheduled cron refreshes only THE allowlist user** — resolves one user by `AUTH_ALLOWED_EMAIL`. | `src/services/psplus.ts:140` (`runScheduledPsPlusCheck`) | Loop over all users (per-user region + cookie); mind the free-tier subrequest budget as user count grows. |
| B5 | **PSN cookie is per-user in SETTING but the whole sync/PS+ flow assumes one PSN account.** Works per-user via SETTING today; the cron (B4) only reads one. | `getPsnCookie` (`src/services/settings.ts`) | Falls out of B4 — each user supplies their own `pdccws_p`. |
| B6 | **`owned_via = NULL` legacy dev rows** — pre-FR-9 rows have no acquisition source. Data hygiene, not a correctness gate. | `game_tracking.owned_via` | Backfill or accept NULL as "unknown"; low priority. |

**Order:** B1b first (nothing else matters until real users exist), then B2+B3 together (the global-fact-must-be-per-user pair), then B4/B5, then B6. **B1a sits outside this ordering** — it is a v1.x feature that happens to live in this epic, not a blocker for anything below it. B2/B3 are also in `deferred-work.md`.

**Epic 10 additions to B2's inventory (2026-07-16 retro):** the global-game-fact set B2/B3 must move grew — `game.ps_plus_left_on` (10.2) and `game.ps_plus_leaving_on` + `psn_concept_id` (10.4) are written by the leaving sweep from ONE user's region, exactly the `ps_plus_extra` shape. `critic_score`/`user_score`/`ttb_*` (10.1/10.3) are region-independent shared facts and stay on `game`. Story 8.0's design gate must scope all three departure columns alongside the flag.
