# Epic 9 Context: The PSN Record — Trophies

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 4 filled the library from PlayStation; this epic brings across the **record** — per-game trophy progress (completion % plus a PSNProfiles-style letter grade) and a one-off backfill that recovers platinum/completion dates PSN knows and the app never captured. The opening spike proved the app's current credential can't get there: the `pdccws_p` session cookie is rejected (401) by the trophy host, while an **NPSSO bearer** serves trophies *and* the existing library sync — a superset. So the epic runs on a full cookie→NPSSO swap that gates all trophy work. A second spike closed the wishlist question: its read is server-side-rendered, reachable under neither credential from a server-to-server position, so the wishlist story is dropped to Future. The epic closes with a hardening sweep that clears the retro-triaged traps before merge. Nothing here changes the state model; all PSN I/O stays behind `PsnProvider`.

## Stories

- Story 9.1: Spike S-1 — what does `pdccws_p` authorize? (**done**)
- Story 9.1b: Swap `PsnProvider` from the `pdccws_p` cookie to an NPSSO bearer (**done**)
- Story 9.1c: Final wishlist spike — capture the `storeRetrieveWishlist` hash (**done**; verdict: unreachable)
- Story 9.2: Trophy progress on every game (**done**)
- Story 9.3: One-off backfill — recover the platinum dates PSN knows (**done**)
- Story 9.4: Sync the PS Store wishlist — **DROPPED TO FUTURE** (not reachable under either credential)
- Story 9.5: Post-retro hardening sweep — the merge gate

Sequence: 9.1 → 9.1b → 9.2 → 9.3 → 9.1c → **9.5 (remaining work; gates the merge to main)**.

## Requirements & Constraints

- **Auth is a stored PlayStation credential, editable from the UI.** On auth failure the app surfaces refresh instructions and **stops — never silently retries**. The credential is the NPSSO token (~60-day life); the short-lived (~1h) access token refreshes silently from the offline refresh token, and only a fully-expired/invalid NPSSO raises the alarm (reusing the existing `psn_auth: 'expired'` flag, banner, and re-paste prompt — no new UI surface).
- **The swap was a replacement, not an addition** — no parallel cookie path survives.
- **Credential validation belongs at the trust boundary:** a credential that cannot be carried in an outbound header (non-Latin1 codepoints) is refused with a 400 at SAVE time, never as a 502 at sync time.
- **Sync is append-only to user data.** No sync path writes play status, milestones, dates, or genres on an existing game; it may only create games and flip `Owned` false→true.
- **Lifecycle/milestone dates are write-once through automatic flows** — the first value stands. The 9.3 backfill only ever fills nulls (idempotent by construction) and is the single deliberate exception where a sync writes a milestone; its `completed_on = platinum_on` inference is a documented **backfill-only heuristic**, explicitly not the rule for games synced going forward.
- **Nothing external on render.** Trophy counts are fetched at sync time and persisted; no page render hits PSN.
- **Free-tier budget is hard:** 50 external subrequests per Worker invocation. A ~175-game trophy fan-out does not fit — it chunks or runs out-of-band, as does the backfill (never a blocking request).
- **Long PSN operations are single-flight per user.** Library sync, trophy sync, and the platinum backfill are each guarded; a second concurrent run is refused with a human message rather than racing (two tabs must not double the PSN fan-out or double-report the same rows).
- **Every user-triggered long op ends in a visible summary** (added / already tracked / needs attention), and anything needing action also seeds the persistent attention banner.
- **Degenerate-response guard:** a 200 carrying `errors` fails closed; existing data survives — asserted against the bearer with a captured-payload hazard test.
- **Accepted, not defects** (do not re-litigate): trophy counts are never cleared or aged — historic data, staleness is fine; there is no e2e for the FAB → trophy sync → shelf-repaint seam (PSN is unstubbable in Playwright).

## Technical Decisions

- **All PSN I/O goes through `PsnProvider`** (`providers/`). NPSSO storage, the authorize → code → access-token exchange, bearer caching and refresh live **entirely inside** that adapter. No auth detail leaks into `services/`, `routes/`, or `core/`.
- **Test doubles for the NPSSO→bearer exchange are shared, not copy-pasted per suite.** A stale exchange shape must not be able to keep two suites green while production breaks.
- **Domain core is I/O-free.** Completion % and the letter grade are pure functions over the *stored* trophy counts, computed in `core/`, with the grade bands defined in exactly one place. Derived values are never persisted as a second source of truth.
- **Persistence only through `repositories/`** (Drizzle over D1). No raw D1 in services, routes, or core. The DB type surface and every driver that implements it (including the seed-import sqlite-proxy driver) must agree, so a repository function that batches fails at COMPILE time, never at runtime.
- **Attribute ownership:** shared catalog facts live on `GAME`; per-user mutable state (play status, milestone/lifecycle dates, `owned`, ownership type) lives on `GAME_TRACKING`, keyed `(user_id, game_id)`. Trophy progress is per-user — it belongs on the tracking side. Every tracking row carries `user_id`; every query filters by it.
- **Discarded games still exist.** Library reads exclude them, so anything reconciling PSN data against the library must match discarded rows too and drop them **silently** — a discarded game is not an unmatched game.
- Migrations: `drizzle-kit generate` → `wrangler d1 migrations apply` from CI before deploy; the Worker never migrates itself.

## UX & Interaction Patterns

- **Trophy display:** completion % and grade appear on the card and detail view. A game with **no** trophy data shows **nothing** — never a fake 0%.
- **Milestone silver** (`#d6e6f5`) is the earned-completion colour; the platinum/completed milestone badge persists on the card regardless of play status. Never recolour Platinum to match a play status.
- **Settings** lives behind the FAB → gear; the NPSSO field sits there with a "Get / refresh token" control that **deep-links** (plain link, new tab) to Sony's NPSSO endpoint. CORS forbids reading it silently; do not attempt it.
- **Attention banner** (under-header, persistent, magenta for an expired credential) routes to Settings. Long ops resolve into a **summary modal**; anything needing action also seeds the banner so it survives dismissal.
- Copy is human: "PlayStation sync needs a new token — the last one expired", never "Auth error 401". Sony marks appear only as descriptive text, never as app branding.

## Cross-Story Dependencies

- 9.1b gated 9.2 (trophies unreachable without the bearer); 9.2 gated 9.3 (the backfill reads persisted trophy data). All are done.
- **9.5 is the merge gate** — it closes deferred entries left by 9.1b, 9.2, and 9.3, and touches shipped Epic 9 + Epic 4 code (single-flight guard on the library sync has been deferred since Epic 4). Full suite must run green three times consecutively.
- Spike evidence (the endpoint × auth-path table) lives in `implementation-artifacts/deferred-work.md` (DW-10); the retro triage lives in `implementation-artifacts/epic-9-retro-2026-07-14.md`.
