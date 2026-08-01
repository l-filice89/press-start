# PRESS START — Brand Spec

**Collected:** 2026-08-01
**Sources:** `web/tokens.css`, `web/fonts.css`, `web/shell/Wordmark.tsx`, `web/shell/wordmark.css`, committed `DESIGN.md`
**Completeness:** Complete for this UI prototype

## Core assets

### Wordmark

- Canonical source: `web/shell/Wordmark.tsx` + `web/shell/wordmark.css`
- Form: `PRESS START` in Orbitron 900, near-white, cyan neon halo, block cursor
- Tagline: `Want it! Own it! Beat it!` in JetBrains Mono
- Prototype rule: reproduce canonical component structure; do not invent a replacement logo or add Sony marks

### Product UI

- Canonical source: current React shell, header, destination toggle, background, and token CSS
- Current mock reference: `design-process/evolution/sketches/stats-dashboard-mock.html`
- Screenshots: `design-process/evolution/sketches/stats-dashboard-desktop.png`, `stats-dashboard-phone.png`

### Images

- None required. This is a data/tool surface; removing imagery loses no product information.
- No stock images, decorative game covers, or fabricated artwork.

## Palette

- Void: `#05090f`
- Surface: `#0b1622`
- Raised surface: `#0a1120`
- Hairline: `#163043`
- Primary text: `#eafaff`
- Secondary text: `#8fb0c4`
- Muted text: `#6b8ba0`
- Electric cyan: `#12b3ff`
- Cyan glow: `#35e0ff`
- Heat magenta: `#ff2e88`
- Magenta ink: `#ff8bc2`
- Milestone silver: `#d6e6f5`
- Warning amber: `#ffb254`

## Typography

- Display: Orbitron 600/700/900
- UI labels: Rajdhani 500/600/700
- Body: Inter Variable, used only for reading/UI body copy
- Numerals/dates/data: JetBrains Mono Variable with tabular numerals
- Prototype loads local project font files directly; no network font dependency

## Signature details

- Neon glow and tone create depth; conventional drop shadows do not.
- Faint Tron grid and restrained cyan→magenta atmospheric wash live behind content.
- Pill-shaped destination control remains canonical shell navigation.
- Stats may extend magenta from “currently Playing” to “play activity/Started” only. This is explicit user-directed evolution, not generic decoration.

## Prohibited

- Sony/PlayStation marks in product branding or chrome
- Magenta applied indiscriminately to every metric
- Generic purple SaaS gradients
- Emoji decoration, invented trophies, or fabricated game art
- New unverified statistics or inferred playtime

## Character

Neon arcade cabinet; confident; playful but clear; cover-forward elsewhere; data-legible here.
