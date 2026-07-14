---
name: PRESS START
status: final
updated: 2026-07-14
sources:
  - ../../briefs/brief-ps-game-catalog-2026-07-04/brief.md
  - ../../prds/prd-ps-game-catalog-2026-07-05/prd.md
---

# PRESS START — Experience Spine

> How the app *works*: information architecture, behavior, states, interactions, accessibility, and journeys. Visual identity is the paired `DESIGN.md` — this spine references its tokens as `{path.to.token}`. Both spines win on conflict with any mock. FR/NFR references point at the PRD (`prd-ps-game-catalog-2026-07-05`).

## Foundation

**Installable PWA — one responsive app, two first-class surfaces.** The phone is where the "saw a game, want it" moment lives (a home-screen icon is the shortest path to it, FR-46); the desktop is where the cover-forward shelf shines. Not two builds — one responsive app with device-specific *deltas* (see Responsive & Platform).

- **Two destinations** (amended 2026-07-14, Epic 7 — was "single screen"). The **Shelf** is home and the face of the product; the **Catalog** is the one other place you can *be*. Everything else still surfaces *over* the active destination — modals, popovers, the banner. Navigation is the URL (`/`, `/catalog`, `/game/:id`), owned by react-router; a destination is never a window event (ARCHITECTURE-SPINE AD-25).
- **Single-user, seam only.** All tracking data is scoped to a user id from day one, but no sharing/roles/tenancy is built (FR-48). Auth is a **better-auth magic link** (FR-47), no passwords.
- **No named UI system.** Components are custom (React/Bun target); `DESIGN.md` is the visual reference. **Dark-only** — no light theme in v1.
- **Nothing external on render** (NFR-3): covers and store links come from persisted data; third-party APIs are hit only at import, sync, refresh, or add time. **Failures surface, never silently retry** (NFR-4) — see State Patterns.

## Information Architecture

Two destinations, switched by a **header toggle**; everything else hangs off whichever one is active. Two homes for actions: the **persistent search bar** (find-or-add) and the **FAB drawer** (deliberate chores). Anything needing attention appears in the **attention banner** under the header.

| Surface | Reached from | Purpose |
|---|---|---|
| **The Shelf** (`/`) | App open · header toggle | Cover grid, filters, search, infinite scroll — "what's my gaming life right now?" |
| **The Catalog** (`/catalog`) | Header toggle | The whole ~490-game PS+ Extra catalog: cover grid, genre filter, name search — "what can I play that I'm already paying for?" |
| **Detail** | Tap a cover (flip-then-grow) | Read/edit one game: status, milestones, lifecycle dates, genres, ownership, store link |
| **Status popover** | Tap a card's status pill | Change play status (instant) or log a milestone (confirm-gated) — no flip |
| **Add preview** | Search → `＋ Add "<name>"` | Review games-DB data, edit, save |
| **Stragglers** | Attention banner | Resolve unmatched import titles by search |
| **Sync / PS+ summary** | FAB → run → resolves | Post-op readout (counts + needs-attention) |
| **Settings** | FAB → gear | Session cookie, FAB handedness, About/Sign out |
| **Login** | Cold, unauthenticated | Magic-link sign-in (first run only) |

- **Header toggle (`SHELF | CATALOG`).** A segmented control in the header, both labels always visible, one tap either way — the catalog is never a thing you have to remember exists. Same control on phone and desktop. *(Chosen over a FAB drawer item and a phone bottom-nav — see `mockups/catalog-nav-options.html`; the drawer's promise is "run a chore, land back on the shelf", and a bottom bar would collide with the FAB and the pinned search bar in the same thumb strip.)*
- **The search bar belongs to the active destination.** One box in the header, but it searches **what you're looking at**: the library on the Shelf, the catalog on the Catalog. The term **clears when you switch** — a shelf search never silently filters the catalog (AD-25). The `＋ Add "<name>"` row is **Shelf-only**: on the Catalog, a name that isn't in the catalog simply has no match, because you cannot conjure a game into Sony's catalog by typing it.
- **No catalog detail surface.** Catalog cards carry their two actions inline (`＋ Add`, `Claim now`) and there is **no read-only catalog detail page**. The Add path already opens the **add preview** — IGDB-enriched, with the "Not the right game?" picker — which *is* the confirm-before-committing surface; a read-only detail in front of it would duplicate that decision and be the one screen in the app where tapping a cover doesn't flip it into something editable. After a successful add, the app lands on the game's **real, editable detail** (`/game/:id`) — the usual detail screen, at the moment it starts being true. *(Revisit only if browsing proves to need more than cover + title to decide.)*
- **Search-as-add (the hero path).** The always-visible search bar (FR-19) is the *sole* Add entry point. Type a name → existing library games jump to their detail (FR-42, never duplicate); no match → the top row is `＋ Add "<name>"` → preview → save. Zero FAB hops. Search matches the **entire** library, ignoring active filters and hidden states — "did I ever finish that?" always answers.
- **FAB drawer (chores only).** Sync library · Check PS+ Extra · Sync trophies · Export CSV · Settings · About/Help. Icons + text on all sizes (revised 2026-07-14: icons-only on mobile was too unclear). Bottom-right by default, position configurable (Settings). **No Add here** — Add belongs under the thumb in search.
- **Attention banner.** A single under-header zone, shown only when action is needed, persistent until cleared: stragglers, expired session cookie (routes to Settings), failed PS+ refresh.
- **No seed-import UI.** The one-time Notion+PS seed is run out-of-band; zero UI surface.

→ Composition references: `wireframes/ia-shell-wireframe.html`, `mockups/card-flip-prototype.html`, `mockups/filter-row-wireframe.html`, `mockups/state-feedback-board.html`, `mockups/add-stragglers-flow.html`, `mockups/settings-login-mock.html`. Spine wins on conflict.

## Voice and Tone

Microcopy. Brand voice and the arcade posture live in `DESIGN.md.Brand & Style`. Dial: **light** — flavour in headers, plain everywhere else.

| Do | Don't |
|---|---|
| `INSERT GAMES` / `NO MATCH` (empty-state headers) | Cute headers on functional surfaces |
| "3 games couldn't be matched — resolve" | "Oops! Something went wrong 😬" |
| "PlayStation sync needs a new cookie — the last one expired" | "Auth error 401" |
| "Add to wishlist" / "Add as owned" (CTA states the outcome) | A generic "Save" that hides where the game lands |
| "sync your PlayStation library" (descriptive) | "PlayStation Library" as branding |
| Plain, complete sentences; mono for counts/dates | XP, streaks, badges, encouragement, ratings language |

## Component Patterns

Behavioral rules; visual specs live in `DESIGN.md.Components`.

| Component | Behavioral rules |
|---|---|
| **Card** | Cover art is the flip target. **Display-only indicators (top-left cluster):** PS+ Extra flag (in-catalog & not owned), release-state flag (`TBA`/upcoming date until released, per FR-15), milestone badge (silver, persists regardless of play status). **Interactive overlay:** owned toggle (top-right, reversible, no confirm). Tapping any non-control area of the cover flips. Info strip below: name, status pill, genres (desktop only). |
| **Status pill** | Shows *effective state*. Tap → popover: 5 play statuses (instant, no confirm — freely mutable) + "Story completed" / "Platinum achieved" rows. Selecting a milestone opens the **confirm modal** (FR-7). |
| **Detail (flip)** | Tap cover → flip-then-grow. Holds: play-status segmented control, milestone rows + dates, lifecycle dates (auto-recorded, editable here only — FR-44/45), genres (editable, FR-25), ownership flag+type, and "View on PS Store" for wishlisted games. Enforces the FR-3 invariant: refuses any edit leaving neither a play status nor a milestone. |
| **Filter row** | Groups: State (multiselect dropdown), Genre (multiselect dropdown), Flags (solid toggle pills), State-reveals (dashed pills — own group, amended 2026-07-10: an active reveal replaces the State group and shows only the matching hidden games; reveals OR among themselves, Genre/Flags still AND). OR within a group, AND across groups. A **live plain-English summary sentence** narrates the active filter so the model never needs decoding (OR-connectors in {colors.accent-glow}, AND-connectors in {colors.heat-magenta}). Active pills glow (FR-22). |
| **FAB drawer** | Opens upward; each item opens a modal. Long-op items (Sync, PS+ check) show a spinner while running. |
| **Attention banner / Toast / Summary modal / Confirm modal** | See State Patterns. |
| **Search bar** | Persistent. **Scoped to the active destination** (library on the Shelf, catalog on the Catalog); the term clears on switch. On the Shelf: matches the whole library ignoring filters — existing match → detail; no match → `＋ Add`. On the Catalog: narrows the grid (case-insensitive substring, small debounce); no match → `NO MATCH`, never an Add row. |
| **Catalog card** | Cover-forward, **shelf card chrome reused** — but it is *not* a shelf card: **no status pill, no owned toggle, no flip**, because a catalog game isn't a tracked game. (The shelf's status pill shows *play state* — a tracked-game concept. It must never appear here.) Displays: cover, title, the `◈ PS+` membership flag, and **no release date** (the store payload has none). The whole catalog renders, tracked games included — hiding what you already have would just read as a missing game. **Three states, keyed on what you can still do:** ① **not tracked** → `＋ Add` + `Claim now`; ② **tracked but not owned** (added from the catalog — `owned:false`, i.e. a wishlist entry that is also Playable-now) → **`In library`** marker (cyan) **+ `Claim now`, which is still live** — it's on your shelf, but you haven't claimed it to your PlayStation account; ③ **owned** (bought, or claimed and then seen by a sync as `owned_via: membership`) → **`Owned`** marker (silver), **no actions**. Dropping `Claim now` at state ② would strand exactly the games the catalog just added. The app never infers a successful claim — it cannot see the PS Store tab; the next sync decides (Story 6.4). |
| **Catalog genre filter** | Multiselect over the **PS-store genre vocabulary** (the store's own facet keys, ~19) — **not** the shelf's IGDB genres; the two vocabularies never mix (AD-26). Localized names shown. OR within the group. **No state/ownership/flag filters** — those describe tracked games, which these aren't. |

## State Patterns

**The state model (drives the whole shelf).** *(Mirrors PRD §2, which is the source of truth; restated here as the behavioral contract the UI is built against.)*

- **Play status** (only user-set mutable state): Not started · Up next · Playing · Paused · Dropped. One per game; may be null once a milestone exists (FR-1/2). Dropped is hidden from the default shelf (FR-4).
- **Milestones = dates, not statuses:** `completed_on` / `platinum_on`. Immutable through normal flows; editable only in detail; confirm-gated (FR-5/6/7).
- **Effective state (FR-8):** play status if set, else Platinum if platinum_on, else Story completed if completed_on. Ordering, card pills, and filters all operate on effective state.
- **Default visible set:** live play status only. Completed / Platinum / Dropped are hidden by default; a reveal pill switches to an exclusive view of just those games (FR-17/21, amended 2026-07-10 — was: ORed back into the default set, which buried them behind the infinite scroll). Default order: Playing → Paused → Up next → Not started, owned-then-alphabetical within each (FR-18, ownership tier 2026-07-09).
- **Derived (never stored):** Released, Wishlisted (= not owned), Playable now (owned-or-PS+Extra AND released) — FR-12/13/14. "Anything that can be computed is computed."
- **A game added from the Catalog** is **not owned** (browsing is not claiming), so it derives as **Wishlisted *and* Playable-now** — which is exactly the Flow-2 signal: *I want this, and the subscription already covers it, so don't buy it.* Claiming it on PlayStation makes it **owned** (`owned_via: membership`, FR-9 amended) — but only when a **sync observes the entitlement**, never because the store tab was opened.

**Feedback — four channels, one rule.**

| Channel | Job | Blocking | Notes |
|---|---|---|---|
| **Toast** | quick confirmation | no, ~3s auto-dismiss | status change / add / milestone-logged. Reversible risky actions (mark Dropped, un-own) carry a one-tap **UNDO**. Milestones need no undo (already confirm-gated). |
| **Summary modal** | report a user-triggered long op | yes, dismiss | Sync / Import / PS+ check: counts + needs-attention + a button jumping to the problem (FR-37). |
| **Attention banner** | persistent needs-action | no | stragglers / expired cookie / failed refresh. Self-clears when the condition resolves. This is NFR-4 made visible. |
| **Loading** | work in flight | — | cover-shaped skeleton on first load; inline progress bar for long ops. |

**Governing rule:** a triggered op runs inline (progress) → resolves into a **summary modal**; anything in it needing action *also* seeds the **attention banner**, so it survives the dismiss. Transient good-news → toast. *Nothing that needs you is ever one dismissed-modal away from being forgotten.*

**Empty states.** No filter match → `NO MATCH` + "Clear filters". Empty library (fresh/edge) → `INSERT GAMES` + "Sync library" / "＋ Add a game". Search no-library-match → the `＋ Add` path (not a dead end).

**Catalog empty / needs-refresh** (never a blank grid, NFR-4). Three distinct causes, three distinct answers — the surface must not collapse them into one shrug:

| Cause | What shows |
|---|---|
| **No region set** | `NO REGION` — "Set your PlayStation region to see the catalog" + a button into Settings. The catalog is per-region; without one there is nothing to show. |
| **Region set, never refreshed** | `EMPTY CATALOG` — "Check PS+ Extra to load the catalog" + the FAB's own **Check PS+ Extra** action, run right there. |
| **Last refresh failed** | The existing **attention banner** posture (steel, "failed refresh"), plus a stale-but-shown grid where one exists — a stale catalog beats no catalog, as long as it says so. |

**Catalog freshness** reuses the header readout: `PS+ CATALOG AS OF <date>` (Story 5.3) — the same timestamp, now doing double duty for the destination it describes.

## Interaction Primitives

- **Tap** to act. The cover flips; overlaid controls (status pill, owned toggle) act in place.
- **Flip-then-grow** is the one signature gesture — identical on both surfaces (desktop caps at a centered panel; mobile goes full-screen).
- **Popover** off the status pill for inline state changes; positions against the pill, closes on outside tap / scroll.
- **Confirm gate** for logging milestones only (FR-7). **Undo** for reversible risky actions (Dropped, un-own).
- **Infinite scroll** on the shelf (FR-19). Search always overrides filters and hidden states.
- **Banned:** gamification of any kind — XP, streaks, badges ("the field tried it; it incentivized logging games nobody played"). No personal ratings field. No auto-adding PS+ catalog games ("availability is not ownership").

## Accessibility Floor

Behavioral; visual contrast lives in `DESIGN.md`.

- **Keyboard:** every action reachable and operable by keyboard — shelf is a focusable grid (arrow traversal in reading order), pills/toggles are buttons, the detail is a focus-trapped dialog that returns focus to its originating card on close. The search bar takes a global focus shortcut.
- **Focus indicator:** the {colors.accent-glow} halo doubles as a visible focus ring — but focus must be a **distinct, always-on outline**, never conveyed by glow-intensity alone.
- **Icon-only controls carry labels:** the FAB and its icon-only drawer items, the owned toggle, flag icons, and the status pill expose accessible names + state (e.g. "Owned, on"; "Playing — change status"). Status/milestone changes and toasts announce via a polite live region.
- **Contrast:** neon-on-void text and pill labels must meet WCAG AA (≥4.5:1 body, ≥3:1 large/UI); the muted text tone is floored per `DESIGN.md` (`{colors.text-muted}`). Status pills use a **translucent tint with light ink**, and solid active pills use **dark ink on neon** — never white-on-neon.
- **No color-alone signaling:** the **text status pill is the status indicator on every surface** — the dot-only treatment sketched in the early IA/filter wireframes is *superseded* and must not ship. Milestones also carry a badge *shape*; the filter summary's OR/AND coloring is redundant to the literal words "or"/"and".
- **Reduced motion (`prefers-reduced-motion`):** replace flip-then-grow with a fast cross-fade/scale; drop glow *pulses* and the skeleton shimmer (show a static placeholder). This also relieves the perceived flip sluggishness. Static neon stays; motion is what's cut.
- **Touch/hit targets ≥ 44×44** — decoupled from visual size: compact controls (status pill, owned toggle, flag icons, popover rows, sheet chips) keep their small look but carry a ≥44px hit-area via padding or an invisible expander. (The mobile status *dot* was rejected partly for this.)
- **Destination toggle semantics:** the header control is a **tab list** (`role=tablist`, each destination a `tab` with `aria-selected`) — left/right arrows move between them, the active destination is announced, and it is never signalled by glow alone (the active tab carries a solid fill + label weight). A route change moves focus to the destination's heading, so a keyboard or screen-reader user isn't stranded at the top of a grid they didn't ask for.
- **Catalog card actions:** `＋ Add` and `Claim now` are real buttons with accessible names that include the game ("Add Crow Country to library", "Claim Crow Country on the PlayStation Store"), not two bare icons repeated 490 times. `Claim now` opens a new tab — say so in the name. The already-in-library marker is **text**, not a color state.
- **Menu & combobox semantics:** the status **popover** is a menu — `aria-haspopup`/`aria-expanded` on the pill, arrow-key traversal between rows, Escape closes and returns focus to the pill. The **search bar** is a combobox — `role=combobox` with `aria-controls`/`aria-activedescendant` over the results list; the result count and the `＋ Add` option announce via the live region.

## Responsive & Platform

One responsive app; deltas by surface:

| Concern | Phone | Desktop |
|---|---|---|
| Card | **Lean** — 2-up grid, genres hidden, name + status pill below cover | **Dense** — auto-fill grid, name + pill + genres below cover |
| Filters | Single **Filters** button + count badge → bottom sheet (grouped, logic-labeled, "Show N games") | Full filter row always visible; summary sentence inline |
| FAB drawer | Icons + text | Icons + text |
| Detail | True full-screen | Centered ~760px panel |
| Header readout | Compact ("175 · 52 OWNED") | Full (`PS+ CATALOG AS OF …` timestamp) |
| **Destination toggle** | Full-width segmented control on its own row under the wordmark (the header is too narrow to share) | Inline in the header, beside the wordmark |
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

### Flow 4 — Did I ever finish that? (Luca, months later)
1. Types a title into the search bar.
2. Search ignores every active filter and hidden state and finds it.
3. **Climax:** the card shows a silver **Platinum** badge — answered instantly, without hunting.

### Flow 6 — What am I already paying for? (Luca, Sunday, nothing to play) — *Epic 7*
1. Shelf says backlog; nothing on it appeals. He taps **CATALOG** in the header.
2. The full PS+ Extra catalog loads, cover-forward — 490 games he's already paying for. The header reads `PS+ CATALOG AS OF 14 JUL`.
3. He filters to **Horror** (the store's own genre), and types "quiet" in the search bar — scoped to the catalog, not his library.
4. A card shows the silver **In library** marker — he already tracks that one. The others offer `＋ Add`.
5. He taps `＋ Add` on *A Quiet Place: The Road Ahead*. The add preview opens, IGDB data pre-filled; he saves.
6. **Climax:** the app lands on the game's detail — on his shelf, **Playable now**, and still on the wishlist he never has to act on, because the subscription already covers it. The blind spot Epic 5 only *flagged* is now a place he can browse.
   *Alternative:* he taps **Claim now** instead and the PS Store opens to add it to his account.

### Flow 5 — Logging a milestone (Luca, credits rolling)
1. On the shelf, taps the game's status pill.
2. In the popover, taps **Platinum achieved**.
3. The **confirm modal** guards against a fat-finger; he confirms.
4. **Climax:** the cover gains its silver badge and the date is written — the record is trustworthy, which is the real deliverable.
