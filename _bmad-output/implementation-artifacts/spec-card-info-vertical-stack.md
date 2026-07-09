---
title: 'Card info strip: vertical stack (Title / Genre / Status / Owned)'
type: 'feature'
created: '2026-07-09'
status: 'done'
route: 'one-shot'
---

# Card info strip: vertical stack (Title / Genre / Status / Owned)

## Intent

**Problem:** The OWNED chip sat beside the status pill and wrapped inconsistently — some cards showed it on the status line, others on a second line, so the info strip read differently card to card.

**Approach:** Fixed one-row-per-line stack below the cover — Title, Genres, Status, Owned — with every row always rendered (empty/hidden rows reserve their line) so all cards stay the same height regardless of content. Adversarial review patches hardened the popover placement (fit-aware flip + height cap), toast duration semantics (+tests), and scoped the detail-panel section chrome to desktop.

## Suggested Review Order

1. [web/shelf/Card.tsx](../../web/shelf/Card.tsx) — the reordered info strip; OWNED chip always rendered, hidden via `data-owned`.
2. [web/shelf/card.css](../../web/shelf/card.css) — `.card__owned-line` visibility reservation; trimmed `.card__meta`; cover self-clip note.
3. [web/shelf/StatusPopover.tsx](../../web/shelf/StatusPopover.tsx) — fit-aware flip: picks the roomier side, caps `max-height`, ignores menu-internal scrolls, closes on resize.
4. [web/shelf/status-popover.css](../../web/shelf/status-popover.css) — flip/align overrides + `overflow-y: auto` for the capped case.
5. [web/components/Toast.tsx](../../web/components/Toast.tsx) / [Toast.test.tsx](../../web/components/Toast.test.tsx) — undoable default 6s, explicit `duration` wins; two new timer tests.
6. [web/shelf/detail-panel.css](../../web/shelf/detail-panel.css) — two-column desktop layout; section chrome desktop-only; last section spans both columns.
7. [web/shelf/shelf.css](../../web/shelf/shelf.css) — grid rows back to default stretch.
