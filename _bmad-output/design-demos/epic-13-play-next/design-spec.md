# Epic 13 Play Next — HTML mock direction spec

## Purpose

These mocks resolve the Story 13.1 UI-MOCK-GATE by making placement and information structure concrete before production UI code. They are not production implementation and contain no backend behavior. Each direction shows the same product intent: authenticated PRESS START shell, new PLAY NEXT destination, immediate default Surprise me slate, three transparent suggestions, and enough visible structure to anticipate later tuning and shuffle stories without pretending those interactions are already complete.

## Audience and scenario

Primary user is Luca, already familiar with Shelf, Catalog, and Stats. He enters Play Next because choosing from a large tracked library feels harder than playing. First useful content must therefore be the suggestions, not a questionnaire or filter builder. Desktop is viewed at normal laptop distance; mobile is held at 10–30 cm. Both need an unmistakable route heading, transparent reason hierarchy, direct actions, and no carousel. The mocks should feel native to existing PRESS START rather than like a separate recommendation product.

## Required content structure

- Existing dark-only app shell and destination order: `SHELF | PLAY NEXT | CATALOG | STATS`.
- Search absent while Play Next is active.
- Route heading `WHAT NEXT?`, short supporting copy, and an immediate Surprise me state.
- Three equal-weight suggestion cards on desktop and a vertical card stack on phone.
- Each card: honest cover placeholder, primary reason/category, optional access label, title, known facts only, one plain explanation, `PLAY THIS`, and `OPEN DETAILS`.
- At most one visible `FINISH THEM` result in default state.
- Future controls represented only as placement anatomy: tune entry, `SHOW ME 3`, and `SHUFFLE`. No fabricated interaction logic.
- Mobile structure reserves a collapsible `TUNE THE PICKS` section and keeps actions at least 44 px.

## Existing design system

Use repository tokens and brand language: void `#05090f`, surface `#0b1622`, raised surface `#0a1120`, hairline `#163043`, primary text `#eafaff`, secondary `#8fb0c4`, electric interaction `#12b3ff`, glow partner `#35e0ff`, warning amber `#ffb254`. Magenta remains reserved for Playing and must not decorate recommendation UI. Typography jobs stay unchanged: Orbitron display, Rajdhani UI controls, Inter body, JetBrains Mono facts. Shapes use existing 8/12/18 px radii and pill controls. Elevation is glow plus tonal contrast, never conventional drop shadow.

## Three directions

1. **Command Deck** — safest extension. Controls sit in a quiet command strip above a strict three-column card grid. Form comes from “pick three now”: all options share one visible decision plane.
2. **Shelf Console** — left-hand control rail with three equal cards occupying the main stage. Inspired by the useful separation of discovery controls from results in queue-based recommendation products; official Steam material confirms Discovery Queue centers a sequential set of recommendations and follow-up actions. Form comes from “set intent, then inspect results.”
3. **Arcade Stage** — terminal-core soft-futurism direction selected by seconds-wheel style 17. A scoreboard-like heading and bottom command dock frame three cards. Form comes from a game-selection lobby: recommendations are contestants, controls are cabinet commands, while existing tokens prevent novelty from becoming a separate brand.

## Assumptions and placeholders

- Real game covers and titles are intentionally absent. `COVER ART` and bracketed fact text are honest placeholders, not invented product data.
- Production card copy will be derived from known Shelf facts. Mock explanations illustrate hierarchy only.
- `PLAY THIS` behavior lands through existing lifecycle mutation infrastructure; mocks show location and affordance, not success/failure states.
- Desktop target is 1440×900; mobile validation target is 390×844. HTML remains responsive between them.
- No new colors, icons, logos, external fonts, imagery, schema, API, or persistence.

## Evaluation criteria

Choose based on how quickly the eye understands: destination → three picks → why each pick → direct action. Confirm desktop controls remain visible without overpowering results, mobile cards stay compact without losing explanation, `FINISH THEM` reads as a reason rather than an alarm, and detail/action buttons remain distinct. Selection can mix layout from one direction with card anatomy from another.

## Direction decision

Luca selected Direction 1, Command Deck. Refinement requested: remove `VARIED DEFAULT SLATE`; `SURPRISE ME` already names the applied default mode, so the secondary string adds no actionable meaning.
