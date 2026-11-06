---
title: PS Game Catalog PRD
status: final
created: 2026-07-05
updated: 2026-11-07
baseline: '3.6.0'
---

# PS Game Catalog — Product Requirements Document

## 1. Vision & Success

**PRESS START** replaces Luca's Notion record of his PlayStation gaming life: owned, wanted, playing, and finished. Seed the existing library once, then maintain it through manual additions and edits. Regional PS+ awareness, Stats, and explainable Play Next support purchase and play decisions.

> Current baseline: package `3.6.0`. The [approved PSN Account Safety decision](../../sprint-change-proposal-2026-07-15.md) removed credentialed automation. Historical v1 milestones are not the current scope; retired IDs remain reserved. Amendment history remains in the append-only decision log.

Originally a personal tool, the app now supports open verified-email registration and private user-scoped libraries. Phone capture at the moment of discovery and cover-forward desktop browsing remain first-class.

**Why build instead of adopt:** Luca wants a tool tailored to his gaming record and regional PS+ awareness. Trust in its data matters more than automatic completeness; manual upkeep is the accepted safety trade-off.

**The one metric that matters:** the Notion database gets archived and never reopened. That happens when:

1. The seeded library is trustworthy and deliberate manual additions keep new purchases and wishlist discoveries current; no automatic purchase detection is promised.
2. Logging a status change takes seconds, not a Notion-editing session.
3. The wishlist gets consulted before purchases — including the "already in PS+ Extra" check.
4. Filtering the backlog beats what Notion's views offered.
5. Choosing the next game takes one short, transparent Play Next visit; manual Shelf filtering remains available when Luca wants direct control.

**Counter-metric — how we'd know it's failing:** the app stops being consulted when deciding what to play next, or wishlist additions regress to occasional batches instead of happening at the moment of discovery. A tracker that's only mostly right slowly stops being consulted at all; trust is the real deliverable.

## 2. State Model

Everything the UI shows and filters derives from this model. The governing principle: **anything that can be computed is computed** — a manually set state can drift; a derived state is always right.

### Play status (the only user-set, mutable state)

`Not started` · `Up next` · `Playing` · `Paused` · `Dropped`

- **FR-1** — One per game. Defaults to `Not started`.
- **FR-2** — May be **null** once a completion milestone exists (and only then). Logging a **platinum** auto-clears the status to null; a **story completion** leaves the status untouched — play usually continues toward the platinum, so the game stays on the shelf. The user may also clear it manually (replay ends, etc.). A replay sets it back to `Playing`.
- **FR-3** — **Invariant: every game always has a play status or at least one completion milestone.** The detail view refuses any edit that would leave neither (clearing the last milestone requires setting a play status first).
- **FR-4** — `Dropped` games are hidden from the default shelf, reachable via the `Dropped` reveal pill, which shows **only** `Dropped` games (exclusive view, §3).

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

**FR-8** — Shelf ordering, labels, and filters use effective state. Platinum logging clears status, so the game leaves the default Shelf; a later replay can explicitly restore `Playing` while milestone dates remain unchanged.

### Ownership

- **FR-9** — `Owned` includes purchased and membership-acquired games. Seed or deliberate user edits establish ownership; `owned_via` distinguishes `purchase` from `membership`, separate from format. Opening a store/Claim link never proves acquisition. Claims never stamp `bought_on`. Cancelling membership un-owns membership rows while preserving purchases and recorded history.
- **FR-10 [RETIRED]** — Automatic sync ownership changes were withdrawn with FR-33..37. Preserve this ID; deliberate ownership editing remains FR-9.
- **FR-11** — Ownership format is `digital` or `physical`, independent of acquisition source. PS-export games default digital; manual ownership defaults physical when no format is supplied. Format is editable in detail.

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
- **FR-18** — Default ordering: `Playing` → `Up next` → `Paused` → `Not started`; **owned before wishlisted, then alphabetical by name, within each group**.
- **FR-19** — Infinite scroll and persistent Shelf title search. Without active filters, search includes the entire library and hidden states. With active filters, search narrows within them; visible scope text distinguishes the cases. Confirmed by Luca 2026-11-07.

### Filters

**FR-20** — Semantics: **OR within a group, AND across groups.**

| Group | UI | Members |
|---|---|---|
| State | Multiselect dropdown | `Not started`, `Up next`, `Playing`, `Paused` (live statuses only) |
| State reveals | Individual pills, **own group** | `Story completed`, `Platinum achieved`, `Dropped` — OR among themselves; any selection **replaces the State group entirely** (state selections clear) and shows only the matching hidden games; Genre and Flags still AND |
| Genre | Multiselect dropdown | All genres in the vocabulary |
| Flags | Individual pills, **each its own group (AND)** | `Owned`, `Wishlisted`, `Released`, `Playable now`, `PS+`, `Leaving soon` when applicable |
| Time to beat (VR-9) | Band choices + story/100% selector | `≤25h`, `25–50h`, `50–75h`, `75–100h`, `>100h`, `Unknown` — OR within group; missing selected metric matches only Unknown |

**FR-21** — Selection rules: with nothing selected in State or Reveals, the shelf shows the default visible set (all live statuses, FR-17). A State-dropdown selection shows **exactly** the selected live states. A reveal-pill selection is an **exclusive view**: only games in the selected hidden state(s), the State group cleared — "Completed games only" is a one-pill view that hides everything else. State dropdown and reveal pills are mutually exclusive; activating one clears the other.

**FR-22** — Active pills are visually highlighted (toggle-on state).

### Genre vocabulary

- **FR-23** — Library genre vocabulary originates in IGDB. Notion Category is dropped at import; unmatched games await enrichment rather than receiving invented genres. PS-store catalog facets are a separate vocabulary.
- **FR-24** — Adding a game whose genres don't exist yet auto-creates the genre rows.
- **FR-25** — Genres are editable per-game in the detail view (fix a bad auto-fill); a merge/rename tool is not v1.

## 4. Getting Games In

The library is seeded once, then maintained through add-by-name and user-initiated Catalog Add. Ingest preserves existing user-entered tracking data; deliberate edits are separate actions.

### 4.1 Seed import (one-time)

- **FR-26** — Import Notion and PS-library CSVs and enrich catalog facts through IGDB. Purchases and membership claims create owned records with acquisition source distinguished; only WEBMAF companion apps are excluded and counted. This follows the 2026-07-11 ownership amendment in [addendum](addendum.md#ownership-rationale).
- **FR-27** — **Title reconciliation** joins the two sources and the external DB: comparison is case-insensitive after stripping trademark glyphs (`™`, `®`), leading articles ("The …"), edition suffixes, and normalizing whitespace. PS4/PS5 duplicates collapse to one PS5 entry.
- **FR-28** — Import everything resolvable and expose unmatched/ambiguous rows in the in-app stragglers list. Unmatched owned PS games may remain as unenriched games. Manual resolution carries Notion status, dates, and ownership onto the match; no guessing or interactive seed-import UI.
- **FR-29** — A resolved manual match stores its external-ID link permanently for subsequent matching and duplicate prevention.
- **FR-30** — **Notion status mapping** onto the new model: `Completed` → status null + `completed_on` (from *Date finished*); `Up next!` → `Up next`; `Not released` → `Not started` (the release date carries that fact); `Not started`, `Playing`, `Paused` map 1:1. *Date started* → `started_on`. The *Rating* column is **not** imported (personal ratings are a non-goal, §6). Any row the mapping can't place — an unknown status value, or `Completed` without a *Date finished* — goes to the stragglers list instead of guessing.
- **FR-31** — The CSV's **`Owned` column is honored**: `Owned: Yes` games import as owned (ownership type physical by default, editable — these are exactly the discs and delisted titles the PS export won't contain), never as wishlisted.
- **FR-32** — **No fabricated history:** the import stamps only the dates it actually knows (*Date started*, *Date finished*); `bought_on` and `wishlisted_on` remain null for imported games.

### 4.2 PS library sync [RETIRED]

> FR-33..37 remain retired under the [approved 2026-07-15 safety decision](../../sprint-change-proposal-2026-07-15.md). Seed import remains; new games and ownership changes require deliberate user actions.

- **FR-33 [RETIRED]** — Button-triggered library sync removed; no replacement automated ownership writer.
- **FR-34 [RETIRED]** — Sync conflict handling removed with sync; shared identity and normalization rules remain architecture constraints for active import/add paths.
- **FR-35 [RETIRED]** — Sync-time metadata capture removed; active ingest/add still persists facts before rendering under NFR-3.
- **FR-36 [RETIRED]** — PSN credential storage and refresh UI removed. Runtime PSN traffic is anonymous store browsing only; no NPSSO/cookie exchange.
- **FR-37 [RETIRED]** — Library sync summary removed with the operation.

### 4.3 PS+ Extra check

- **FR-38** — Derive membership from the shared snapshot for the user's region, in both directions as catalog membership changes. Hide the PS+ indicator on owned games. Catalog availability never auto-adds a library record; regional departure history survives snapshot pruning.
- **FR-39** — Automatic per-region scheduled rotation and stale-snapshot recovery populate the catalog; no manual refresh button or route. Scheduling, quarantine, locking, and budget rules belong to architecture AD-28/31/32.
- **FR-40** — Show the last successful PS+ catalog timestamp and an updating state during refresh. Failed refreshes retain stored data and stale timestamp with operational logging; no user-action failure banner is required for this automatically recovered path.

### 4.4 Add-by-name

- **FR-41** — Search the third-party games DB by name, pick the right result, and review the pre-filled data (cover, genres, release date) — **everything is editable in that moment; nothing is committed until Save.** If the external search is unreachable or simply doesn't have the title, the user can still save a **name-only entry** (no cover, no genres, release date unknown = not released, FR-12); it lands in the stragglers list (FR-28) for later enrichment. **The discovery moment never depends on a third party being up.**
- **FR-42** — The search also matches the **existing library**: picking a game already tracked opens its detail view instead of creating a duplicate.
- **FR-43** — Defaults on save: not owned (= wishlisted, `wishlisted_on` recorded), status `Not started`. The "saw a game on my phone" moment: open app, type name, pick, save — seconds.

### 4.5 Lifecycle dates

**FR-44** — Capture `wishlisted_on` on non-owned add, `bought_on` on purchase acquisition only, `started_on` on first transition to Playing without a completion milestone, and completion/platinum dates on milestone logging. Membership claims never stamp purchase dates. Seed uses only known source dates (FR-32). These dates now feed Stats.

**FR-45** — **All lifecycle dates are write-once through automatic flows** — the first value stands, milestones-style: no import, status change, or re-transition ever overwrites a recorded date (re-flagging `Owned` or re-entering the wishlist writes nothing). Like milestones (FR-6), they remain manually editable in the detail view — corrections are deliberate, overwrites are never automatic. `started_on` is written only while no completion milestone exists; replays never write it.

## 5. Platform, Auth & Quality Bars

### Form factor

- **FR-46** — **Installable PWA** — the wishlist moment lives on the phone; a home-screen icon is the shortest path to it. The desktop page is equally first-class (the cover-forward shelf is where the desktop shines). One responsive app, both surfaces.

### Auth & the multi-user seam

- **FR-47** — better-auth magic link plus Google OAuth when configured. Registration is open; email control must be proven on creation and account linking. No password, admission list, roles, or sharing.
- **FR-48** — Every user-entered tracking record and setting is user-scoped. Shared catalog facts remain shared; PS+ membership/departure answers derive using the user's region. Separate tenant infrastructure is not required.

### Hosting & data

- **NFR-1** — **Free-tier hosting is a hard constraint.** The app is stateless; data lives in an externally managed database. Architecture picks the DB — free hosting outranks the SQLite preference.
- **NFR-2** — The PS+ Extra scheduled job (§4.3) must also fit the free tier.

### Quality bars

- **NFR-3** — Metadata read paths use persisted facts and make no external provider lookup. Images may load from persisted cover URLs; discovery, import, and scheduled refresh perform provider I/O.
- **NFR-4** — Failures preserve standing data and surface appropriately: lookup/enrichment failures remain resolvable; score-refresh failures show a notice; PS+ uses FR-40's passive timestamp/log posture. Bounded scheduled recovery is permitted; no credential-denial retry exists because credentialed PSN operations are removed.
- **NFR-5** — **Play Next is local and explainable:** recommendation derivation uses existing application data and deterministic client-side rules. No LLM, machine learning, external recommendation service, or persistent recommendation-preference/history data.
- **FR-49** — **CSV export:** the full library — games, statuses, milestones, lifecycle dates, genres, ownership — downloadable as CSV. Cheap insurance for data that can't be reconstructed; the DB provider's backups are not the only copy.

## 6. Delivered Extensions & Remaining Scope

Extra is the supported catalog tier. Selectable subscription tiers remain future scope.

### Delivered enrichment

- **Trophy automation withdrawn:** credentialed trophy retrieval/backfill and its display/schema were removed by Epic 11. Manual completion/platinum milestones remain supported. No credentialed revival path is authorized.
- **VR-5 — Reception:** persist IGDB critic/user scores with their counts; render stored facts and refresh in the background. Missing scores remain absent. Omitted or failed provider rows preserve standing values; valid explicit clears follow the provider field contract.
- **VR-8/VR-9 — Time to beat:** distinct IGDB story/100% estimates with submission count; store seconds, display hours. Never substitute one metric for the other or invent missing estimates. Shelf filtering follows FR-20. The existing scheduled refresh also updates release dates; explicit withdrawals return to TBA, omitted/failed rows retain standing dates.
- **VR-6 — Departure warnings:** anonymous regional sweep of tracked catalog products; eligible non-owned games show known leaving dates and Leaving soon filtering. Valid staying/null replies clear a prior date; failed replies retain prior data. No auto-added library games.
- Google sign-in is delivered under FR-47.

### Catalog browse & add (Epic 7, delivered)

The Catalog is a browsable regional dataset. Adds are user-initiated through FR-41/43; availability alone never creates tracking records.

- **FR-50** — The full per-region PS+ catalog is stored as a **first-class dataset** in its own table (not `game`/`game_tracking` rows — the no-auto-add non-goal holds), populated and pruned to a faithful snapshot by the §4.3 monthly refresh. **Tier-aware** (`Extra` now; `Premium` layers on via the subscription-settings item below) with no migration rewrite.
- **FR-51** — A **catalog destination** renders the stored catalog in a shelf-style, paged grid with a **genre filter and name search**, marking games already in the library (FR-42 dedup parity). Covers/genres come from the PS-store payload (NFR-3: stored, not fetched on render).
- **FR-52** — Adding a catalog game promotes it into the library via the §4.4 add preview (IGDB enrichment on demand, saves as wishlisted — FR-41/43); catalog membership immediately lights its PS+ flag. A **"Claim now"** deep-link opens the PS Store product page for the region so the user adds it to their PlayStation account themselves — **no direct in-app claim** (an undocumented authenticated write against the user's real account; out of scope).

### Choose what to play next (Epic 13, delivered)

Play Next is a standalone, transparent alternative to manual Shelf filtering (§3). It uses only facts already present in the Shelf payload and never changes the manual flow.

- **FR-53** — A standalone Play Next destination immediately presents up to three suggestions on each visit, with no required input. A small eligible pool produces an honest smaller slate or empty state; manual Shelf filtering is unchanged.
- **FR-54** — A candidate must have no known future release date and must not be `Playing`, `Platinum`, or `Dropped`. Known released and unknown/TBA release dates are eligible. Owned games and currently playable PS+ games are eligible. `Paused` and story-completed-but-not-platinumed games are eligible as **Finish them** candidates.
- **FR-55** — Missing enrichment never makes an otherwise eligible game ineligible. Missing facts contribute no score and produce no unsupported explanation.
- **FR-56** — Ranking is additive and inspectable: intent match, ownership/playability, `Up next` priority, PS+ departure urgency, backlog age, genre familiarity/variety, time-to-beat fit, confidence, and Finish them progress.
- **FR-57** — User may select at most one tag per intent group. Active groups form desired conjunctive match. Groups cover Genre, Length, Shelf age, Confidence, Priority, and Progress.
- **FR-58** — Editing intent does not replace current cards. **Show me 3** applies draft intent. Exact combined matches are preferred; when fewer than three exist, Play Next automatically returns closest matches and explicitly labels each relaxed result **Closest match**.
- **FR-59** — **Include wishlist** adds non-owned, non-PS+-playable wishlist games. Currently playable PS+ games remain eligible regardless of ownership and checkbox state.
- **FR-60** — Default **Surprise me** creates a varied slate. Finish them candidates participate but occupy at most one default card. Selecting Finish them removes that cap and prioritizes those candidates.
- **FR-61** — Every suggestion explains itself with a primary reason/category and known supporting facts. Supported labels include `Familiar`, `Different`, `Quick win`, `Fresh`, `Forgotten`, `Safe bet`, `Wildcard`, `Follow my list`, `Last chance`, `Finish them`, `Available now`, and `Discover`.
- **FR-62** — **Shuffle** uses applied intent and excludes every game already shown during the visit. If only one or two unseen matches remain, it shows the smaller slate and warns that the next Shuffle refreshes the pool. Pool reset still excludes currently visible games. Visit state is not persisted after leaving Play Next.
- **FR-63** — User can **Open details** without losing Play Next visit state or choose **Play this**, which uses existing lifecycle behavior to set `Playing` and returns to Shelf.

### Stats & account controls (delivered)

| ID | Requirement | Detailed contract |
|---|---|---|
| FR-64 | Stats shows all-time tracked/owned/completed/platinum recap, selected-year lifecycle totals, monthly activity, and genre breakdown from the user's library; invalid/missing dates invent no history. | [Experience spine](../../ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md) |
| FR-65 | Per-user nonempty PlayStation platform selection limits interactive external title searches; default PS1–PS5, optional PSP/PS Vita/PSVR 1/PSVR 2. Existing rows and scheduled by-ID refresh remain unfiltered. | [Platform contract](../../../implementation-artifacts/spec-igdb-playstation-platform-filter.md) |
| FR-66 | Confirmed, email-verified permanent account deletion removes private data/session rows, retains shared facts/other users, clears caller caches, and preserves data on invalid links or failures; five-minute verification and signed-cookie-cache limits apply. | [Deletion contract](../../../implementation-artifacts/spec-permanent-account-deletion.md) |

### Future — earns its way in later

- **PS+ subscription tiers:** selectable Essential/Premium behavior remains future. Extra is the supported catalog tier; a tier-capable schema alone does not deliver tier selection.
- Sale detection + notifications for wishlisted games (mechanism sketch in the addendum).
- Personal playtime tracking remains future; non-PlayStation tracking stays outside current scope.

### Non-goals

- Roles, sharing, or separate tenant infrastructure; open registration/private multi-user libraries are delivered under FR-47/48.
- Non-PlayStation platforms.
- Auto-adding PS+ catalog games to the library — availability is not ownership; catalog games leave.
- Automating anything Sony's API can't give reliably.
- **No gamification, ever** — XP, streaks, or reward badges. Factual completion indicators remain milestones.
- **No personal ratings** — Notion Rating is not imported and no personal rating field exists. External reception scores are distinct delivered data.

## 7. Resolved Technical Choices

Architecture owns the implementation decisions: Cloudflare Worker/D1/Cron, IGDB for metadata/scores/time-to-beat, and anonymous-only PS Store access. Credentialed PSN auth is retired. Exact invariants and current delivery workflow live in the [architecture spine](../../architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md); provider alternatives are not unresolved implementation invitations.
