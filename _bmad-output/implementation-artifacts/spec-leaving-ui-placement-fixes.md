---
title: 'Leaving UI placement fixes — banner into detail header, pill on its own card row'
type: 'feature'
created: '2026-07-16'
status: 'done'
route: 'one-shot'
---

# Leaving UI placement fixes

## Intent

**Problem:** (Luca, screenshots 2026-07-16) the detail leaving banner sat above the two-column body and reflowed it; the shelf LEAVING pill shared the flag row and got clipped under the top-right owned toggle.

**Approach:** banner moved into the header beside the cover (new `heading-block` wraps title + compact pill-styled banner — body grid untouched). Card pill forced onto its OWN cluster row via a flex break (`flex-basis: 100%` + `max-width: fit-content`) instead of a magic offset — the review killed the first absolute-offset attempt (wrapped flag rows collided with it) — and the whole flag cluster now stops short of the owned toggle, so no flag can ever slide under it.

## Suggested Review Order

- The flex-break row + cluster right-bound (the review-corrected mechanism)
  [`card.css:119`](../../web/shelf/card.css#L119)
- Pill back inside the cluster, own-row rationale
  [`Card.tsx:160`](../../web/shelf/Card.tsx#L160)
- Banner in the header's heading block
  [`DetailPanel.tsx:236`](../../web/shelf/DetailPanel.tsx#L236)
- Compact banner styling (radius-sm for wrap, title overflow-wrap)
  [`detail-panel.css:118`](../../web/shelf/detail-panel.css#L118)
- Structural pins (banner in header, pill in cluster) + e2e geometry pins (below PS+, never under the toggle)
  [`epic10-leaving-soon.spec.ts:30`](../../playwright/e2e/epic10-leaving-soon.spec.ts#L30)
