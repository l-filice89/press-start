# Epic 8 Context: Multi-user Readiness

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The app ships single-tenant on purpose: one hard-coded allowlist email, one PSN region, one PS+ flag per shared game row, one user in the cron. Every one of those is correct today and wrong the moment a second user exists. This epic is the home of that latent-breakage list (the live blocker table B1a–B6) and turns each blocker into a story: real registration replacing the single-email gate, per-user PS+ facts (region + catalog membership), a scheduled refresh that fans out over all users, and a data-hygiene backfill. Status is post-v1.0.0 and demand-driven — nothing here is picked up until a second user is actually wanted, and no plumbing is front-loaded. The exception is Story 8.1 (Google sign-in), which is single-tenant-safe and pullable into v1.x at any time.

## Stories

- Story 8.0: Foundation — auth model & data-scoping design gate
- Story 8.1: Sign in with Google (B1a)
- Story 8.2: Real users can register (B1b)
- Story 8.3: Per-user PS+ facts — region and catalog flag (B2 + B3)
- Story 8.4: The scheduled refresh serves every user (B4 + B5)
- Story 8.5: Backfill legacy `owned_via` rows (B6)

## Requirements & Constraints

- **Auth**: magic link is the v1 path in; Google OAuth is added *alongside* it, never replacing it. Under 8.1 the single-email allowlist gate still applies to the OAuth callback; dropping that gate is a separate, deliberate decision (8.2).
- **Multi-user scope, not a tenancy platform**: all user-entered tracking data is user-scoped from day one, but no sharing, no roles, no tenant isolation is built. The door is left unwelded — nothing more.
- **Server-side enforcement**: cross-user or unauthenticated requests to any tracking read/write path are refused at the API, not hidden by the UI.
- **Free-tier hosting is a hard constraint**, including the scheduled PS+ job. Any all-users fan-out must fit the subrequest budget per invocation or chunk.
- **Failures surface, never silently retry**: a rejected OAuth sign-in is stated plainly; one user's failed refresh (expired cookie, unset region) must not poison the run and must surface to *that* user on next app open.
- **Secrets** (Google client secret, PSN creds) live in Worker secrets, never in `wrangler.jsonc` or the repo.
- **Migrations preserve data**: existing single-user global facts (PS+ flag, region) carry onto the existing user; the `owned_via` backfill touches no user-entered data (status, milestones, dates).

## Technical Decisions

- **Shared-vs-per-user attribute split** is the spine rule this epic exists to honour: the shared `GAME` row holds catalog identity and fetched facts (title, cover, store URL, release date, PS+ Extra catalog membership *per region*); `GAME_TRACKING` — primary key `(user_id, game_id)` — holds per-user mutable state (play status, milestones/lifecycle dates, owned, ownership type). The current global `ps_plus_extra` column on `GAME` and the global env-level PSN region violate this once N > 1 and are the migration targets of 8.3.
- **Region is stored, PS+ Extra is per-region.** Both the manual and cron PS+ checks must read the same stored region; a global flag cannot represent two regions at once. Region should ideally be derived and persisted from PSN on first sync, with a settings editor.
- **All external I/O stays behind provider ports** (`PsnProvider`); the PSN auth mechanism (the `pdccws_p` cookie, read fresh per call from the settings table) stays a provider internal.
- **Persistence only through repositories**; migrations are generated from the TS schema and applied from CI before deploy, never at Worker startup.
- **Chunking**: any fan-out that cannot fit a single invocation runs chunked or out-of-band. 8.0 must name the per-run subrequest budget and the chunking strategy before 8.4 is coded.
- **Story 8.0 is a design gate, not runtime code** — its "done" is a signed-off architecture-spine update covering the auth model (registration vs invite, what replaces the single-email check) and the scoping target for each global fact. No multi-user code merges before it.

## UX & Interaction Patterns

- Sign-in screen shows the Google button and the magic-link form together, styled with the existing token system — no new palette (reuse the existing settings/login composition).
- Per-user PSN region gets an editor in the existing Settings surface (FAB → gear, alongside session cookie and handedness).
- A failed scheduled refresh routes through the existing persistent attention banner, per-user.

## Cross-Story Dependencies

- **8.0 gates 8.2 → 8.3 → 8.4 → 8.5**, in that order. 8.2 gates everything below it: nothing else matters until a second user exists.
- **8.1 sits outside the ordering** — no schema migration, gate unchanged, pullable into v1.x independently. It does not wait on 8.0.
- 8.3 must land before 8.4 (the cron needs a per-user region and per-user flag to fan out over). 8.5 is last and lowest priority — hygiene, not a correctness gate.
- Story 8.1 builds on the existing better-auth magic-link config; 8.3/8.4 build on the existing per-user PSN cookie already stored in settings.
