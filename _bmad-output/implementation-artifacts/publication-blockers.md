# Publication Blockers — single-user → multi-user

Things that are correct while `AUTH_ALLOWED_EMAIL` is one address but **break the moment a second user exists**. The app deliberately ships single-tenant (FR-48 "the app is mine today"); this doc is the gate to clear before opening it to other users. Each entry names the code and the fix. Cross-referenced from `deferred-work.md`.

Status: none resolved — all latent by design.

| # | Blocker | Where | Fix |
|---|---------|-------|-----|
| B1 | **Auth allowlist is one email** — only `AUTH_ALLOWED_EMAIL` can sign in; there is no registration. | `src/services/auth.ts:34` (`isAllowedEmail`) | Real multi-user auth: registration/invite, drop the single-email gate (or make it a list). Gates everything below. |
| B2 | **`ps_plus_extra` is a global column on the shared `game` row**, but the PS+ check sets/clears it from ONE user's ownership. User B's flag write lands on user A's shared row. | `src/services/psplus.ts` → `setPsPlusExtraFlags` (writes `game.psPlusExtra`); `src/schema/catalog.ts` | Per-user flag: move membership to a user-scoped table or derive per-user. Same shape as region (B3). |
| B3 | **PSN region is a single global `env.PSN_REGION`** (`it-it`), seeded into every user's SETTING; no per-user region, no UI. A user in another region gets the wrong catalog — and a global `ps_plus_extra` can't represent two regions at once. | `src/services/settings.ts` `getPsnRegion`; `wrangler.jsonc` `PSN_REGION` | Per-user region setting + editor, ideally derived from PSN on first sync. Ties to B2 (both are "global fact that must become per-user"). |
| B4 | **Scheduled cron refreshes only THE allowlist user** — resolves one user by `AUTH_ALLOWED_EMAIL`. | `src/services/psplus.ts:140` (`runScheduledPsPlusCheck`) | Loop over all users (per-user region + cookie); mind the free-tier subrequest budget as user count grows. |
| B5 | **PSN cookie is per-user in SETTING but the whole sync/PS+ flow assumes one PSN account.** Works per-user via SETTING today; the cron (B4) only reads one. | `getPsnCookie` (`src/services/settings.ts`) | Falls out of B4 — each user supplies their own `pdccws_p`. |
| B6 | **`owned_via = NULL` legacy dev rows** — pre-FR-9 rows have no acquisition source. Data hygiene, not a correctness gate. | `game_tracking.owned_via` | Backfill or accept NULL as "unknown"; low priority. |

**Order:** B1 first (nothing else matters until real users exist), then B2+B3 together (the global-fact-must-be-per-user pair), then B4/B5, then B6. B2/B3 are also in `deferred-work.md`.
