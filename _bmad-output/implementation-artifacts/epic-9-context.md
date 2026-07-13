# Epic 9 Context: The PSN Record — Trophies (and maybe Wishlist)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 4 filled the library from PlayStation; this epic brings across the **record** — per-game trophy progress (completion % plus a PSNProfiles-style letter grade), a one-off backfill that recovers platinum/completion dates PSN knows and the app never captured, and (conditionally) the PS Store wishlist. The opening spike proved the app's current credential can't get there: the `pdccws_p` session cookie is rejected (401) by the trophy host, while an **NPSSO bearer** serves trophies *and* the existing library sync — a superset. So the epic now runs on a full cookie→NPSSO swap that gates all trophy work. The wishlist endpoint was identified but its persisted-query hash still needs a live capture, so the wishlist story stays conditional. Nothing here changes the state model; all PSN I/O stays behind `PsnProvider`.

## Stories

- Story 9.1: Spike S-1 — what does `pdccws_p` authorize? (**done 2026-07-13**; outcome in `implementation-artifacts/deferred-work.md` DW-10)
- Story 9.1b: Swap `PsnProvider` from the `pdccws_p` cookie to an NPSSO bearer — _gates 9.2_
- Story 9.1c: Final wishlist spike — capture the `storeRetrieveWishlist` hash and confirm its auth path — _gates 9.4_
- Story 9.2: Trophy progress on every game
- Story 9.3: One-off backfill — recover the platinum dates PSN knows
- Story 9.4: Sync the PS Store wishlist — _conditional on 9.1c_

Sequence: 9.1 ✓ → 9.1b → 9.2 → 9.3 → 9.1c → 9.4 (conditional).

## Requirements & Constraints

- **Auth is a stored PlayStation credential, editable from the UI.** On auth failure the app surfaces refresh instructions and **stops — never silently retries**. Post-swap the credential is the NPSSO token (~60-day life); the short-lived (~1h) access token refreshes silently from the offline refresh token, and only a fully-expired/invalid NPSSO raises the alarm.
- **The swap is a replacement, not an addition.** The NPSSO field takes the cookie's slot in Settings (same location, replaced label/help), the setting key and the seed secret move with it, and the dead cookie read path is deleted — no parallel credential, no dead weight.
- **Sync is append-only to user data.** No sync path writes play status, milestones, dates, or genres on an existing game; it may only create games and flip `Owned` false→true. A wishlist entry for an owned game changes nothing; an entry that disappears from PSN never deletes the local game.
- **Lifecycle/milestone dates are write-once through automatic flows** — the first value stands. The 9.3 backfill only ever fills nulls (idempotent by construction) and is the single deliberate exception where a sync writes a milestone; its `completed_on = platinum_on` inference is a documented **backfill-only heuristic**, explicitly not the rule for games synced going forward.
- **Nothing external on render.** Trophy counts are fetched at sync time and persisted; no page render hits PSN.
- **Free-tier budget is hard:** 50 external subrequests per Worker invocation. A ~175-game trophy fan-out does not fit — it must chunk or run out-of-band, as must the 9.3 backfill (never a blocking request).
- **Every user-triggered long op ends in a visible summary** (added / already tracked / needs attention), and anything needing action also seeds the persistent attention banner.
- **Degenerate-response guard:** a 200 carrying `errors` fails closed; existing data survives. Re-assert this against the bearer with a captured-payload hazard test when migrating Epic 4's paths.

## Technical Decisions

- **All PSN I/O goes through `PsnProvider`** (`providers/`). The auth mechanism — NPSSO storage, the authorize → code → access-token exchange, bearer caching and refresh — lives **entirely inside** that adapter. No auth detail leaks into `services/`, `routes/`, or `core/`. This is what contains the risk of touching Epic 4's working sync.
- **Domain core is I/O-free.** Completion % and the letter grade are pure functions over the *stored* trophy counts, computed in `core/`, with the grade bands defined in exactly one place. Derived values are never persisted as a second source of truth.
- **Persistence only through `repositories/`** (Drizzle over D1). No raw D1 in services, routes, or core.
- **Attribute ownership:** shared catalog facts live on `GAME`; per-user mutable state (play status, milestone/lifecycle dates, `owned`, ownership type) lives on `GAME_TRACKING`, keyed `(user_id, game_id)`. Trophy progress is per-user — it belongs on the tracking side, not the shared game. Every tracking row carries `user_id`; every query filters by it.
- **Matching order for the wishlist sync:** stored external-ID links first, then normalized title (single shared `core/` normalizer; PS4/PS5 collapse applies). `title_normalized` carries **no uniqueness constraint** — an external id resolving to a *different* game is a needs-attention flag, never a silent merge.
- **Expired-credential signalling reuses the existing path unchanged** — the same `psn_auth: 'expired'` settings flag the cookie sets today, so the existing banner and re-paste prompt fire with no new UI surface.
- **Wishlist endpoint** is the Apollo persisted query `storeRetrieveWishlist`. Its `sha256Hash` is **not client-computable** (Apollo hashes the printed AST; freeform GraphQL is refused 400) — it must be captured from a real client-side navigation, hence 9.1c.
- Migrations: `drizzle-kit generate` → `wrangler d1 migrations apply` from CI before deploy; the Worker never migrates itself.

## UX & Interaction Patterns

- **Trophy display:** completion % and grade appear on the card and detail view. A game with **no** trophy data shows **nothing** — never a fake 0%.
- **Milestone silver** (`#d6e6f5`) is the earned-completion colour; the platinum/completed milestone badge persists on the card regardless of play status. Never recolour Platinum to match a play status.
- **Settings** lives behind the FAB → gear. The credential field sits there; add a "Get / refresh token" control that **deep-links** (plain link, new tab) to Sony's NPSSO endpoint — a signed-in session renders the token to copy, a signed-out one lands on Sony login first. CORS forbids reading it silently; do not attempt it.
- **Attention banner** (under-header, persistent, magenta for an expired credential) routes to Settings. Long ops resolve into a **summary modal**; anything needing action also seeds the banner so it survives dismissal.
- Copy is human: "PlayStation sync needs a new token — the last one expired", never "Auth error 401". Sony marks appear only as descriptive text, never as app branding.

## Cross-Story Dependencies

- **9.1b gates 9.2** (trophies unreachable without the bearer). **9.2 gates 9.3** (the backfill reads persisted trophy data). **9.1c gates 9.4** — and if 9.1c finds the wishlist unreachable under either credential, 9.4 drops out of this epic to Future. 9.1c runs *after* 9.1b so it probes with the credential the app actually carries.
- **9.1b touches shipped Epic 4 code** — library sync and the PS+ Extra catalog paths migrate from cookie to bearer and must be re-verified green. It is the only story in the epic that modifies working code.
- Story 9.1's evidence table lives in `implementation-artifacts/deferred-work.md` (DW-10); 9.1c extends the same entry.
