---
title: 'Card info: stacked score lines, compact rows (no reserved blanks)'
type: 'feature'
created: '2026-07-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'febb3293b8a60bc03d345d69402cb42facbc2609'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The shelf card renders its IGDB facts as one 11px ellipsized line (`◎ 78 ★ 75 45h story…` — the 100% figure almost never survives the truncation), and every info row is always rendered so unscored cards carry blank reserved lines — the "extra vertical space" Luca flagged; with most cards unlinked the strip is mostly dead space.

**Approach:** Stack the card facts vertically — reviews line (`◎ N ★ N`), time-to-beat-story line, time-to-100% line — and compact missing info: any row with nothing to show is absent from the DOM, so the remaining rows sit flush at the TOP of the info strip and all leftover space pools at the BOTTOM. Uniform card height is KEPT (Luca 2026-07-16): the info strip gets a fixed height sized for the fullest stack, instead of per-row reservation.

## Boundaries & Constraints

**Always:**
- A null fact renders NOTHING — never a zero, never the 100% figure standing in for story (VR-5/VR-8, NFR-4). Existing sr-only text and counts survive unchanged.
- Compaction covers every reserving row: the scores block (absent when all four facts are null), the genres row (absent when the list is empty), and the OWNED line (absent when un-owned — replace the `visibility` trick with non-render).
- The status pill row keeps rendering always — it is an interactive control, not a fact.
- Uniform card height is PRESERVED (Luca 2026-07-16): every card's info strip is the same fixed height — sized for the fullest possible stack (title, genres, three fact lines, status, owned) — implemented as one strip-level height, NOT per-row reservation. Content top-aligns; empty space sits only at the bottom, never between rows.
- Tests pinning the old reserved-row behavior are updated to pin the new absence behavior (e2e 10.1d "empty card row" + jsdom equivalents), not deleted.

**Ask First:**
- Any change to DetailPanel, filters, or the shelf grid's roving-focus model — this spec is the Card info strip only.

**Never:** Color-grading scores (that is backlog story 10.5); new data or API fields; touching the cover/flags cluster; a CSS `min-height`/`visibility` compromise that still reserves space.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fully faceted | scores + both TTB figures | Three stacked lines: `◎ 78 ★ 75` / `45h story` / `60h 100%` | N/A |
| Critic-only | criticScore set, rest null | Reviews line shows `◎ 83` alone; no TTB lines | N/A |
| Story-only TTB | no scores, ttbStory set | Single `45h story` line; no reviews line, no 100% line | N/A |
| Nothing | all four facts null | No scores block at all — genres/status close the gap upward; card height unchanged (space pools below) | N/A |
| No genres + un-owned | genres [], owned false | Neither row renders; title, (scores?), status sit compact at top; card height identical to a full card | N/A |
| <600px | narrow viewport | Genres already display:none there; absence rule must not double-reserve or shift other rows | N/A |

</frozen-after-approval>

## Code Map

- `web/shelf/Card.tsx` -- the info strip: `.card__scores` single-line row (l.219–266), always-rendered `.card__genres` (l.214), `visibility`-tricked `.card__owned-line` (l.274–291)
- `web/shelf/card.css` -- `.card__scores` nowrap/ellipsis/min-height block (l.250 area), info-strip "every row always renders" comment (l.205–209 in TSX + css), `.card__owned` visibility rule
- `web/shelf/Card.test.tsx` -- jsdom pins: null-slot class-absence check, sr-only counts — extend with absence-of-row assertions
- `playwright/e2e/epic10-scores.spec.ts` -- 10.1d "unscored game renders NO score — empty card row" pins the OLD reservation; 10.3c card assertions
- `playwright/COVERAGE.md` -- 10.1d/10.3c row wording mentions the empty reserved row

## Tasks & Acceptance

**Execution:**
- [x] `web/shelf/Card.tsx` -- replace the single `.card__scores` <p> with a conditional block of stacked lines (reviews / story / 100%), each line rendered only when it has content; drop the genres <p> when `genres.length === 0`; render the OWNED line only when `game.owned`
- [x] `web/shelf/card.css` -- scores block: stacked lines with per-line overflow safety (no single-row ellipsis); remove per-row reservations (`min-height` on scores, owned-line `visibility`); give `.card__info` a fixed height sized for the fullest stack (flex column, content top-aligned, slack at the bottom); update the uniformity comment: same height, strip-level not row-level
- [x] `web/shelf/Card.test.tsx` -- update/extend: unscored game has NO scores element in the DOM; genre-less game has no genres node; un-owned game has no OWNED node; fully-faceted game shows three stacked lines with 100% VISIBLE (the old ellipsis hid it)
- [x] `playwright/e2e/epic10-scores.spec.ts` -- 10.1d asserts the scores block is ABSENT (not empty); 10.3c asserts `60h 100%` is visible on the card
- [x] `playwright/COVERAGE.md` -- amend 10.1d/10.3c wording to the absence behavior

**Acceptance Criteria:**
- Given a game with scores and both TTB figures, when its card renders, then reviews, story hours, and 100% hours appear as three separate stacked lines and ALL are readable (no ellipsis swallowing the 100% figure).
- Given a game missing any fact family, when its card renders, then that line is absent from the DOM and the rows below sit flush — no blank reserved line anywhere in the info strip.
- Given a game with no IGDB facts, no genres, and not owned, when its card renders, then the info strip is just title + status pill sitting at the top — and the card's total height equals a fully-faceted card's (empty space only at the bottom).
- Given the full vitest + epic10 Playwright suites, when they run, then green — with the reservation-pinning tests rewritten to pin absence.

## Spec Change Log

## Verification

**Commands:**
- `bun run typecheck && bun run lint` -- expected: clean
- `bun run test` -- expected: green (Card/Shelf jsdom updated)
- `bunx playwright test epic10` -- expected: green with rewritten 10.1d/10.3c pins

**Manual checks (if no CLI):**
- Local shelf at 8787: an unlinked card shows no blank line under genres; Banishers card shows the three stacked lines with `60h 100%` visible.

## Review Triage Log

### 2026-07-16 — step-04 dual review (Blind Hunter + Edge Case Hunter)

15 raw findings → 4 patch / 0 intent_gap / 0 bad_spec / 0 defer / rest rejected.

**Patched:**
1. Uniform-height e2e was tautological — the shelf grid stretches every card in a row to the row height, so card bounding boxes equalize even with the min-height deleted. Now measures the `.card__info` strips, which the grid does NOT stretch.
2. `min-height` was the exact measured sum (zero headroom) — fallback-font metrics or OS rasterization drift could push the fullest stack past the floor. +4px headroom: 128→132 desktop, 109→112 mobile; comment names row-count and `--space-1` as re-measure triggers too.
3. COVERAGE.md overclaimed compaction asserts in DetailPanel.test.tsx — reworded honestly.
4. Vestigial `data-owned` attribute (its only consumer, the `visibility:hidden` rule, died in this diff) — removed.

**Rejected (representative):** line-1 review ellipsis (per-line overflow safety is spec'd, and "◎ 78 ★ 75" fits any real track); interior-row misalignment across cards (that IS the requested compaction); 600px breakpoint mismatch (verified: both rules use `max-width: 600px`); jsdom uniformity pin (jsdom has no layout engine); `genres: [""]` blank row (genre names can't be empty in D1); class-name coupling in the 3-line pin (established project test pattern).

## Suggested Review Order

**Compaction + stacking (the change itself)**

- Entry point: the info strip contract — conditional rows, strip-level uniformity.
  [`Card.tsx:205`](../../web/shelf/Card.tsx#L205)

- Scores block: renders only with facts; three stacked lines inside.
  [`Card.tsx:226`](../../web/shelf/Card.tsx#L226)

- Genres and OWNED rows: absent, not blank/invisible.
  [`Card.tsx:214`](../../web/shelf/Card.tsx#L214), [`Card.tsx:294`](../../web/shelf/Card.tsx#L294)

**Uniform height mechanism**

- The strip-level floor with measured derivation + headroom rationale.
  [`card.css:192`](../../web/shelf/card.css#L192)

- Mobile floor (genres hidden ≤600px) and per-line overflow safety.
  [`card.css:200`](../../web/shelf/card.css#L200), [`card.css:270`](../../web/shelf/card.css#L270)

**Tests**

- Non-tautological uniformity pin (info strips, not grid-stretched cards).
  [`epic10-scores.spec.ts:97`](../../playwright/e2e/epic10-scores.spec.ts#L97)

- Absence pin (block gone, not blank) + stacked-lines pin.
  [`epic10-scores.spec.ts:79`](../../playwright/e2e/epic10-scores.spec.ts#L79), [`Card.test.tsx:120`](../../web/shelf/Card.test.tsx#L120)

- jsdom compaction suite (genres, OWNED absence).
  [`Card.test.tsx:140`](../../web/shelf/Card.test.tsx#L140)
