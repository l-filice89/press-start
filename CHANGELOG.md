# Changelog

All notable changes to PRESS START are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.6.0] — 2026-08-16

Let every user permanently remove their Press Start account and user-owned
library/settings data.

### Added
- **Permanent account deletion.** Settings now provides an accessible,
  confirmation-gated account action with an export-first warning. A short-lived
  email link proves control of the account email and must be opened while signed
  in to the same account; failed or cancelled requests preserve the account.

### Security
- **Atomic private-data cleanup.** Verified deletion removes the user identity,
  linked accounts, all database sessions, library tracking, and settings in one
  cascading write while preserving shared catalog facts and other users.
- **Session and cache cleanup.** The deleting browser returns to Login with its
  query and ETag caches cleared. Other-device database session rows are deleted
  immediately; effective access through the existing signed session-cookie
  cache can remain valid for at most five minutes.
- **Single-use verification.** Deletion links expire after five minutes, are
  bound to the requesting user, require a valid same-user session, and cannot be
  replayed or used across accounts.

## [3.5.0] — 2026-08-15

Let each user limit interactive IGDB title matches to releases on selected
PlayStation platforms.

### Added
- **IGDB platform selection.** Settings now lets each user choose one or more
  of PS1–PS5, PSP, PS Vita, PSVR 1, and PSVR 2; PS1–PS5 are selected by
  default.

### Changed
- **Platform-filtered matching.** Add preview, rematch, and straggler searches
  now use the saved platform selection. Cached searches refresh immediately;
  existing library rows and scheduled score, time-to-beat, and release-date
  updates remain unchanged.

## [3.4.0] — 2026-08-03

Turn Shelf data into an immediate, transparent answer to “what should I play
next?”

### Added
- **Play Next destination.** Every visit opens with up to three deterministic,
  varied suggestions derived locally from cached Shelf data, with inspectable
  reasons and known supporting facts.
- **Intentional tuning.** Combine genre, length, shelf-age, confidence,
  priority, and progress intent; exact matches lead and relaxed results are
  labeled `Closest match`. Wishlist discovery remains explicit.
- **Non-repeating Shuffle.** Visit-scoped history avoids previously shown games,
  reports honest pool exhaustion, and resets without immediately repeating the
  visible slate.
- **Recommendation actions.** Open details without losing visit state, or use
  the existing guarded lifecycle mutation to start a game and return to Shelf.

### Changed
- **Responsive recommendation briefing.** Compact ranked command rows serve
  tablet widths; full command rows serve desktop; narrow screens retain the
  approved card layout. Exact breakpoint behavior has browser coverage.

### Fixed
- **Interaction hardening.** Pending writes lock slate-changing escape paths,
  failures preserve the complete visit and restore focus, successful writes
  focus the settled Playing card once, and concurrent card writes cannot unlock
  controls early.

## [3.3.2] — 2026-08-02

Keep upcoming game release dates aligned with IGDB.

### Changed
- **Scheduled release-date refresh.** The existing weekly-effective IGDB score
  pass now updates release dates too, using the same batched `/games` response
  with no extra cron trigger or provider request.

### Fixed
- **Safe date convergence.** Rescheduled dates update automatically and dates
  withdrawn by IGDB return to TBA; omitted games and failed or degenerate
  replies preserve standing dates and retry through the existing failure path.

## [3.3.1] — 2026-08-01

Keep PS+ Catalog results visible sooner on narrow viewports.

### Changed
- **Responsive Catalog filters.** At 600px and below, one `Filters` button
  opens a genre sheet whose selections and matching results update together;
  wider layouts use one Genre dropdown instead of an inline genre wall.

### Fixed
- **Filter focus behavior.** Keyboard focus remains trapped while the sheet is
  open, returns to its opener on close, and moves to the visible Genre control
  when resizing to desktop; selected URL-backed genres remain active.
- **Honest loading feedback.** Pending genre vocabulary and result totals show
  updating text instead of presenting an empty or stale count as current.

## [3.3.0] — 2026-08-01

Keep mobile Stats readable and move library backup into its permanent home.

### Changed
- **Mobile Stats reading order.** All-time recap cards now appear before the
  year selector on phones, while desktop keeps the selector beside the title.
- **CSV export moved to Settings.** `DATA BACKUP / Keep your own copy` now owns
  the export action, with progress, failure feedback, response validation, and
  cancellation when Settings closes.
- **FAB retired.** The one-action Chores FAB and its handedness setting/API are
  removed from Shelf, Catalog, and Stats; harmless legacy setting rows remain.

## [3.2.0] — 2026-08-01

Reflect on your gaming history through a compact cabinet-style scoreboard.

### Added
- **Stats destination.** `SHELF | CATALOG | STATS` now opens a dedicated,
  responsive dashboard with all-time tracked, owned, story-complete, and
  Platinum totals.
- **Gaming-year activity.** Select any year found in lifecycle dates to see
  wishlisted, bought, started, completed, and Platinum totals, monthly activity,
  and top genres among games completed that year.
- **Honest dashboard states.** Loading, retryable failure, empty library,
  no-dated-activity, and wishlist/purchase-only years have explicit states.

### Changed
- **Stats-specific shell.** Search/Add is removed while Stats is active, while
  existing Shelf and Catalog behavior remains unchanged.

## [3.1.0] — 2026-07-31

### Added
- **Release date on the shelf.** Each game's release date now shows on the
  card and in the detail panel, and can be edited directly from the detail
  panel.

## [3.0.1] — 2026-07-24

### Added
- **Claimed-via-PS+ correction on manual ownership.** With sync gone, every
  manual own of an un-owned game now opens a buy-vs-claim prompt; a
  purchase→claim correction button was added to the detail panel's
  Ownership section.
- **Buy-vs-claim source on the add-game dialog.** Owned adds now carry an
  inline Purchased/Claimed-with-PS+ choice instead of silently stamping a
  made-up purchase date.

### Fixed
- **Cross-gen edition pairs collapse correctly in the PS+ catalog browse**,
  keying on shared title ID / CUSA-PPSA generation prefix instead of the
  platform-disjoint rule alone.

## [3.0.0] — 2026-07-22

Multi-User Readiness: the app stops assuming one owner. Anyone with a
verified email can register, and every PS+ fact is derived per user and
per region.

### Breaking
- **Open registration replaces the allowlist.** The email allowlist is
  deleted; admission is verified-email (magic link or Google), guarded by
  in-app rate limiting and an account-link gate.
- **Per-user PS+ facts.** The four PS+ columns on `games` are dropped
  (destructive migration 0016); membership is now derived per user + region
  from the catalog, and departures live in a `ps_plus_departure` ledger.
- **Manual PS+ refresh removed.** The check button and failed-refresh banner
  are gone — the scheduled per-region refresh owns the data.

### Added
- **Per-region scheduled refresh.** The PS+ cron walks every region with
  users via a `ps_plus_region_state` ledger (quarantine, idle, and monthly
  window rules); a stale-snapshot guard keeps the shelf honest between runs.
- **Score refresh on its own daily cron** (`0 3 * * *`), separate from the
  PS+ schedule; a failed run flags all users and retries the next day.
- **Free-tier read-budget hardening.** Shelf ETag/304, single-row reads, SQL
  counts, and a paged catalog lift the sustainable daily-active-user budget
  from roughly 550 to roughly 2,000 on the D1 free tier.

### Fixed
- **Legacy `owned_via` rows backfilled** (migration 0018) so ownership
  provenance is complete before multi-user data arrives.

## [2.2.0] — 2026-07-17

Fit the Time I Have: filter the shelf by how long a game takes to beat.

### Added
- **Time filter group on the shelf.** Five hour bands (≤25h, 25–50h, 50–75h,
  75–100h, >100h) plus an explicit Unknown pill — OR within the group, AND
  against State/Genre/Flags, on desktop as a third dropdown and in the mobile
  filter sheet. A story/100% toggle inside the group picks which time-to-beat
  metric the bands read (default story hours); a game missing the selected
  metric matches only Unknown, never a numeric band.
- **The filter summary names the time metric.** Active bands narrate as
  "… story completion" or "… 100% completion", so the sentence says which
  hours it filtered on.

## [2.1.2] — 2026-07-16

### Fixed
- **Milestones no longer close the detail panel.** Logging a platinum or a
  story completion keeps the panel open showing the new state; clearing or
  dropping a status still closes it.
- **The shelf no longer jumps to the top after tracking writes.** Status
  changes, milestone logs, and rematches used to collapse the progressively
  rendered list back to the first page, yanking the scroll position; the
  rendered window now survives refetches and resets only when filters or
  search change.
- **Export CSV is hidden on the catalog.** It exports the library, so
  offering it while browsing the PS+ catalog was misleading; it stays
  available on the shelf.
- **Genre pills with 0 games no longer render in the catalog.** Zero-count
  facet keys are dropped server-side; a selected genre whose count drops to
  zero keeps its own chip so the live filter stays visible and escapable.

## [2.1.1] — 2026-07-16

### Fixed
- **Store collections now match on IGDB.** Bundle (`game_type 3`) was excluded
  from every IGDB search — titles owned as one product (Crash Bandicoot
  N. Sane Trilogy, Mass Effect Legendary Edition, Overcooked! All You Can
  Eat) could not be matched anywhere, even manually in the stragglers
  dialog, despite carrying scores on IGDB. DLC/season/pack/update noise
  stays excluded.

## [2.1.0] — 2026-07-16

Know Before You Play: three decision signals — critic/user scores, time to
beat, and PS+ departure dates — stored and refreshed on schedule, never
fetched on render.

### Added
- **Critic and user scores** on every game (IGDB, 96.9% coverage), shown
  color-graded on cards, the detail panel, and the add/rematch pickers.
- **Time to beat** (IGDB, main story and completionist) on cards and the
  detail panel.
- **Per-game PS+ departure dates** from the store's PS_PLUS inclusion-offer
  `endTime` — a dated "LEAVING {date}" pill and detail-header banner replace
  the post-hoc "LEFT PS+" stamp, plus a shelf Leaving-soon filter and leaving
  dates on catalog cards.
- **Score/TTB/leaving refresh crons** — leaving sweep runs `0 9,21 15-28 * *`
  matching Sony's announcement cadence.
- Migrations 0012–0015, all additive.

### Changed
- "LEFT PS+" pill retired in favor of the dated LEAVING pill.

## [2.0.0] — 2026-07-16

PSN account safety: everything that signed in as you is gone.

### Removed
- **PSN library sync** — the shelf no longer fills itself from your purchase
  history. New games enter through add-by-name; ownership fields are set by
  seed or by hand.
- **Trophy sync and the trophy readout** — cards and the detail panel no
  longer show trophy progress or grades, and the trophy columns are dropped
  from the database. The platinum badge and manually entered milestone dates
  (platinum, story completion) are untouched.
- **Platinum-date backfill** — the one-off recovery pass and its Settings
  panel are gone.
- **PSN sign-in (NPSSO)** — Settings has no token field and no expired-token
  banner; the app no longer holds any PSN credential, anywhere.

### Security
- Every remaining PlayStation call is anonymous. The credentialed flows
  impersonated the PSN app against undocumented endpoints and got the real
  account locked (2026-07-15); this release deletes that entire surface and
  pins it with a CI guard so credentialed code cannot quietly return. The
  PS+ catalog (browse, check, monthly refresh) carries no account identity
  and is unaffected.

## [1.4.0] — 2026-07-15

Browse the PS+ catalog without leaving the app.

### Added
- **PS+ catalog as a destination** — browse the PlayStation Plus game catalog
  from its own tab, filterable by genre, newest first. No PSN sign-in needed;
  the catalog is fetched anonymously.
- **Add or claim straight from the catalog** — a catalog game you don't have
  yet can be added to the shelf; one you already track is claimed and linked.
- **PSN region setting** — pick the storefront region the catalog reads from,
  with a pointed hint when the store rejects the region.

### Changed
- **The genre sweep runs from the client after a PS+ check**, so the catalog
  only refreshes when PS+ data is actually reachable.

### Fixed
- **Opening a game's detail from the catalog** keeps you on the catalog
  instead of bouncing back to the shelf.
- **Games sold under two SKUs** no longer appear twice in the catalog.
- **Long toast messages wrap** instead of clipping off-screen on phones.
- **PSN's sign-in redirect is treated as an auth denial**, not a mystery
  failure.

## [1.3.0] — 2026-07-14

Trophies on the shelf, and a PSN connection that stays connected.

### Added
- **Trophy progress on every game** — each card and detail panel shows how far
  you are through that game's trophy list, platinum included. Sync trophies from
  the ＋ bar; the shelf fills in from your PSN trophy history.
- **Platinum dates backfilled** — a one-off pass pulls the platinum earn date
  PSN already knows for games you have already platinumed, instead of leaving
  them blank until the next sync.

### Changed
- **PSN now connects with an NPSSO token, not the `pdccws_p` cookie** — the
  cookie expired within hours and had to be re-pasted constantly. The NPSSO
  token is longer-lived, so the connection survives. Paste it in Settings.
- **The ＋ bar shows labels on mobile** and reuses the platinum trophy icon for
  the trophy sync action.

### Fixed
- **Two syncs at once no longer collide** — a single-flight guard means a second
  sync request joins the running one instead of starting a competing pass.
- **A malformed NPSSO token is rejected on save** rather than failing later
  mid-sync with an unhelpful error.
- **Sync failures no longer vanish** — a discarded sync result used to fail
  silently; it now surfaces.

## [1.2.0] — 2026-07-13

### Added
- **Sign in with Google** alongside the magic link.
- **One shared IGDB match picker** for add, rematch, and stragglers.

### Fixed
- **Settings: the Save cookie button** sits under the cookie input it belongs to.

## [1.1.1] — 2026-07-13

Mobile layout repair.

### Fixed
- **The phone layout overflowed the screen** — the shelf grid's columns sized
  themselves to the widest untruncated game title, dragging the whole page about
  twice the width of the viewport. Everything read shifted and clipped, and the
  page scrolled sideways. Cards now fit the screen.
- **Adding a game was impossible on a phone** — the `＋ Add` bar hangs under the
  search field, and on phone the field is pinned to the bottom edge, so the bar
  rendered below the viewport where it could not be reached. It now sits above
  the field.
- **The search bar landed on top of the sign-out button** — the phone's
  bottom-pinned search was pinning to the header instead of the screen. It pins
  to the screen now, and the header's controls wrap instead of overflowing.
- **Settings and the straggler list scrolled sideways** — an unbreakable PSN URL
  and a row of actions that never wrapped. Both wrap now.

### Changed
- **Production deploys on a published GitHub Release**, no longer on every push
  to `main` — merging a PR is not by itself a release. Publishing the release
  for a tag is what ships it.

## [1.1.0] — 2026-07-13

Post-v1 IGDB match quality & correction.

### Added
- **Rematch a wrong match** — a "Wrong match?" control on the detail panel opens
  the games database picker so you can re-point a game at the correct IGDB
  entry. Overwrites its cover, release date, title, and genres in place — the
  fix for a same-named entry winning the wrong cover (e.g. a movie tie-in beating
  the real game), and the way to clean up covers that are already wrong.

### Fixed
- **IGDB search returned nothing** — the "full games only" filter queried IGDB's
  retired `category` field, which matches zero rows on the live API; every search
  and add-by-name preview came back empty. Now filters on `game_type` (same
  values), so results flow again.
- **Relevant games buried** — the candidate list was capped at 10 while the query
  fetched 50, so a prolific franchise could hide the right game past the cut.
  The picker now shows the full result set.

### Changed
- Pinned `wrangler` to an exact version to stop dependency drift from pulling a
  runtime that crashes the local dev/e2e server.

## [1.0.0] — 2026-07-13

First release. A single-user installable PWA that replaces a Notion
game-tracking database: a React SPA + Hono JSON API on one Cloudflare Worker,
backed by Cloudflare D1.

### Added
- **Shelf** — cover-forward grid of the library with per-game status, ownership
  (physical/digital), milestones (story complete, platinum), and lifecycle
  dates. Reversible owned/status toggles with UNDO.
- **Auth** — magic-link sign-in (better-auth), restricted to a single allowed
  email.
- **Detail panel** — per-game status, ownership source (purchased vs PS+ claim),
  genres, and dates, all editable in place.
- **Add at the moment of discovery** — add a game by name with IGDB-enriched
  cover/genres/release date; name-only fallback and straggler resolution for
  anything IGDB can't match.
- **PlayStation Plus Extra awareness** — monthly catalog refresh (cron) flags
  which owned games are PS+ claims (subscription-bound) vs purchases.
- **Chores** — CSV export, settings (handedness, PSN region/cookie, sign-out),
  and free-text shelf search.
- **CI/CD** — quality gate (lint, typecheck, test, build) + Playwright e2e with
  PR burn-in; deploy on push to `main` runs migrations before deploy, syncs
  Worker secrets, and smoke-tests the live endpoints.

[1.0.0]: https://github.com/l-filice89/press-start/releases/tag/v1.0.0
