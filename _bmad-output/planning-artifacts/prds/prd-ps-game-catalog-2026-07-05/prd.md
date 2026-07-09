---
title: PS Game Catalog PRD
status: final
created: 2026-07-05
updated: 2026-07-05
---

# PS Game Catalog — Product Requirements Document

## 1. Vision & Success

**ps-game-catalog** is a personal web app that replaces Luca's Notion database as the record of his PlayStation gaming life — owned, wanted, playing, finished. Notion only works as hard as Luca does; this is **a library that fills itself**: append-only PS library sync, one name-search to add anything else, and PS+ Extra awareness on games he doesn't own.

It is a single-user tool, reachable from the phone at the moment of discovery — that moment being the only one that counts for the wishlist. If it turns out well, it may be published someday; v1 builds nothing for that beyond not welding the door shut.

**Why build instead of adopt:** the existing trackers were considered and rejected — Backloggd and HowLongToBeat don't sync a PlayStation library (Infinite Backlog is the lone exception), and none of them knows what's in PS+ Extra. But the honest core is simpler: this is Luca's tool, with all the bells and whistles he desires. For a personal project that isn't a rationalization — it's the requirement.

**The one metric that matters:** the Notion database gets archived and never reopened. That happens when:

1. The library can be trusted — every owned game is present without manual entry ("bought and forgot" becomes impossible).
2. Logging a status change takes seconds, not a Notion-editing session.
3. The wishlist gets consulted before purchases — including the "already in PS+ Extra" check.
4. Filtering the backlog beats what Notion's views offered.

**Counter-metric — how we'd know it's failing:** the app stops being consulted when deciding what to play next, or wishlist additions regress to occasional batches instead of happening at the moment of discovery. A tracker that's only mostly right slowly stops being consulted at all; trust is the real deliverable.

## 2. State Model

Everything the UI shows and filters derives from this model. The governing principle: **anything that can be computed is computed** — a manually set state can drift; a derived state is always right.

### Play status (the only user-set, mutable state)

`Not started` · `Up next` · `Playing` · `Paused` · `Dropped`

- **FR-1** — One per game. Defaults to `Not started`.
- **FR-2** — May be **null** once a completion milestone exists (and only then). Logging a **platinum** auto-clears the status to null; a **story completion** leaves the status untouched — play usually continues toward the platinum, so the game stays on the shelf (amended 2026-07-09; was: any milestone auto-clears). The user may also clear it manually (replay ends, etc.). A replay sets it back to `Playing`.
- **FR-3** — **Invariant: every game always has a play status or at least one completion milestone.** The detail view refuses any edit that would leave neither (clearing the last milestone requires setting a play status first).
- **FR-4** — `Dropped` games are hidden from the default shelf, reachable via the `Dropped` reveal pill (§3).

### Completion milestones (dates, not statuses)

- **FR-5** — `completed_on` ("Story completed") and `platinum_on` ("Platinum achieved") are dates; non-NULL means achieved.
- **FR-6** — **Immutable through normal flows** — never cleared or overwritten by any sync, status change, or replay. Editable only in the game's detail view (subject to FR-3). Logging a milestone that already has a date does nothing — the first achievement stands.
- **FR-7** — Logging either milestone requires a **confirmation modal** (fat-finger protection).

### Effective state (what every UI surface uses)

```
effective state = play status, if set
                  else "Platinum achieved", if platinum_on
                  else "Story completed",  if completed_on
```

**FR-8** — Shelf ordering, card labels, and filter pills all operate on effective state, never on raw play status. A platinumed game never matches the "Playing" pill; a replayed game shows "Playing" while its completion dates stand untouched.

### Ownership

- **FR-9** — `Owned` is a flag, not a status, and it means **purchased**. It is set by the PS library sync (source of truth for digital) **or manually in the detail view** (physical discs, which the PS API cannot see). PS library entries that are **membership-sourced** (PS+ claims — the export's `membership` field) never set it: availability is not ownership (§6), and in the real export the majority of entries are claims, not purchases.
- **FR-10** — Sync may set `Owned` to true on any existing game — including ones added by hand or by name — and never sets it false; nothing unsets it except the user.
- **FR-11** — Ownership type (`digital` / `physical`) is inferred — sync-sourced games are digital, manually flagged ones default to physical — and editable in the detail view.

### Derived states (never stored, never user-set)

- **FR-12** — **Released**: release date is a real date ≤ today. A `TBA` or missing/unknown release date counts as not released.
- **FR-13** — **Wishlisted**: not owned. No separate wishlist status or list exists.
- **FR-14** — **Playable now**: (owned OR currently in the PS+ Extra catalog) AND released — a pre-order isn't playable.

## 3. The Shelf (landing page)

One screen answers "what's my gaming life right now?" — the landing page is the product's face. Look-and-feel: **dark, slick, modern** — Steam Big Picture's "Recent Games" shelf is the visual reference, leaning hard on the covers, with Notion-gallery data density. Luca doesn't dislike the Notion layout; it gets refined, not reinvented.

### Cards

- **FR-15** — Minimal by default: cover art, name, genre tags, owned indicator, flag icons for PS+ Extra and release state (date/TBA).
- **FR-16** — Clicking a card flips it into the full editable detail view: play status, milestones (with confirmation modal), lifecycle dates, genres, ownership flag + type, and — for wishlisted games — a **"View on PS Store" link** (product URL when known, store search-by-title fallback).

### Default view

- **FR-17** — Shows every game whose effective state is a live play status; **`Story completed`, `Platinum achieved`, and `Dropped` games are hidden by default** — the default shelf is the backlog view, the full record is one pill away.
- **FR-18** — Default ordering: `Playing` → `Paused` → `Up next` → `Not started`; **owned before wishlisted, then alphabetical by name, within each group** (ownership tier added 2026-07-09, Luca — surfaces ready-to-start games).
- **FR-19** — **Infinite scroll**, with an always-visible **name search bar**. Search is a lookup, not a view: it matches against the entire library, ignoring active filters and hidden states — "did I ever finish that?" must always answer.

### Filters

**FR-20** — Semantics: **OR within a group, AND across groups.**

| Group | UI | Members |
|---|---|---|
| State | Multiselect dropdown | `Not started`, `Up next`, `Playing`, `Paused` (live statuses only) |
| State reveals | Individual pills | `Story completed`, `Platinum achieved`, `Dropped` — each ORs its state into the visible set (they extend the state group; AND across mutually exclusive states would always be empty) |
| Genre | Multiselect dropdown | All genres in the vocabulary |
| Flags | Individual pills, **each its own group (AND)** | `Owned`, `Wishlisted`, `Released`, `Playable now` |

**FR-21** — State-group selection rule: with nothing selected, the shelf shows the default visible set (all live statuses, FR-17). The moment *anything* in the state group is selected — dropdown entries or reveal pills — the shelf shows **exactly** the selected states. "Completed games only" is therefore a one-pill view.

**FR-22** — Active pills are visually highlighted (toggle-on state).

### Genre vocabulary

- **FR-23** — **Single source: the third-party games DB** (IGDB/RAWG — architecture picks). Notion's genre column is dropped at import; the seed importer re-tags all games via external lookup, so the vocabulary is consistent from day one and stays consistent as games are added.
- **FR-24** — Adding a game whose genres don't exist yet auto-creates the genre rows.
- **FR-25** — Genres are editable per-game in the detail view (fix a bad auto-fill); a merge/rename tool is not v1.

## 4. Getting Games In

Three doors into the library. All of them record lifecycle dates silently (§4.5), and none of them ever modifies user-entered data.

### 4.1 Seed import (one-time)

- **FR-26** — Imports the Notion CSV export and the PS library export, then enriches **every** game from the third-party games DB (cover, genres, release date) — genres come exclusively from there (§3). **Membership-sourced PS entries (PS+ claims) are excluded** — they neither create games nor set `Owned` (FR-9); the import summary reports how many were skipped.
- **FR-27** — **Title reconciliation** joins the two sources and the external DB: comparison is case-insensitive after stripping trademark glyphs (`™`, `®`), leading articles ("The …"), edition suffixes, and normalizing whitespace. PS4/PS5 duplicates collapse to one PS5 entry.
- **FR-28** — The import lands everything it can and **lists stragglers visibly in the UI** — unmatched or ambiguous titles are resolved by manual search from the app, no interactive import session. Resolving a straggler **carries its Notion data** (status, dates, owned flag) onto the matched game.
- **FR-29** — **A manual match is permanent:** resolving a straggler stores the external-ID/title-alias link, so subsequent PS syncs recognize the game and never re-add it as a duplicate.
- **FR-30** — **Notion status mapping** onto the new model: `Completed` → status null + `completed_on` (from *Date finished*); `Up next!` → `Up next`; `Not released` → `Not started` (the release date carries that fact); `Not started`, `Playing`, `Paused` map 1:1. *Date started* → `started_on`. The *Rating* column is **not** imported (personal ratings are a non-goal, §6). Any row the mapping can't place — an unknown status value, or `Completed` without a *Date finished* — goes to the stragglers list instead of guessing.
- **FR-31** — The CSV's **`Owned` column is honored**: `Owned: Yes` games import as owned (ownership type physical by default, editable — these are exactly the discs and delisted titles the PS export won't contain), never as wishlisted.
- **FR-32** — **No fabricated history:** the import stamps only the dates it actually knows (*Date started*, *Date finished*); `bought_on` and `wishlisted_on` remain null for imported games.

### 4.2 PS library sync

- **FR-33** — Triggered by a **button**. **Append-only applies to user-entered data:** sync may create games (defaults: `Owned`, digital, `Not started`) and may flip `Owned` to true on existing games of any origin (stamping `bought_on`, ownership type digital); it never deletes a game, never sets `Owned` false, and never touches status, milestones, dates, or genres. **Purchase-sourced entries only:** membership-sourced entries (PS+ claims, FR-9) are skipped — never created, never flipped to `Owned` — and a claim that matches an already-tracked game leaves it untouched.
- **FR-34** — Matching order: stored external-ID/alias links first, then normalized title. PS4/PS5 collapse applies. A title-matched game that already carries a *different* external-ID link is flagged in the sync summary's needs-attention list rather than silently merged (two distinct games can normalize to the same name).
- **FR-35** — Cover art and the PS Store product URL are captured at sync time and persisted — nothing is fetched on page render (NFR-3).
- **FR-36** — Auth is the PlayStation session cookie, stored in a settings table and editable from the UI. On 401/403 the app surfaces the refresh instructions — it does not retry. (Open: a sturdier auth path, e.g. NPSSO, to be investigated at architecture time.)
- **FR-37** — Every sync ends with a **visible summary**: games added, `Owned` flips, membership-sourced entries skipped (FR-33), and anything needing attention (failed external lookups).

### 4.3 PS+ Extra check

- **FR-38** — Sets/clears the PS+ Extra flag on **tracked, non-owned games only**. Catalog games are never auto-added to the library; a refresh updates flags in both directions (games leave the catalog too). The catalog is **per-region** — the check runs against the user's account region. The flag is ignored and hidden from the moment a game becomes owned.
- **FR-39** — Triggered by a **button and a scheduled job** aligned to Sony's predictable monthly catalog update. (The scheduled job must fit the stateless free-tier constraint — architecture concern.)
- **FR-40** — The shelf shows a **"PS+ catalog as of {date}"** timestamp, and a failed scheduled refresh surfaces a notice on next app open — NFR-4's "failures surface" bar holds even when nobody is watching the run.

### 4.4 Add-by-name

- **FR-41** — Search the third-party games DB by name, pick the right result, and review the pre-filled data (cover, genres, release date) — **everything is editable in that moment; nothing is committed until Save.** If the external search is unreachable or simply doesn't have the title, the user can still save a **name-only entry** (no cover, no genres, release date unknown = not released, FR-12); it lands in the stragglers list (FR-28) for later enrichment. **The discovery moment never depends on a third party being up.**
- **FR-42** — The search also matches the **existing library**: picking a game already tracked opens its detail view instead of creating a duplicate.
- **FR-43** — Defaults on save: not owned (= wishlisted, `wishlisted_on` recorded), status `Not started`. The "saw a game on my phone" moment: open app, type name, pick, save — seconds.

### 4.5 Lifecycle dates (v1 collects, later versions consume)

**FR-44** — Auto-recorded on every transition, never asked for: `wishlisted_on` (added while not owned), `bought_on` (owned flips true — via sync or manual flag), `started_on` (first transition to `Playing`), `completed_on` and `platinum_on` (§2 milestones). Seed-imported games only get the dates the CSV actually knows (FR-32). These can't be reconstructed later; capturing them is a v1 requirement even though nothing consumes them yet.

**FR-45** — **All lifecycle dates are write-once through automatic flows** — the first value stands, milestones-style: no sync, status change, or re-transition ever overwrites a recorded date (re-flagging `Owned` or re-entering the wishlist writes nothing). Like milestones (FR-6), they remain manually editable in the detail view — corrections are deliberate, overwrites are never automatic. `started_on` is written only while no completion milestone exists; replays never write it.

## 5. Platform, Auth & Quality Bars

### Form factor

- **FR-46** — **Installable PWA** — the wishlist moment lives on the phone; a home-screen icon is the shortest path to it. The desktop page is equally first-class (the cover-forward shelf is where the desktop shines). One responsive app, both surfaces.

### Auth & the multi-user seam

- **FR-47** — **better-auth with magic link** for v1; Google OAuth is v1.x.
- **FR-48** — Single user in practice, but all user-entered tracking data (status, milestones, dates, ownership overrides) is **scoped to a user id from day one**. No sharing, roles, or tenant isolation is built — the door to publishing is left unwelded, nothing more.

### Hosting & data

- **NFR-1** — **Free-tier hosting is a hard constraint.** The app is stateless; data lives in an externally managed database. Architecture picks the DB — free hosting outranks the SQLite preference.
- **NFR-2** — The PS+ Extra scheduled job (§4.3) must also fit the free tier.

### Quality bars

- **NFR-3** — **Nothing external on render:** covers and store links are served from persisted data; third-party APIs are hit only at import, sync, refresh, or add time.
- **NFR-4** — **Failures surface, never silently retry:** an expired PlayStation session cookie shows the refresh instructions (FR-36); a failed external lookup lands the game in the stragglers list.
- **FR-49** — **CSV export in v1:** the full library — games, statuses, milestones, lifecycle dates, genres, ownership — downloadable as CSV. Cheap insurance for data that can't be reconstructed; the DB provider's backups are not the only copy.

## 6. Later & Out of Scope

**v1 assumes a PS+ Extra subscription** (Luca's current tier). The tier setting below generalizes this later.

### v1.x — enriches a working app (next, not now)

- Trophy sync from PSN: completion % and a PSNProfiles-style letter grade (computable client-side once counts are synced).
- Critic and user scores from games-DB sources, stored and refreshed on a schedule.
- "Leaving PS+ Extra soon" warnings for backlog games.
- Google sign-in.

### Future — earns its way in later

- **PS+ subscription settings:** the user declares whether they have PS+ and the tier — *Essential* (no catalog: invite to sync / highlight when the three monthly games change), *Extra* (the default behavior v1 implements), *Premium* (Extra plus the premium-bracket catalog).
- Tunable play-next suggestions ("same genre" / "vary genre").
- Stats and dashboards over the lifecycle-date history.
- Sale detection + notifications for wishlisted games (mechanism sketch in the addendum).
- Possibly playtime and other platforms.

### Non-goals

- Multi-user support and public release — out for now, door open (§5 seam is the entire investment).
- Non-PlayStation platforms.
- Auto-adding PS+ catalog games to the library — availability is not ownership; catalog games leave.
- Automating anything Sony's API can't give reliably.
- **No gamification, ever** — XP, streaks, badges. The field tried it; it incentivized logging games nobody played.
- **No personal ratings** — the Notion `Rating` column is not imported and no rating field exists. (External critic/community scores remain a v1.x feature; that's different data.)

## 7. Open Questions

All architecture-time decisions; none block this PRD.

1. **Database** — free-tier candidates: Turso/libSQL, Cloudflare D1, Neon/Supabase Postgres, **Convex** (reactive backend-as-a-service; reputation for friendly pricing — evaluate alongside the SQL options). Re-verify free tiers at decision time.
2. **PS auth** — can the NPSSO-token path (psn-api's auth) replace or complement the fragile `pdccws_p` cookie for library and catalog queries?
3. **Games DB** — IGDB vs RAWG for add-by-name search, genres, covers, release dates.
4. **Scheduled job** — mechanism for the monthly PS+ Extra refresh within the stateless free tier (e.g. Cloudflare Cron Triggers).
5. **Score source** (v1.x concern) — RAWG (Metacritic) vs IGDB vs OpenCritic.
