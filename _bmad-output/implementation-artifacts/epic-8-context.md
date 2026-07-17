# Epic 8 Context: Multi-user Readiness

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The app ships single-tenant on purpose: one hard-coded allowlist email, one PSN region, one PS+ flag per shared game row, one user in the cron. Every one of those is correct today and wrong the moment a second user exists. This epic is the home of that latent-breakage list (the live blocker table B1a–B6 in `publication-blockers.md`) and turns each blocker into a story: real registration replacing the single-email gate, per-user PS+ facts (region + catalog membership), a scheduled refresh that fans out per *region* (not per user), and a data-hygiene backfill. Reworked 2026-07-17 after free-tier capacity research: the binding limit is D1 rows read (5M/day), not Worker requests; per-user scheduled checks would cap the app at ~100 users/day on the write budget, so the refresh is per-region and shared, and a new hardening story (8.6) lifts the DAU ceiling from ~550 toward ~6,600. Status is post-v1.0.0 and demand-driven — nothing gated is picked up until a second user is actually wanted. Exceptions: Stories 8.1 (Google sign-in) and 8.6 (read-budget hardening) are single-tenant-safe and pullable into v1.x at any time.

## Stories

- Story 8.0: Foundation — auth model & data-scoping design gate
- Story 8.1: Sign in with Google (B1a)
- Story 8.2: Real users can register (B1b)
- Story 8.3: Per-user PS+ facts — region and catalog flag (B2 + B3)
- Story 8.4: The scheduled refresh serves every region (B4; B5 retired by Epic 11)
- Story 8.5: Backfill legacy `owned_via` rows (B6)
- Story 8.6: Free-tier read-budget hardening

## Requirements & Constraints

- **Auth**: magic link is the v1 path in; Google OAuth is added *alongside* it, never replacing it. Under 8.1 the single-email allowlist gate still applies to the OAuth callback; dropping that gate is a separate, deliberate decision (8.2).
- **Admission covers every door**: the rule that replaces the allowlist must gate OAuth account *linking* too (better-auth links a Google identity into an existing user by email without the create hook running), and a de-admitted user with a live session cookie must land on login with their session rows revoked — not a shell where every data route 401s. Auth endpoints get rate-limited once strangers can reach them (unfinished OAuth sign-ins leave residue rows).
- **Multi-user scope, not a tenancy platform**: user data is user-scoped, but no sharing, no roles. Server-side enforcement — cross-user or unauthenticated tracking requests are refused at the API, not hidden by the UI.
- **Free-tier budgets are hard numbers**: 5M D1 rows read/day, 100k rows written/day, 100k Worker requests/day, 50 subrequests/invocation. D1 bills rows *scanned*, and indexed writes bill double. Whole-library scans cost ~1,500 rows/hit; a full ~490-row snapshot write costs ~1,000 rows. Any cron fan-out chunks to stay inside the budgets 8.0 names.
- **Refresh failures are passive**: no attention banners — users have no action to take. Staleness surfaces via the existing catalog as-of timestamp plus an "updating…" notice; failure detail goes to Worker logs. Recovery is automatic. (The PRD's refresh/staleness requirements carry amendment footnotes to this effect.)
- **In multi-user, the manual PS+ check button is removed** — snapshot writes come only from the cron and the sign-in stale-snapshot guard. Single-user keeps its button until 8.4 lands.
- **Secrets** (Google client secret) live in Worker secrets, never in `wrangler.jsonc` or the repo.
- **Migrations preserve data**: the existing user's global flag and region carry over losslessly; the `owned_via` backfill touches no user-entered data (status, milestones, dates) and records every resolve-vs-accept-unknown choice.

## Technical Decisions

- **Shared-vs-per-user attribute split** is the spine rule this epic honours: shared `GAME` facts vs per-user `GAME_TRACKING` state, with the PS+ catalog snapshot a third class — a per-region fetched dataset owned by neither. The global `ps_plus_extra` column and global env region violate the split once N > 1 and are 8.3's migration targets.
- **Per-user PS+ answers are derivations, never copies**: user's region joined against the shared region-scoped catalog snapshot — no per-user catalog rows. Writer split (AD-30): the check and the scheduled refresh write the per-region snapshot + departure ledger; the shipped cancel-PS+ un-claim mutates only per-user tracking (`owned`/`owned_via`) and touches no shared flag post-8.3. Epic 10's departure columns (`ps_plus_left_on`, `ps_plus_leaving_on`, `psn_concept_id`) follow the same per-region shape; 8.0's gate scopes them alongside the flag.
- **Per-region shared refresh** (post-Epic 11 the catalog fetch is anonymous — no per-user credentials exist): cron fans out over the distinct regions of registered users, one fetch + one shared snapshot per region. Writes scale with active regions, killing the write cliff.
- **Recovery is a retry ledger, not a DLQ**: a region-state row (`last_success`, `last_attempt`, `failure_count`, cycle-complete) per region; each cron fire retries failed/stale regions first; skips regions idle 60 days or already cycle-complete this rotation. A sign-in against a snapshot >35 days old triggers a `waitUntil` refresh — one rule covering region revival, a fully failed month, and a new region's first user.
- **Read-budget fixes (8.6)**: single-row `WHERE id = ?` for game-by-id (currently loads the whole library), SQL `COUNT(*)` for settings counts, `LIMIT/OFFSET` paging for the catalog route, diff-based snapshot upserts (write only changed rows), per-user library-version ETag for 304s on unchanged shelf refetches, per-active-region version-keyed catalog caching, and optionally better-auth `session.cookieCache` to drop the per-request session read.
- **Story 8.0 is a design gate, not runtime code** — its "done" is a signed-off spine update covering the auth model (registration vs invite, what replaces the single-email check), the scoping target of each global fact, the per-run budgets, the exact region-skip conditions, and paged-vs-whole catalog delivery to the FE. No multi-user code merges before it.

## UX & Interaction Patterns

- Sign-in screen shows the Google button and the magic-link form together, styled with the existing token system — no new palette. Rejected sign-ins state the rejection plainly, never a blank login screen.
- Per-user PSN region gets an editor in the existing settings surface, ideally seeded from PSN on first sync.
- While a `waitUntil` refresh is in flight, a "PS+ catalog updating…" notice sits beside the catalog as-of timestamp. No failure banners anywhere in this epic.

## Cross-Story Dependencies

- **8.0 gates 8.2 → 8.3 → 8.4 → 8.5**, in that order. 8.2 gates everything below it: nothing else matters until a second user exists.
- **8.1 and 8.6 sit outside the ordering and the gate** — no schema migration, single-tenant-safe, pullable into v1.x independently. When the epic activates, 8.6 runs before or parallel to 8.2. 8.6's diff-based upsert helps even before 8.4's per-region model.
- 8.3 must land before 8.4 (the cron fans out over per-user regions; the per-user flag derives from the region-scoped snapshot 8.4 maintains). 8.5 is last and lowest priority — hygiene, not a correctness gate.
- Several 8.0 decisions are consumed downstream: budgets and chunking by 8.4, catalog delivery shape by 8.6's caching, skip conditions by 8.4.
