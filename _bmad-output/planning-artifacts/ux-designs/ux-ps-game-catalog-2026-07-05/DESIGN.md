---
name: PRESS START
description: Arcade-neon personal game shelf. Dark-only, cover-forward, glance-and-go. Electric cyan does the work; hot magenta is reserved for what you're playing right now.
status: final
updated: 2026-07-05
colors:
  bg-void: '#05090f'
  surface: '#0b1622'
  surface-raised: '#0a1120'
  border-hairline: '#163043'
  border-soft: '#12283a'
  text-primary: '#eafaff'
  text-secondary: '#8fb0c4'
  text-muted: '#6b8ba0'
  brand-blue: '#0070cc'
  accent-electric: '#12b3ff'
  accent-glow: '#35e0ff'
  heat-magenta: '#ff2e88'
  heat-magenta-ink: '#ff8bc2'
  milestone-silver: '#d6e6f5'
  state-dormant: '#3d5566'
  warn-amber: '#ffb254'
  success-green: '#8fe6a8'
typography:
  display:
    family: 'Orbitron'
    note: 'Arcade display. Wordmark 900; section headings 700; pills/labels 600 uppercase + tracked. Card titles, single-line ellipsis.'
  ui-label:
    family: 'Rajdhani'
    note: 'Condensed UI labels — buttons, segmented controls, filter dropdowns. In-family arcade feel, tighter than Orbitron.'
  body:
    family: 'Inter'
    note: 'Dense/reading text — the flipped detail view, forms, long copy. 400/500/600.'
  mono:
    family: 'JetBrains Mono'
    note: 'Numerals, dates, counts, timestamps, the tagline, filter logic labels. The terminal-readout voice.'
rounded:
  sm: 8px
  md: 12px
  lg: 18px
  pill: 999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
components:
  card: 'Pure cover art + overlaid controls; info strip below.'
  status-pill: 'Effective-state chip; tap opens the status popover.'
  filter-pill: 'Solid = narrow (AND); dashed = reveal hidden state.'
  fab: 'Bottom-corner chores launcher, position configurable.'
  attention-banner: 'Under-header notice zone for needs-action items.'
  toast: 'Transient bottom confirmation, auto-dismiss.'
  summary-modal: 'Post-op readout (sync/import/PS+).'
  confirm-modal: 'Milestone fat-finger gate.'
  popover: 'Inline status + milestone menu off the pill.'
  detail-panel: 'Flip-then-grow editable detail.'
  search-bar: 'Persistent find-or-add.'
---

# PRESS START — Design Spine

> Visual identity for a single-user, installable PWA that replaces a Notion game-tracking database. Dark-only by deliberate choice (the owner lives in dark mode; the reference is dark). Paired with `EXPERIENCE.md`. Both spines win on conflict with any mock. Mockups referenced inline live in `mockups/`.

## Brand & Style

PRESS START is a personal PlayStation-library tracker dressed as a **neon arcade cabinet**. The reference is Steam Big Picture's cover-forward "Recent Games" shelf crossed with the density of a Notion gallery — but the *feel* is 80s/90s Tron: a near-black void with a faint light-grid, chrome piped in electric cyan, and hot magenta reserved for heat.

The governing insight is **usage posture**: this is a *glance-and-go* tool for fast decisions — "what do I play?", "did I ever finish that?", "saw a game, add it" — not a surface anyone stares at for tens of minutes. That permission is why the loud arcade look is *correct*: glow fatigue is a long-dwell problem, and this isn't a long-dwell app. Speed-to-answer outranks information stamina.

Voice is confident and a little playful, but **personality is dialled light** — arcade flavour lives in empty-state headers (`INSERT GAMES`, `NO MATCH`) and the wordmark; everywhere else the copy stays plain and helpful, never cute-over-clear.

**Name & wordmark.** The product is **PRESS START**, set in Orbitron 900 with a neon glow and a blinking cursor. Tagline: **"Want it! Own it! Beat it!"** (JetBrains Mono, tracked) — the game lifecycle in three beats, mapping 1:1 onto the state model (wishlisted → owned → completed).

**Legal constraint (hard rule):** never use "PlayStation"/Sony marks in the app's own branding or chrome — the wordmark carries no "PlayStation Library" subtitle. "PlayStation" may appear only as descriptive/nominative text (e.g. "sync your PlayStation library" in Settings help), never as identity.

→ Wordmark lockup: `mockups/wordmark-lockup.html`

## Colors

Dark-only. One near-black void, layered surfaces, cool near-white text, and a disciplined two-neon accent system. Neon only reads because it sits on near-blacks.

- **Void `#05090f`** — the app background. Behind the shelf it carries a faint Tron grid + a subtle blue→magenta radial wash (the signature texture).
- **Surface `#0b1622`** (cards) and **Surface-raised `#0a1120`** (modals, sheets, popovers). Hierarchy by tone, edged with **hairline `#163043`** / **soft `#12283a`**.
- **Text** — primary `#eafaff` (cool near-white), secondary `#8fb0c4`, muted `#6b8ba0` (the muted tone is floored at `#6b8ba0` — 5.06:1 on surface — so genres/dates/counts clear WCAG AA; do not use a dimmer grey for text).
- **Brand blue `#0070cc`** is the PS-derived core, used for solid fills. **Electric `#12b3ff`** is the everyday interactive neon (selection, active pills, focus, links, the FAB). **Cyan glow `#35e0ff`** is the halo/highlight partner.
- **Heat magenta `#ff2e88`** (`#ff8bc2` as ink on dark) is the **reserved second neon** — rare by design, spent only on the **Playing** state (usually 1–3 games) so active games burn like embers in a cool library. Never used for common flags; flooding it would kill its meaning.
- **Milestone silver `#d6e6f5`** — earned completion (Story completed / Platinum). A trophy gets its own metal.
- **Semantic status:** Playing = magenta; Up next = cyan/electric; Paused = steel (`#8fb0c4`); Not started = dormant grey (`#3d5566`); Dropped = dim grey; Completed/Platinum = silver.
- **System:** warn/attention (stragglers) = amber `#ffb254`; expired-cookie = magenta; success (toast) = green `#8fe6a8`.

Avoid: a second saturated hue competing with magenta; magenta on anything but Playing; flat non-glowing fills for interactive neon.

→ Palette in situ ("Neon Grid"): `mockups/palette-neon-grid.html`

## Typography

Four faces, split by job — **stylize the chrome, keep the data plain.**

- **Orbitron (display)** — wordmark (900), section headings (700), status & filter pills and labels (600, uppercase, tracked), and **card titles** (single-line, ellipsis-truncated; the full title shows in the detail view). Orbitron is wide; titles are always truncated on the shelf and never wrap. *(If real-world testing shows long titles strain even truncated, card titles may drop to Rajdhani — in-family, tighter — while pills/headings keep full Orbitron.)*
- **Rajdhani (ui-label)** — condensed labels on buttons, segmented controls, filter dropdowns. Arcade family, tighter than Orbitron.
- **Inter (body)** — the flipped detail view, forms, long/dense copy. Where you actually *read*.
- **JetBrains Mono (mono)** — numerals, dates, counts, the `PS+ catalog as of…` timestamp, the tagline, filter logic labels. The terminal-readout accent that reinforces arcade blood without hurting legibility.

**Type ramp (px):** wordmark `clamp(30→72)` / 900 · section heading 16–20 / 700 · card title 12.5 / 600 (ellipsis) · pill & filter label 10 / 600 uppercase ~.04em · button & segment 13–15 / Rajdhani 700 · body 13 / Inter 400–500 · meta & mono 10–11 / 500. Line-height ≈1.15 display, ≈1.5 body. Card titles never wrap.

## Layout & Spacing

Scale: 4 / 8 / 12 / 16 / 24 / 32. Tight gaps between related elements (cover → name → pill), larger gaps between surfaces.

The shelf is a **cover-forward responsive grid**: 3-up on the phone frame, auto-fill (~150px min) on desktop, infinite scroll. Covers are 3:4. One screen holds everything; every action surfaces *over* the shelf — the user never navigates away.

## Elevation & Depth

Depth comes from **glow and tone**, not drop-shadow hierarchy. Cards sit on `surface` over the gridded void; modals/popovers use `surface-raised` with a cyan glow-ring (`0 0 22–34px` of `accent-glow` at low alpha). The Playing card carries a soft magenta bloom. Focus and selection are expressed as neon halos, not borders alone.

## Shapes

- **Pills (`999px`)** for status, filters, tags — the arcade signature.
- **`sm` (8px)** inputs, small controls, icon tiles.
- **`md` (12px)** cards.
- **`lg` (18px)** modals, sheets, popovers.

Covers follow their container corners. Two filter-pill *shapes* encode behavior: **solid** pills narrow (AND), **dashed** pills reveal a hidden state.

## Components

- **Card** — pure cover art. **Top-left flag cluster (display-only):** PS+ Extra badge (◈, when in the PS+ Extra catalog and not owned), a **release-state** flag (upcoming date / `TBA` while unreleased; nothing once released), and the **milestone badge** (silver ✓ Completed / 🏆 Platinum, persists regardless of play status). **Top-right:** owned toggle. Below the cover, an info strip — game name (Orbitron, ellipsis), then a **status pill**, then a genres line (desktop only; mobile hides genres and goes 2-up). The Playing card glows magenta. Satisfies FR-15. → `mockups/card-flip-prototype.html`
- **Status pill** — shows *effective state* (FR-8). Tap → **popover** with the 5 play statuses (instant) + 2 milestone rows (confirm-gated). Milestone achievement also paints a permanent silver badge on the cover, independent of play status.
- **Filter pills** — solid cyan (glow when active, FR-22) = narrow; dashed silver = reveal (Completed/Platinum/Dropped). → `mockups/filter-row-wireframe.html`
- **FAB** — electric-blue rounded launcher, bottom-right by default (configurable to bottom-left). Opens an upward drawer of chores (icons-only mobile / icons+text desktop). → `wireframes/ia-shell-wireframe.html`
- **Attention banner** — full-width notice under the header; amber (stragglers), magenta (expired cookie), steel (failed refresh).
- **Toast** — `surface-raised`, cyan-edged, bottom, auto-dismiss; UNDO variant for reversible risky actions. → `mockups/state-feedback-board.html`
- **Summary / confirm modals** — `surface-raised`, glow-ring; confirm modal uses silver for milestone gravity.
- **Detail panel** — flip-then-grow; centered ~760px on desktop, full-screen on mobile.
- **Search bar** — persistent, pill-shaped, cyan-edged with a focus glow; bottom-pinned on mobile, header-left on desktop. The hero find-or-add surface; results dropdown lists library matches + the `＋ Add` row.
- **Popover** — `surface-raised` with glow-ring, anchored to the tapped status pill (flips above/below to stay on-screen); holds the status radio list + the two milestone rows.
- **Skeleton** — cover-shaped shimmer (`surface` → lighter sweep) on first load.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Let cover art carry the color; keep chrome cool cyan | Tint chrome with many hues |
| Spend magenta only on Playing (1–3 cards) | Use magenta for common flags like Playable-now |
| Glow as seasoning; grid as a whisper | Bloom every card until the shelf screams |
| Orbitron for quick-read chrome; Inter for dense reading | Set the flipped detail view or long copy in Orbitron |
| Silver = earned milestone, always | Recolor Platinum to match a status |
| "PlayStation" as descriptive text only | Put Sony marks in the wordmark or branding |
| Truncate card titles to one line | Let a long title wrap and break the grid |
| Dark-only, committed | Bolt on a half-considered light mode in v1 |
