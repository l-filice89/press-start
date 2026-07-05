---
id: SPEC-ps-game-catalog
companions:
  - ../../planning-artifacts/architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md
  - ../../project-context.md
sources:
  - ../../planning-artifacts/prds/prd-ps-game-catalog-2026-07-05/prd.md
  - ../../planning-artifacts/prds/prd-ps-game-catalog-2026-07-05/addendum.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# PS Game Catalog

## Why

A **vision to realize**: Luca wants a personal web app that replaces his Notion database as the record of his PlayStation gaming life — owned, wanted, playing, finished. Notion only works as hard as its owner does; this is **a library that fills itself** — append-only PS-library sync, one name-search to add anything else, and PS+ Extra awareness on games he doesn't own. It is a single-user tool reachable from the phone at the moment of discovery, the only moment that counts for the wishlist. Existing trackers were considered and rejected (none sync a PlayStation library *and* know what's in PS+ Extra), but the honest core is simpler: it's Luca's tool, built exactly to his taste — for a personal project that's the requirement, not a rationalization. It may be published someday; v1 builds nothing toward that beyond not welding the door shut. The real deliverable is **trust**: a tracker that's only mostly right slowly stops being consulted at all.

## Capabilities

- **CAP-1 — Computed state model**
  - **intent:** Track each game's lifecycle through a single user-set mutable play status (`Not started`/`Up next`/`Playing`/`Paused`/`Dropped`) plus immutable completion-milestone dates (`completed_on`, `platinum_on`), deriving every other filterable/displayable state (effective state, released, wishlisted, playable-now, ownership) so nothing computable can drift.
  - **success:** Every game always resolves to an effective state; the invariant "every game has a play status **or** at least one completion milestone" is never violated by any edit (the detail view refuses an edit that would leave neither); a platinumed game never matches the "Playing" pill, and a replay shows "Playing" while its completion dates stand untouched.

- **CAP-2 — The Shelf & detail view**
  - **intent:** One dark, slick, cover-forward landing page answers "what's my gaming life right now?", with minimal cards that flip into a full editable detail view (status, milestones, lifecycle dates, genres, ownership, and a "View on PS Store" link for wishlisted games).
  - **success:** The default shelf shows the live-status backlog ordered `Playing` → `Paused` → `Up next` → `Not started` (alphabetical within each group), with `Story completed` / `Platinum achieved` / `Dropped` hidden one pill away; logging a milestone requires a confirmation modal.

- **CAP-3 — Filter & search**
  - **intent:** Filter the library by State, Genre, and Flags with **OR-within-group, AND-across-group** semantics plus completed/platinum/dropped reveal pills, alongside an always-visible name-search bar.
  - **success:** "Completed games only" is a one-pill view; the search bar matches the **entire** library ignoring active filters and hidden states, so "did I ever finish that?" always answers.

- **CAP-4 — Seed import (one-time)**
  - **intent:** Import the Notion CSV export and the PS-library export, reconcile titles across both sources and the games DB (case-insensitive after stripping glyphs/articles/edition suffixes; PS4/PS5 collapse to one PS5 entry), map Notion statuses onto the new model, honor the CSV `Owned` column, exclude PS+ membership claims, and enrich every game (cover, genres, release date) from the games DB.
  - **success:** Everything mappable lands enriched; every unmatched, ambiguous, or unplaceable row (unknown status, `Completed` with no *Date finished*) goes to a **visible in-app stragglers list** for manual resolution rather than being guessed, and the summary reports the skipped-claim count. Resolving a straggler carries its Notion data onto the matched game and stores a permanent match link.

- **CAP-5 — PS library sync**
  - **intent:** A button-triggered, append-only sync that creates new games (owned, digital, `Not started`) and may flip `Owned` true on any existing game, while skipping membership claims and capturing cover art + PS Store product URL at sync time.
  - **success:** User-entered status, milestones, dates, and genres survive every sync (nothing is deleted, `Owned` is never set false, claims never flip ownership); each sync ends with a visible summary of games added, `Owned` flips, membership entries skipped, and anything needing attention.

- **CAP-6 — PS+ Extra awareness**
  - **intent:** Set/clear the PS+ Extra flag on tracked, non-owned games against the user's region catalog, driven by both a button and a monthly scheduled job aligned to Sony's catalog update, updating flags in both directions.
  - **success:** The shelf shows a "PS+ catalog as of {date}" timestamp; the flag is hidden the moment a game becomes owned; a failed scheduled refresh surfaces a notice on next app open (no catalog game is ever auto-added to the library).

- **CAP-7 — Add-by-name**
  - **intent:** Search the games DB (and the existing library) by name, review editable pre-filled data (cover, genres, release date), and save — with a name-only fallback entry when the external search is unreachable or lacks the title.
  - **success:** The discovery-moment add — open app, type name, pick, save — takes seconds and never depends on a third party being up; picking a game already tracked opens its detail view instead of creating a duplicate; a name-only save lands in the stragglers list for later enrichment.

- **CAP-8 — Lifecycle date capture**
  - **intent:** Silently auto-record `wishlisted_on`, `bought_on`, `started_on`, `completed_on`, and `platinum_on` on every transition (never asked for), write-once through automatic flows, manually correctable in the detail view.
  - **success:** Dates that cannot be reconstructed later are captured in v1 even though nothing consumes them yet; no sync, status change, or re-transition ever overwrites a recorded date, and seed-imported games get only the dates the CSV actually knows (no fabricated history).

- **CAP-9 — PWA, auth & multi-user seam**
  - **intent:** Ship one installable, responsive PWA (phone and desktop both first-class), authenticated with better-auth magic link, with all user-entered tracking data scoped to a user id from day one.
  - **success:** A home-screen icon reaches the wishlist-add flow in seconds on phone and the cover-forward shelf shines on desktop; tracking data is user-scoped without any sharing, roles, or tenant isolation being built.

- **CAP-10 — CSV export (durability)**
  - **intent:** Export the full library — games, statuses, milestones, lifecycle dates, genres, ownership — as a downloadable CSV in v1.
  - **success:** A user can download a complete, self-contained CSV copy of their catalog — insurance beyond the DB provider's backups for data that can't be reconstructed.

## Constraints

- **Free-tier hosting is a hard constraint.** The app is stateless, data lives in an externally managed database, and the PS+ scheduled job must also fit the free tier. Free hosting outranks the original SQLite preference. *(Resolved in the architecture companion: Cloudflare D1 + one Cloudflare Worker + Cron Triggers.)*
- **Nothing external on render.** Covers and store links serve only from persisted data; third-party APIs are hit exclusively at import, sync, refresh, or add time.
- **Failures surface, never silently retry.** An expired PlayStation session cookie shows the refresh instructions (no retry on 401/403); a failed external lookup lands the game in the stragglers list.
- **`Owned` means purchased.** Membership-sourced (PS+ claim) entries never create games and never set `Owned`, in either import or sync; when the entitlement source is ambiguous, sync prefers skipping over flipping `Owned` (a missed flip is one manual toggle; a wrong `Owned` silently poisons the wishlist). In the real export ~123 of 175 entries are claims, not purchases.
- **Append-only to user data.** No sync, import, or refresh ever modifies or deletes user-entered status, milestones, dates, or genres. Lifecycle dates and completion milestones are write-once through automatic flows (the first value stands), changeable only by deliberate edit in the detail view.
- **Anything computable is computed.** Derived states (effective, released, wishlisted, playable-now) are never stored or user-set — a manual state can drift, a derived one is always right. UI surfaces operate on effective state, never raw play status.
- **Genres come exclusively from the third-party games DB.** Notion's `Category` column is dropped at import and every game is re-tagged via external lookup so the vocabulary is consistent from day one.
- **PS auth is the `pdccws_p` session cookie**, stored in a settings table, editable from the UI, read fresh per call, never retried on failure.

## Non-goals

- **Multi-user support and public release** — out for now; the door is left open by the user-id scoping seam (CAP-9) and nothing more.
- **Non-PlayStation platforms.**
- **Auto-adding PS+ catalog games to the library** — availability is not ownership; catalog games leave.
- **Automating anything Sony's API can't give reliably.**
- **Gamification, ever** — no XP, streaks, or badges (it incentivizes logging games nobody plays).
- **Personal ratings** — the Notion `Rating` column is not imported and no rating field exists (external critic/community scores are a separate, later concern).
- **Genre merge/rename tool** — not v1 (genres are editable per-game).
- **v1.x, not v1:** trophy sync (completion % + letter grade), critic/user scores, "leaving PS+ Extra soon" warnings, Google sign-in.
- **Future, not scoped:** sale detection + notifications (mechanism sketch in the source addendum → architecture concern), PS+ subscription-tier settings, tunable play-next suggestions, stats/dashboards over lifecycle history.

## Success signal

The one metric that matters: **the Notion database gets archived and never reopened.** That is demonstrable when (1) every owned game is present without manual entry ("bought and forgot" becomes impossible), (2) logging a status change takes seconds rather than a Notion-editing session, (3) the wishlist — including the "already in PS+ Extra" check — is consulted before a purchase, and (4) filtering the backlog beats Notion's views. The counter-signal (how we'd know it's failing): the app stops being consulted when deciding what to play next, or wishlist additions regress to occasional batches instead of happening at the moment of discovery.

## Assumptions

- The PRD's §7 open questions were architecture-time decisions and are **resolved in the adopted companions** (`ARCHITECTURE-SPINE.md`, `project-context.md`): database = Cloudflare D1, games DB = IGDB, scheduled job = Cloudflare Cron Triggers, stack = a React SPA served by a single Cloudflare Worker (Hono + Drizzle + Zod). The PS-auth open question (NPSSO vs. cookie) is resolved by **keeping the `pdccws_p` cookie** for v1; NPSSO was not adopted. Downstream reads those companions for the HOW; this spec does not restate it.
