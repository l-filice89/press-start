# Changelog

All notable changes to PRESS START are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
