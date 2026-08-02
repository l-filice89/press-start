# Epic 13 Play Next — direction selection

Date: 2026-08-02

## Directions shown

- Direction A — Command Deck
  - HTML: `_bmad-output/design-demos/epic-13-play-next/01-command-deck.html`
  - Desktop: `_bmad-output/design-demos/epic-13-play-next/screenshots/01-command-deck-desktop.png`
  - Mobile: `_bmad-output/design-demos/epic-13-play-next/screenshots/01-command-deck-mobile.png`
- Direction B — Shelf Console
  - HTML: `_bmad-output/design-demos/epic-13-play-next/02-shelf-console.html`
  - Desktop: `_bmad-output/design-demos/epic-13-play-next/screenshots/02-shelf-console-desktop.png`
  - Mobile: `_bmad-output/design-demos/epic-13-play-next/screenshots/02-shelf-console-mobile.png`
- Direction C — Arcade Stage
  - HTML: `_bmad-output/design-demos/epic-13-play-next/03-arcade-stage.html`
  - Desktop: `_bmad-output/design-demos/epic-13-play-next/screenshots/03-arcade-stage-desktop.png`
  - Mobile: `_bmad-output/design-demos/epic-13-play-next/screenshots/03-arcade-stage-mobile.png`

## User selection — verbatim

> I like option A the most, but I don't see the value in the "varied default slate" string

## Applied interpretation

- Selected direction: A — Command Deck.
- Required refinement: remove `VARIED DEFAULT SLATE`; add no replacement filler.
- Revised placement mock removes the unwanted string.

## Final placement approval — verbatim

> Approve revised option A placement mock

Status: approved by Luca on 2026-08-02 for Story 13.1 UI implementation.

## Story 13.2 Tune iteration

Iteration source: Direction A — Command Deck, selected above. This narrows the
approved direction to Story 13.2 structure; it does not reopen direction selection.

- HTML: `_bmad-output/design-demos/epic-13-play-next/04-story-13-2-tune-expanded.html`
- Desktop: `_bmad-output/design-demos/epic-13-play-next/screenshots/04-story-13-2-tune-desktop.png`
- Mobile: `_bmad-output/design-demos/epic-13-play-next/screenshots/04-story-13-2-tune-mobile.png`
- Desktop placement: Tune controls above current picks.
- Phone placement: current picks before Tune controls.
- Structure: separate applied and draft intent, six intent groups, wishlist pool
  control, explicit `SHOW ME 3`, and card-level `CLOSEST MATCH` disclosure.

Status: pending Luca's explicit Story 13.2 approval before UI implementation.

## Story 13.2 correction — verbatim

> Why is tune the picks below? It should be a modal like the filters in the shelf and catalog. Reuse the same logic, disposition and icons (wherever possible) as the shelf/catalog for the game cards (the cover).

Applied interpretation:

- `04-story-13-2-tune-expanded.html` rejected and retained for audit only.
- Revised HTML: `_bmad-output/design-demos/epic-13-play-next/05-story-13-2-tune-modal.html`.
- Desktop modal: `_bmad-output/design-demos/epic-13-play-next/screenshots/05-story-13-2-tune-modal-desktop.png`.
- Phone modal: `_bmad-output/design-demos/epic-13-play-next/screenshots/05-story-13-2-tune-modal-mobile.png`.
- Desktop cards: `_bmad-output/design-demos/epic-13-play-next/screenshots/05-story-13-2-cards-desktop.png`.
- Phone cards: `_bmad-output/design-demos/epic-13-play-next/screenshots/05-story-13-2-cards-mobile.png`.
- Tune is a modal at every width: centered dialog on desktop, Shelf/Catalog-style
  bottom sheet on phone.
- Cards reuse existing 3:4 cover composition, cover detail trigger, known flag
  placement, `◆/◇` ownership control, `▹` fallback, and compact fact strip.

Status: pending Luca's explicit approval of revised Story 13.2 modal iteration.
