# PRD Addendum — PS Game Catalog

## Ownership rationale

Luca's 2026-07-11 decision superseded purchase-only ownership: claimed games count as owned because they are ready to play while the subscription lasts. About 123 of 175 real seed entries were membership claims; importing them is intentional. Acquisition source distinguishes purchase from membership independently of physical/digital format. Claims never establish purchase dates; cancellation un-owns claims without changing purchases or history. [PRD ownership requirements](prd.md#ownership) carry the current rule; the append-only decision log retains superseded policy.

Format defaults to physical for manual ownership changes without a supplied format, and digital for PS-export entries. Both remain editable, preserving quick capture and meaningful ownership breakdowns.

## Replay rationale

Milestones are dates, so later replay can return to Playing without losing completion history. Logging platinum clears current status; it does not prohibit future replay. A finished-but-idle status would duplicate milestone state.

## PSN safety trade-off

The [approved 2026-07-15 proposal](../../sprint-change-proposal-2026-07-15.md) removes credentialed PSN automation. One-time seed plus deliberate upkeep replaces automatic purchase discovery. Anonymous regional PS+ data remains supported. Credentials, library/trophy sync, and automatic Claim observation are not deferred features to revive incidentally.

## Sale detection & notifications — future

Luca requested wishlisted-game sale detection during discovery (2026-07-05). A possible daily pricing check needs a separately approved source, delivery channel, and resource budget. Persisted PS Store product IDs provide a starting point; no sale provider or notification mechanism is selected here.
