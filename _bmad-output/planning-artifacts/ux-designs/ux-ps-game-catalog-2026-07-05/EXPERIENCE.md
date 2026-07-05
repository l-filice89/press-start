---
name: PRESS START
status: final
updated: 2026-07-05
sources:
  - ../../briefs/brief-ps-game-catalog-2026-07-04/brief.md
  - ../../prds/prd-ps-game-catalog-2026-07-05/prd.md
---

# PRESS START — Experience Spine

> How the app *works*: information architecture, behavior, states, interactions, accessibility, and journeys. Visual identity is the paired `DESIGN.md` — this spine references its tokens as `{path.to.token}`. Both spines win on conflict with any mock. FR/NFR references point at the PRD (`prd-ps-game-catalog-2026-07-05`).

## Foundation

**Installable PWA — one responsive app, two first-class surfaces.** The phone is where the "saw a game, want it" moment lives (a home-screen icon is the shortest path to it, FR-46); the desktop is where the cover-forward shelf shines. Not two builds — one responsive app with device-specific *deltas* (see Responsive & Platform).

- **Single screen.** The Shelf is home and the whole face of the product; everything else surfaces *over* it. The user never navigates away.
- **Single-user, seam only.** All tracking data is scoped to a user id from day one, but no sharing/roles/tenancy is built (FR-48). Auth is a **better-auth magic link** (FR-47), no passwords.
- **No named UI system.** Components are custom (React/Bun target); `DESIGN.md` is the visual reference. **Dark-only** — no light theme in v1.
- **Nothing external on render** (NFR-3): covers and store links come from persisted data; third-party APIs are hit only at import, sync, refresh, or add time. **Failures surface, never silently retry** (NFR-4) — see State Patterns.

## Information Architecture

Everything hangs off The Shelf. Two homes for actions: the **persistent search bar** (find-or-add) and the **FAB drawer** (deliberate chores). Anything needing attention appears in the **attention banner** under the header.

| Surface | Reached from | Purpose |
|---|---|---|
| **The Shelf** | App open | Cover grid, filters, search, infinite scroll — "what's my gaming life right now?" |
| **Detail** | Tap a cover (flip-then-grow) | Read/edit one game: status, milestones, lifecycle dates, genres, ownership, store link |
| **Status popover** | Tap a card's status pill | Change play status (instant) or log a milestone (confirm-gated) — no flip |
| **Add preview** | Search → `＋ Add "<name>"` | Review games-DB data, edit, save |
| **Stragglers** | Attention banner | Resolve unmatched import titles by search |
| **Sync / PS+ summary** | FAB → run → resolves | Post-op readout (counts + needs-attention) |
| **Settings** | FAB → gear | Session cookie, FAB handedness, About/Sign out |
| **Login** | Cold, unauthenticated | Magic-link sign-in (first run only) |

- **Search-as-add (the hero path).** The always-visible search bar (FR-19) is the *sole* Add entry point. Type a name → existing library games jump to their detail (FR-42, never duplicate); no match → the top row is `＋ Add "<name>"` → preview → save. Zero FAB hops. Search matches the **entire** library, ignoring active filters and hidden states — "did I ever finish that?" always answers.
- **FAB drawer (chores only).** Sync library · Check PS+ Extra · Export CSV · Settings · About/Help. Icons-only on mobile, icons+text on desktop. Bottom-right by default, position configurable (Settings). **No Add here** — Add belongs under the thumb in search.
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
| **Filter row** | Groups: State (multiselect dropdown), Genre (multiselect dropdown), Flags (solid toggle pills), State-reveals (dashed pills). OR within a group, AND across groups. A **live plain-English summary sentence** narrates the active filter so the model never needs decoding (OR-connectors in {colors.accent-glow}, AND-connectors in {colors.heat-magenta}). Active pills glow (FR-22). |
| **FAB drawer** | Opens upward; each item opens a modal. Long-op items (Sync, PS+ check) show a spinner while running. |
| **Attention banner / Toast / Summary modal / Confirm modal** | See State Patterns. |
| **Search bar** | Persistent. Matches whole library ignoring filters. Existing match → detail; no match → `＋ Add`. |

## State Patterns

**The state model (drives the whole shelf).** *(Mirrors PRD §2, which is the source of truth; restated here as the behavioral contract the UI is built against.)*

- **Play status** (only user-set mutable state): Not started · Up next · Playing · Paused · Dropped. One per game; may be null once a milestone exists (FR-1/2). Dropped is hidden from the default shelf (FR-4).
- **Milestones = dates, not statuses:** `completed_on` / `platinum_on`. Immutable through normal flows; editable only in detail; confirm-gated (FR-5/6/7).
- **Effective state (FR-8):** play status if set, else Platinum if platinum_on, else Story completed if completed_on. Ordering, card pills, and filters all operate on effective state.
- **Default visible set:** live play status only. Completed / Platinum / Dropped are hidden by default; the reveal pills OR them back in (FR-17/21). Default order: Playing → Paused → Up next → Not started, alphabetical within each (FR-18).
- **Derived (never stored):** Released, Wishlisted (= not owned), Playable now (owned-or-PS+Extra AND released) — FR-12/13/14. "Anything that can be computed is computed."

**Feedback — four channels, one rule.**

| Channel | Job | Blocking | Notes |
|---|---|---|---|
| **Toast** | quick confirmation | no, ~3s auto-dismiss | status change / add / milestone-logged. Reversible risky actions (mark Dropped, un-own) carry a one-tap **UNDO**. Milestones need no undo (already confirm-gated). |
| **Summary modal** | report a user-triggered long op | yes, dismiss | Sync / Import / PS+ check: counts + needs-attention + a button jumping to the problem (FR-37). |
| **Attention banner** | persistent needs-action | no | stragglers / expired cookie / failed refresh. Self-clears when the condition resolves. This is NFR-4 made visible. |
| **Loading** | work in flight | — | cover-shaped skeleton on first load; inline progress bar for long ops. |

**Governing rule:** a triggered op runs inline (progress) → resolves into a **summary modal**; anything in it needing action *also* seeds the **attention banner**, so it survives the dismiss. Transient good-news → toast. *Nothing that needs you is ever one dismissed-modal away from being forgotten.*

**Empty states.** No filter match → `NO MATCH` + "Clear filters". Empty library (fresh/edge) → `INSERT GAMES` + "Sync library" / "＋ Add a game". Search no-library-match → the `＋ Add` path (not a dead end).

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
- **Menu & combobox semantics:** the status **popover** is a menu — `aria-haspopup`/`aria-expanded` on the pill, arrow-key traversal between rows, Escape closes and returns focus to the pill. The **search bar** is a combobox — `role=combobox` with `aria-controls`/`aria-activedescendant` over the results list; the result count and the `＋ Add` option announce via the live region.

## Responsive & Platform

One responsive app; deltas by surface:

| Concern | Phone | Desktop |
|---|---|---|
| Card | **Lean** — 2-up grid, genres hidden, name + status pill below cover | **Dense** — auto-fill grid, name + pill + genres below cover |
| Filters | Single **Filters** button + count badge → bottom sheet (grouped, logic-labeled, "Show N games") | Full filter row always visible; summary sentence inline |
| FAB drawer | Icons only | Icons + text |
| Detail | True full-screen | Centered ~760px panel |
| Header readout | Compact ("175 · 52 OWNED") | Full (`PS+ CATALOG AS OF …` timestamp) |

**PWA:** installable, home-screen icon (the wishlist moment). **Offline:** no offline requirement; when the games DB is unreachable, add-by-name falls back to a name-only entry that lands in stragglers to enrich later (FR-41).

## Inspiration & Anti-patterns

- **Lifted from Steam Big Picture** ("Recent Games" shelf): covers carry the screen; chrome recedes.
- **Lifted from the current Notion gallery:** data density on the card (cover, genre tags, status, owned) — refined, not reinvented.
- **Rejected — gamification (streaks/XP/badges):** actively incentivizes logging games nobody plays. Never, per the brief.
- **Rejected — personal ratings:** no rating field exists; the Notion `Rating` column is not imported.
- **Rejected — auto-adding PS+ catalog games:** availability is not ownership; catalog games leave. PS+ Extra is a *flag*, never an ownership or auto-add trigger.

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

### Flow 5 — Logging a milestone (Luca, credits rolling)
1. On the shelf, taps the game's status pill.
2. In the popover, taps **Platinum achieved**.
3. The **confirm modal** guards against a fat-finger; he confirms.
4. **Climax:** the cover gains its silver badge and the date is written — the record is trustworthy, which is the real deliverable.
