# Changelog

All notable changes to PRESS START are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
