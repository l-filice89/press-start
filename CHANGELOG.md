# Changelog

All notable changes to PRESS START are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
