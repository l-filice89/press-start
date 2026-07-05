# Addendum — ps-game-catalog Product Brief

_Depth captured during the brief conversation that belongs in downstream documents (PRD, architecture), not in the brief itself._

## Data model details (for PRD / architecture)

- **Lifecycle dates, captured from day one.** Future auto-suggestions and stats/dashboards need this history, and it cannot be reconstructed retroactively:
  - `wishlisted_on` — when a game was added to the wishlist
  - `bought_on` — when it entered the owned library
  - `started_on` — when status moved to Playing
  - `completed_on` — story completion date
  - `platinum_on` — Platinum trophy date
- **Two-level completion**: "story completed" and "Platinum achieved" are distinct milestones, tracked separately. The existing Notion status enum has only a single `Completed` — the new model must not collapse these.
- **PS+ Extra availability** is a per-title, per-region flag that changes monthly. Refresh is user-triggered from the UI (Sony updates the catalog on a predictable date each month). A game leaving the catalog is a meaningful state change — availability is not ownership.

## UI direction (for UX / PRD)

- **Reference points:** Steam Big Picture "Recent Games" shelf for look-and-feel (cover-art-forward, dark, slick, modern); current Notion gallery cards for data density (cover, genre tags, status pill, owned checkbox). Luca doesn't dislike the Notion layout — he wants it refined, not reinvented.
- **Landing page:** unfiltered full library. Default ordering: Playing first, Paused second, "Up next" third, rest after.
- **Quick filters:** a row of pills above the list (owned, playing, released, paused, up next, not-owned, …). Multiple active pills combine with **OR**, not AND.
- **Release state:** each game shows its release date, or a **TBA placeholder** if unannounced; "released" is a filterable state.
- **PS+ Extra badge** on game cards for titles currently in the catalog. Check runs only against tracked non-owned games; catalog titles are **never auto-added** to the library.
- **Card flip interaction:** front = cover, name, genres, owned status, flag icons (PS+ Extra, release date/TBA). Click flips the card to the full, editable record.

## Technical research notes (for architecture)

- **PSN trophy API is real and documented.** [psn-api](https://www.npmjs.com/package/psn-api) (TypeScript, modular) exposes `getUserTitles()` — per-title earned-trophy data, including PS5 per-trophy progress.
  - Auth: NPSSO token (64-char, obtained from ca.account.sony.com after web sign-in) exchanged for access + refresh tokens — a documented OAuth-style flow, likely **sturdier than the `pdccws_p` cookie** the library sync currently uses.
  - Investigate at architecture time whether this auth path can also serve library/catalog queries and replace or complement the cookie.
  - See also [andshrew's PlayStation-Trophies API docs](https://github.com/andshrew/PlayStation-Trophies/blob/master/docs/APIv2.md).
- **Trophy-based completion grade** (PSNProfiles-style letter score from % of trophies earned) is computable client-side once trophy counts are synced.
- **Metacritic has no official API.** Critic/user scores likely arrive via the games-DB lookup instead (RAWG returns Metacritic critic scores; IGDB has aggregated critic/user ratings; OpenCritic has an API). Plan: store scores in the DB, refresh via scheduled job — exact source chosen at architecture time.
- **SQLite demoted from constraint to preference (Luca, 2026-07-04).** Decision: **free hosting outranks SQLite.** A SQLite *file* needs a persistent disk, and persistent-disk free tiers are scarce (Render's free tier has no disk; Fly.io no longer offers a free allowance to new orgs).
  - Architecture picks the DB, with the app stateless and data managed externally.
  - Candidates to evaluate (re-verify free tiers at architecture time): Turso/libSQL and Cloudflare D1 (keep SQLite semantics, no disk); Neon or Supabase (managed Postgres).
  - Action: `project-context.md` currently states SQLite-via-bun:sqlite as decided — update it when architecture lands.
- **Auth for the hosted app:** better-auth, magic-link first (easier to stand up), Google OAuth as the long-term option (v1.x).
- **Multi-user seam, not multi-tenancy.** Publishing is "door open, not now" (Luca, 2026-07-05). Architecture should scope user-entered tracking data (status, ratings, dates, wishlist) to a user id from day one — better-auth provides the users table anyway — but build no sharing, roles, or tenant isolation until the door is actually walked through.

## Future features (explicitly out of v1, noted for roadmap)

- **Auto-suggestions for "what to play next"**, tunable by mode (e.g. "same genre", "vary genre"). Today's manual behavior it replaces: filter owned games, sometimes by genre, then pick by gut.
- **Stats and dashboards** built on the lifecycle-date history.
- Possible far-future expansions mentioned but not committed: playtime, trophies beyond Platinum, non-PlayStation platforms.
