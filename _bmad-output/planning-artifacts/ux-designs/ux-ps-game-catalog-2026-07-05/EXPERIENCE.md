---
name: PRESS START
status: final
updated: 2026-11-07
sources:
  - ../../briefs/brief-ps-game-catalog-2026-07-04/brief.md
  - ../../prds/prd-ps-game-catalog-2026-07-05/prd.md
---

# PRESS START — Experience Spine

> How the app *works*: information architecture, behavior, states, interactions, accessibility, and journeys. Visual identity is the paired `DESIGN.md` — this spine references its tokens as `{path.to.token}`. Both spines win on conflict with any mock. FR/NFR references point at the PRD (`prd-ps-game-catalog-2026-07-05`).

## Foundation

**Installable PWA — one responsive app, four first-class destinations.** The phone is where the "saw a game, want it" moment lives (a home-screen icon is the shortest path to it, FR-46); the desktop is where the cover-forward shelf shines. Not two builds — one responsive app with device-specific *deltas* (see Responsive & Platform).

- **Four destinations.** **Shelf** is home; **Play Next** narrows what to play; **Catalog** browses PS+; **Stats** is the player record. Everything else surfaces *over* the active destination — modals, popovers, banners. Navigation is the URL (`/`, `/play-next`, `/catalog`, `/stats`, `/game/:id`), owned by react-router; a destination is never a window event (ARCHITECTURE-SPINE AD-25).
- **Separate personal accounts.** Tracking and settings are scoped to the signed-in user; no sharing or roles. Sign in with **better-auth magic link or Google**; verified-email registration is open. No passwords.
- **No named UI system.** Components are custom (React/Bun target); `DESIGN.md` is the visual reference. **Dark-only** — no light theme in v1.
- **Nothing external on render** (NFR-3): covers and store links come from persisted data; third-party APIs are hit at import, refresh, or add time. Interactive failures surface; automatic PS+ refresh failures are passive (AD-31) — see State Patterns.

## Information Architecture

Four destinations, switched by a **header toggle**; everything else hangs off whichever one is active. Search is the Shelf/Catalog action surface; Settings owns account, region, IGDB platform selection, subscription claims, and backup actions. Anything needing attention appears in the **attention banner** under the header.

| Surface | Reached from | Purpose |
|---|---|---|
| **The Shelf** (`/`) | App open · header toggle | Cover grid, filters, search, infinite scroll — "what's my gaming life right now?" |
| **Play Next** (`/play-next`) | Header toggle | Three explained suggestions, tuning, and Shuffle — "what should I play?" |
| **The Catalog** (`/catalog`) | Header toggle | The whole ~490-game PS+ Extra catalog: cover grid, genre filter, name search — "what can I play that I'm already paying for?" |
| **Stats** (`/stats`) | Header toggle | All-time cabinet recap plus a selected-year activity, milestone, and genre breakdown |
| **Detail** | Tap a cover (flip-then-grow) | Read/edit one game: status, milestones, lifecycle dates, genres, ownership, store link |
| **Status popover** | Tap a card's status pill | Change play status (instant) or log a milestone (confirm-gated) — no flip |
| **Add preview** | Search → `＋ Add "<name>"` | Review games-DB data, edit, save |
| **Stragglers** | Attention banner | Resolve unmatched import titles by search |
| **Settings** | Header gear | PlayStation region, IGDB platforms, PS+ claims, CSV backup, About/Help, account deletion |
| **Login** | Cold, unauthenticated | Magic-link or Google sign-in |

- **Header toggle (`SHELF | PLAY NEXT | CATALOG | STATS`).** A segmented control in the header, all labels always visible, one tap between destinations. Same control on phone and desktop. Play Next is a standalone `/play-next` destination; it does not add a Shelf panel or completion prompt.
- **The search bar belongs to the active destination.** One box in the header, but it searches **what you're looking at**: the library on the Shelf, the catalog on the Catalog. The term **clears when you switch** — a shelf search never silently filters the catalog (AD-25). The `＋ Add "<name>"` row is **Shelf-only**: on the Catalog, a name that isn't in the catalog simply has no match, because you cannot conjure a game into Sony's catalog by typing it. Search is hidden on Play Next and Stats.
- **No catalog detail surface.** Catalog cards carry their two actions inline (`＋ Add`, `Claim now`) and there is **no read-only catalog detail page**. The Add path already opens the **add preview** — IGDB-enriched, with the "Not the right game?" picker — which *is* the confirm-before-committing surface; a read-only detail in front of it would duplicate that decision and be the one screen in the app where tapping a cover doesn't flip it into something editable. After a successful add, the app lands on the game's **real, editable detail** (`/game/:id`) — the usual detail screen, at the moment it starts being true. *(Revisit only if browsing proves to need more than cover + title to decide.)*
- **Search-as-add (the hero path).** Shelf search is the sole name-based Add entry point. Search filters the visible grid; an existing card opens detail. A pinned `＋ Add "<name>"` action remains reachable for every non-empty term, even when matches exist; duplicate detection opens the existing game instead of duplicating it. With **no active filters**, search spans the whole library, including hidden states. With **active filters**, search narrows within them. The scope caption states which applies (user-confirmed 2026-11-07).
- **No FAB.** The one surviving chore, CSV export, lives in Settings as `DATA BACKUP / Keep your own copy`. The app mounts no hidden or empty launcher shell on Shelf, Play Next, Catalog, or Stats.
- **Stats reading order.** On phone: title → all-time recap cards → native `CURRENT ROUND` select → selected-year round log and panels. Desktop keeps the same semantics while placing the select beside the title and the recap below.
- **Attention banner.** A single under-header zone, shown only when action is needed, persistent until cleared: stragglers and other actionable feature failures. No PlayStation credential controls, sync action, expired-cookie notice, manual PS+ refresh button, or PS+ failure banner remains.
- **No seed-import UI.** The one-time Notion+PS seed is run out-of-band; zero UI surface.

→ Composition references: `wireframes/ia-shell-wireframe.html`, `mockups/card-flip-prototype.html`, `mockups/filter-row-wireframe.html`, `mockups/state-feedback-board.html`, `mockups/add-stragglers-flow.html`, `mockups/settings-login-mock.html`. These are historical composition references; their FAB, credential/sync, export, handedness, and search-dropdown details no longer govern. Spine wins on conflict.

## Voice and Tone

Microcopy. Brand voice and the arcade posture live in `DESIGN.md.Brand & Style`. Dial: **light** — flavour in headers, plain everywhere else.

| Do | Don't |
|---|---|
| `INSERT GAMES` / `NO MATCH` (empty-state headers) | Cute headers on functional surfaces |
| "3 games couldn't be matched — resolve" | "Oops! Something went wrong 😬" |
| "The catalog updates automatically — check back soon" | "Auth error 401" |
| "Add to wishlist" / "Add as owned" (CTA states the outcome) | A generic "Save" that hides where the game lands |
| "browse the PlayStation Plus catalog" (descriptive) | "PlayStation Library" as branding |
| Plain, complete sentences; mono for counts/dates | XP, streaks, badges, encouragement, ratings language |

## Component Patterns

Behavioral rules; visual specs live in `DESIGN.md.Components`.

| Component | Behavioral rules |
|---|---|
| **Card** | Cover art is the flip target. **Display-only indicators (top-left cluster):** PS+ Extra flag (in-catalog & not owned), release-state flag (`TBA`/upcoming date until released, per FR-15), milestone badge (silver, persists regardless of play status). **Interactive overlay:** owned toggle (top-right, reversible; owning a catalog game asks Purchased versus Claimed with PS+). Tapping any non-control area of the cover flips. Info strip below: name, status pill, genres (desktop only). |
| **Status pill** | Shows *effective state*. Tap → popover: 5 play statuses (instant, no confirm — freely mutable) + "Story completed" / "Platinum achieved" rows. Selecting a milestone opens the **confirm modal** (FR-7). |
| **Detail (flip)** | Tap cover → flip-then-grow. Holds: play-status segmented control, milestone rows + dates, lifecycle dates (auto-recorded, editable here only — FR-44/45), genres (editable, FR-25), ownership flag+type, and "View on PS Store" for wishlisted games. Enforces the FR-3 invariant: refuses any edit leaving neither a play status nor a milestone. |
| **Filter row** | Groups: State (multiselect dropdown), Genre (multiselect dropdown), Time (multiselect dropdown, added 2026-07-16 Story 12.1: five half-open TTB hour bands ≤25/25–50/50–75/75–100/>100 + explicit Unknown, story/100% metric toggle pinned at the menu top — default story, filter state not a global setting; a null selected metric matches only Unknown), Flags (solid toggle pills), State-reveals (dashed pills — own group, amended 2026-07-10: an active reveal replaces the State group and shows only the matching hidden games; reveals OR among themselves, Genre/Flags still AND). State, Genre, and Time selections OR within each group; each active flag ANDs individually; groups AND together. A **live plain-English summary sentence** narrates the active filter so the model never needs decoding (OR-connectors in {colors.accent-glow}, AND-connectors in {colors.heat-magenta}). Active pills glow (FR-22). |
| **Settings backup** | Native button fetches `/api/export.csv`, downloads only a successful response as `press-start-library.csv`, shows `Exporting…` while pending, and toasts on failure without saving the error body. |
| **Attention banner / Toast / Summary modal / Confirm modal** | See State Patterns. |
| **Search bar** | Persistent. **Scoped to the active destination** (library on the Shelf, catalog on the Catalog); the term clears on switch. On the Shelf: whole-library search without active filters, within-filter search otherwise; matches render in the grid and the pinned `＋ Add` action remains available for every non-empty term. On the Catalog: narrows the grid (case-insensitive substring, small debounce); no match → `NO MATCH`, never an Add row. |
| **Catalog card** | Cover-forward, **shelf card chrome reused** — but it is *not* a shelf card: **no status pill, no owned toggle, no flip**, because a catalog game isn't a tracked game. (The shelf's status pill shows *play state* — a tracked-game concept. It must never appear here.) Displays: cover, title, the `◈ PS+` membership flag, and **no release date** (the store payload has none). The whole catalog renders, tracked games included — hiding what you already have would just read as a missing game. **Three states, keyed on what you can still do:** ① **not tracked** → `＋ Add` + `Claim now`; ② **tracked but not owned** (added from the catalog — `owned:false`, i.e. a wishlist entry that is also Playable-now when released) → **`In library`** marker (cyan) **+ `Claim now`, which is still live** — it's on your shelf, but you haven't claimed it to your PlayStation account; ③ **owned** (bought or manually marked as claimed with `owned_via: membership`) → **`Owned`** marker (silver), **no actions**. Dropping `Claim now` at state ② would strand exactly the games the catalog just added. The app never infers a successful claim — it cannot see the PS Store tab; ownership is recorded manually through the buy-versus-claim choice (Epic 11). |
| **Catalog ordering** | Alphabetical with no state or ownership tier. SQL paging is authoritative: `ORDER BY title_normalized, product_id`; the former in-memory `localeCompare` rule is retired ([Story 8.6](../../../implementation-artifacts/spec-8-6-free-tier-read-budget-hardening.md)). Tracked games retain their place and marker. |
| **Catalog genre filter** | Multiselect over the **PS-store genre vocabulary** (the store's own facet keys, ~19) — **not** the shelf's IGDB genres; the two vocabularies never mix (AD-26). Localized names shown. OR within the group. **No state/ownership/flag filters** — those describe tracked games, which these aren't. |

**Game facts.** Shelf/detail show known critic/user scores and story/100% time-to-beat; absent facts leave no reserved blank rows. Departure warnings appear on cards and detail/catalog where known. Approved presentation: [stacked facts](../../../implementation-artifacts/spec-card-info-compact-stacked-scores.md), [departure placement](../../../implementation-artifacts/spec-leaving-ui-placement-fixes.md), and [detail/catalog departure date](../../../implementation-artifacts/spec-leaving-date-detail-catalog.md).

**Settings extensions.** IGDB platforms sits after region and filters interactive title searches; existing library rows stay visible. Account is the final Settings section: confirm → email deletion link → verify with the same signed-in account → permanent deletion and Login. Exact controls, defaults, failure cases, accessibility, and security semantics remain in the approved [platform selection contract](../../../implementation-artifacts/spec-igdb-playstation-platform-filter.md) and [account deletion contract](../../../implementation-artifacts/spec-permanent-account-deletion.md).

## State Patterns

**The state model (drives the whole shelf).** *(Mirrors PRD §2, which is the source of truth; restated here as the behavioral contract the UI is built against.)*

- **Play status** (only user-set mutable state): Not started · Up next · Playing · Paused · Dropped. One per game; may be null once a milestone exists (FR-1/2). Dropped is hidden from the default shelf (FR-4).
- **Milestones = dates, not statuses:** `completed_on` / `platinum_on`. Immutable through normal flows; editable only in detail; confirm-gated (FR-5/6/7).
- **Effective state (FR-8):** play status if set, else Platinum if platinum_on, else Story completed if completed_on. Ordering, card pills, and filters all operate on effective state.
- **Default visible set:** live play status only. Completed / Platinum / Dropped are hidden by default; a reveal pill switches to an exclusive view of just those games (FR-17/21, amended 2026-07-10 — was: ORed back into the default set, which buried them behind the infinite scroll). Default order: Playing → Up next → Paused → Not started, owned-then-alphabetical within each (FR-18, ownership tier 2026-07-09).
- **Derived (never stored):** Released, Wishlisted (= not owned), Playable now (owned-or-PS+Extra AND released) — FR-12/13/14. "Anything that can be computed is computed."
- **A game added from the Catalog** is **not owned** (browsing is not claiming), so it derives as **Wishlisted** and, when released, **Playable-now** — which is exactly the Flow-2 signal: *I want this, and the subscription already covers it, so don't buy it.* Claiming it on PlayStation makes it **owned** (`owned_via: membership`, FR-9 amended) — through the **manual buy-versus-claim ownership choice**, never because the store tab was opened. Purchases stamp `bought_on`; membership claims do not.

**Feedback channels.**

| Channel | Job | Blocking | Notes |
|---|---|---|---|
| **Toast** | quick confirmation | no, ~3s auto-dismiss | status change / add / milestone-logged. Reversible risky actions (mark Dropped, un-own) carry a one-tap **UNDO**. Milestones need no undo (already confirm-gated). |
| **Summary modal** | report a user-triggered long op | yes, dismiss | Used only by supported user-triggered batch operations; credentialed sync/import and manual PS+ check UI are retired. |
| **Attention banner** | persistent needs-action | no | stragglers / other actionable feature failures. Self-clears when resolved. Automatic PS+ failures do not enter this channel. |
| **Loading** | work in flight | — | cover-shaped skeleton on first load; inline progress bar for long ops. |

**Feedback rule:** interactive actions expose pending, success, and failure states through their owning controls, toast, or supported summary. Automatic regional PS+ refresh preserves available data, shows freshness and `updating…` beside the as-of timestamp, and logs failures passively. It never asks the user to repair Sony credentials.

**Empty states.** No filter match → `NO MATCH` + "Clear filters". Empty library (fresh/edge) → `INSERT GAMES` + "＋ Add a game". Search no-library-match → the `＋ Add` path (not a dead end).

**Catalog empty / needs-refresh** (never a blank grid, NFR-4). Three distinct causes, three distinct answers — the surface must not collapse them into one shrug:

| Cause | What shows |
|---|---|
| **No region set** | `NO REGION` — "Set your PlayStation region to see the catalog" + a button into Settings. The catalog is per-region; without one there is nothing to show. |
| **Region set, never refreshed** | `EMPTY CATALOG` while the automatic refresh path populates the region snapshot; no manual FAB action exists. |
| **Last refresh failed** | Keep the last available grid and as-of date. Failure is passive; no failed-refresh banner or manual check action. |

**Catalog refresh** is automatic per region, through scheduled rotation and the stale-snapshot guard (AD-31); `PS+ catalog updating…` appears beside the as-of timestamp while refreshing. **Catalog freshness** reuses the header readout: `PS+ CATALOG AS OF <date>` (Story 5.3) — the same timestamp, now doing double duty for the destination it describes.

## Interaction Primitives

- **Tap** to act. The cover flips; overlaid controls (status pill, owned toggle) act in place.
- **Flip-then-grow** is the one signature gesture — identical on both surfaces (desktop caps at a centered panel; mobile goes full-screen).
- **Popover** off the status pill for inline state changes; positions against the pill, closes on outside tap / scroll.
- **Confirm gate** for logging milestones (FR-7); ownership-source choice for ambiguous catalog ownership; account deletion uses its approved email-verification flow. **Undo** for reversible risky actions (Dropped, un-own).
- **Infinite scroll** on the shelf (FR-19). Search spans hidden states only when no filters are active; otherwise it respects active filters.
- **Banned:** gamification of any kind — XP, streaks, reward badges ("the field tried it; it incentivized logging games nobody played"). No personal ratings field. No auto-adding PS+ catalog games ("availability is not ownership").

## Accessibility Floor

Behavioral; visual contrast lives in `DESIGN.md`.

- **Keyboard:** every action reachable and operable by keyboard — shelf is a focusable grid (arrow traversal in reading order), pills/toggles are buttons, the detail is a focus-trapped dialog that returns focus to its originating card on close. The search bar takes a global focus shortcut.
- **Focus indicator:** the {colors.accent-glow} halo doubles as a visible focus ring — but focus must be a **distinct, always-on outline**, never conveyed by glow-intensity alone.
- **Icon-only controls carry labels:** the owned toggle, flag icons, status pill, Settings control, and other icon-only buttons expose accessible names + state (e.g. "Owned, on"; "Playing — change status"). Status/milestone changes and toasts announce via a polite live region.
- **Contrast:** neon-on-void text and pill labels must meet WCAG AA (≥4.5:1 body, ≥3:1 large/UI); the muted text tone is floored per `DESIGN.md` (`{colors.text-muted}`). Status pills use a **translucent tint with light ink**, and solid active pills use **dark ink on neon** — never white-on-neon.
- **No color-alone signaling:** the **text status pill is the status indicator on every surface** — the dot-only treatment sketched in the early IA/filter wireframes is *superseded* and must not ship. Milestones also carry a badge *shape*; the filter summary's OR/AND coloring is redundant to the literal words "or"/"and".
- **Reduced motion (`prefers-reduced-motion`):** replace flip-then-grow with a fast cross-fade/scale; drop glow *pulses* and the skeleton shimmer (show a static placeholder). This also relieves the perceived flip sluggishness. Static neon stays; motion is what's cut.
- **Touch/hit targets ≥ 44×44** — decoupled from visual size: compact controls (status pill, owned toggle, flag icons, popover rows, sheet chips) keep their small look but carry a ≥44px hit-area via padding or an invisible expander. (The mobile status *dot* was rejected partly for this.)
- **Destination toggle semantics:** the header control is a **tab list** (`role=tablist`, each destination a `tab` with `aria-selected`) — left/right arrows move between them, the active destination is announced, and it is never signalled by glow alone (the active tab carries a solid fill + label weight). A route change moves focus to the destination's heading, so a keyboard or screen-reader user isn't stranded at the top of a grid they didn't ask for.
- **Catalog card actions:** `＋ Add` and `Claim now` are real buttons with accessible names that include the game ("Add Crow Country to library", "Claim Crow Country on the PlayStation Store"), not two bare icons repeated 490 times. `Claim now` opens a new tab — say so in the name. The already-in-library marker is **text**, not a color state.
- **Menu & search semantics:** the status **popover** is a menu — `aria-haspopup`/`aria-expanded` on the pill, arrow-key traversal between rows, Escape closes and returns focus to the pill. The **search bar** is a labeled native search input; results stay in the grid, with scope/result-count announcements and a separate keyboard-operable Shelf Add button. No results-list combobox remains.

## Responsive & Platform

One responsive app; deltas by surface:

| Concern | Phone | Desktop |
|---|---|---|
| Card | **Lean** — 2-up grid, genres hidden, name + status pill below cover | **Dense** — auto-fill grid, name + pill + genres below cover |
| Filters | Single **Filters** button + count badge → bottom sheet (grouped, logic-labeled, "Show N games") | Full filter row always visible; summary sentence inline |
| Stats overview | Title → recap → year select → selected-year content | Year select beside title; recap spans below |
| Detail | True full-screen | Centered ~760px panel |
| Header readout | Compact ("175 · 52 OWNED") | Full (`PS+ CATALOG AS OF …` timestamp) |
| **Destination toggle** | Full-width four-segment control on its own row under the wordmark | Inline in the header, beside the wordmark |
| **Play Next** | Portrait-card grid below 695px; collapsible `TUNE THE PICKS`; `Show me 3` applies changed draft | Compact command rows at 695–1023px; full five-column command rows at ≥1024px; tuning and Shuffle preserve existing order |
| **Catalog grid** | 2-up, same lean card as the shelf | Auto-fill, same dense card as the shelf |
| **Catalog filters** | The existing **Filters** bottom sheet — genre group only | Inline genre dropdown in the filter row |

**Catalog paging.** ~490 games is well past what a phone should render at once: the grid **virtualizes / pages** (same infinite scroll as the shelf) — never a 490-card DOM.

**PWA:** installable, home-screen icon (the wishlist moment). **Offline:** no offline requirement; when the games DB is unreachable, add-by-name falls back to a name-only entry that lands in stragglers to enrich later (FR-41).

## Inspiration & Anti-patterns

- **Lifted from Steam Big Picture** ("Recent Games" shelf): covers carry the screen; chrome recedes.
- **Lifted from the current Notion gallery:** data density on the card (cover, genre tags, status, owned) — refined, not reinvented.
- **Rejected — gamification (streaks/XP/badges):** actively incentivizes logging games nobody plays. Never, per the brief.
- **Rejected — personal ratings:** no rating field exists; the Notion `Rating` column is not imported.
- **Rejected — auto-adding PS+ catalog games:** availability is not ownership; catalog games leave. PS+ Extra is a *flag*, never an ownership or auto-add trigger. **Epic 7 makes this tempting** — the whole catalog is now sitting in the database, and "just show all 490 on the shelf" is one join away. The Catalog is a *destination you visit*, not games you own; the shelf stays your library.
- **Rejected — a read-only catalog detail page** (2026-07-14): the add preview already confirms the game before you commit; a second read-only surface in front of it duplicates the decision and teaches a cover-tap that doesn't flip.

## Key Flows

Single protagonist: **Luca**, the owner. Success has one metric — *the Notion database gets archived and never reopened.*

### Flow 1 — The wishlist moment (Luca, in a shop, phone out)
1. He sees a game on a shelf, opens the PRESS START home-screen icon.
2. Taps the persistent search bar, types the name.
3. No library match → taps `＋ Add "<name>"`.
4. Preview appears, games-DB data pre-filled; he leaves Owned off.
5. Taps **Add to wishlist** (the CTA names the outcome).
6. **Climax:** a toast confirms; the game is captured in the seconds the moment lasted — wishlist amnesia doesn't get to happen.
   *Failure:* games DB unreachable → "Add by name only" saves a stub into stragglers to enrich later.

### Flow 2 — Pre-purchase check (Luca, before spending money)
1. Searches or filters to the game.
2. One glance at the card: is it **Released**, and does the **Playable now** flag show (already covered by PS+ Extra)?
3. **Climax:** he decides not to buy a game he can already play with his subscription — the blind spot on PS+ Extra is closed.

### Flow 3 — What next? (Luca, just finished a game)
1. Opens the shelf (defaults to the backlog).
2. Taps **Filters**; on desktop, the row is already there.
3. Selects Owned + a genre; the **summary sentence** reads back exactly what he'll see.
4. **Climax:** the shelf narrows to a handful of owned games in the mood he wants — the manual Notion backlog-filtering he used to do, beaten. He starts one and taps its status to **Playing** right from the shelf.

### Flow 7 — Play Next (Luca wants the app to narrow the decision)
1. Opens **PLAY NEXT**. Search is hidden and focus enters the `WHAT NEXT?` heading.
2. Three varied **Surprise me** cards appear immediately; no question or setup blocks the first slate.
3. Each card names one primary reason, access where useful, known supporting facts, and any `Closest match` relaxation.
4. He may open details, choose **Play this**, or tune one choice per group and deliberately press **Show me 3**. Draft controls never replace visible cards before that press.
5. **Shuffle** uses applied intent, does not repeat any game already shown this visit, and refreshes Surprise me too.
6. If only one or two unseen matches remain, the smaller slate appears with `You’ve seen every other match. Next Shuffle starts a fresh pool.` The following Shuffle resets the pool but still excludes visible cards.
7. **Climax:** Play this sets the game to `Playing` and returns to Shelf, removing the selection burden without hiding why the game was chosen.

**Play Next intent groups:** Genre (`Familiar` / `Different`), Length (`Quick win`), Shelf age (`Fresh` / `Forgotten`), Confidence (`Safe bet` / `Wildcard`), Priority (`Follow my list` / `Last chance`), Progress (`Finish them`), plus `Include wishlist`. Choices are mutually exclusive within a group; applied groups form the desired AND match. Exact matches lead; automatic fallback is explicit.

**Finish them:** Paused and story-completed-but-not-platinumed games participate in Surprise me, clearly tagged and capped at one card. Explicit Finish them intent lifts the cap. Playing, Platinum, and Dropped never appear.

**Implementation gate:** every story changing UI presents an implementation-specific mock and records Luca's approval immediately before UI code begins. This behavioral spine is not final visual approval.

### Flow 4 — Did I ever finish that? (Luca, months later)
1. Types a title into the search bar.
2. Clears active filters if needed; search now spans the whole library, including hidden states, and finds it.
3. **Climax:** the card shows a silver **Platinum** badge — answered instantly, without hunting.

### Flow 6 — What am I already paying for? (Luca, Sunday, nothing to play) — *Epic 7*
1. Shelf says backlog; nothing on it appeals. He taps **CATALOG** in the header.
2. The full PS+ Extra catalog loads, cover-forward — 490 games he's already paying for. The header reads `PS+ CATALOG AS OF 14 JUL`.
3. He filters to **Horror** (the store's own genre), and types "quiet" in the search bar — scoped to the catalog, not his library.
4. A card shows the cyan **In library** marker — he already tracks that one. The others offer `＋ Add`.
5. He taps `＋ Add` on *A Quiet Place: The Road Ahead*. The add preview opens, IGDB data pre-filled; he saves.
6. **Climax:** the app lands on the game's detail — on his shelf, **Playable now**, and still on the wishlist he never has to act on, because the subscription already covers it. The blind spot Epic 5 only *flagged* is now a place he can browse.
   *Alternative:* he taps **Claim now** instead and the PS Store opens to add it to his account.

### Flow 5 — Logging a milestone (Luca, credits rolling)
1. On the shelf, taps the game's status pill.
2. In the popover, taps **Platinum achieved**.
3. The **confirm modal** guards against a fat-finger; he confirms.
4. **Climax:** the cover gains its silver badge and the date is written — the record is trustworthy, which is the real deliverable.

### Flow 8 — Read the player record (Luca, reviewing his year)
1. Opens **STATS**; search is hidden.
2. Reads the all-time recap, then chooses a year with `CURRENT ROUND`.
3. **Climax:** selected-year activity, milestone, and genre panels explain the record without changing his library. Loading, empty, and error states remain on Stats.

### Flow 9 — Keep account settings accurate (Luca, maintaining his library)
1. Opens Settings; updates region or IGDB platforms and saves.
2. The platform selection constrains subsequent add/rematch/straggler title searches; existing games remain visible. Save errors preserve the selection and expose retry.
3. **Climax:** new matches reflect his chosen PlayStation releases without changing his saved library.
4. If leaving the service, he may export CSV, then use Account's deletion flow: confirm, receive email, and verify with the same signed-in account. Only successful verification deletes private data and returns him to Login; cancellation and failed verification preserve it. See the linked deletion contract for exact failure and security rules.
