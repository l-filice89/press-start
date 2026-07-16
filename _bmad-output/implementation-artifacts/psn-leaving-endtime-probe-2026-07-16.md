# Probe: PS+ offer `endTime` = per-game departure date (Story 10.4 rework) — 2026-07-16

**Trigger:** Luca supplied a leaving game as anchor (Risk of Rain 2, departs 2026-07-21, `EP0290-PPSA06517_00-RISKOFRAIN2SIEE0`). Its store page (SSR) shows "L'offerta termina il 21/7/2026 08:00 AM UTC" — Sony DOES publish departure dates per product, which reopens what 10.2 recorded as unpublishable.

## Wire contract (all anonymous, persisted queries documented in mrt1m/playstation-store-api — the same public wrapper the catalog id was pinned from)

1. `metGetProductById` (hash `a128042177bd93dd…`), `{productId}` → `data.productRetrieve.concept.id` (RoR2 → concept `234386`).
2. `metGetPricingDataByConceptId` (hash `abcb311ea830e679…`), `{conceptId}` → offers carrying `serviceBranding: ["PS_PLUS"]` with **`endTime`: epoch-ms string or null**.

## Distribution (SAMPLE-OF-ONE rule — probed 6 catalog games live, `it-it`, 2026-07-16)

| Game | PS_PLUS offer `endTime` |
| --- | --- |
| Risk of Rain 2 (KNOWN leaving 21 Jul) | `"1784620800000"` = 2026-07-21T08:00Z on BOTH offer nodes — matches the announced date exactly |
| Black Desert | null |
| Hello Neighbor | null |
| Kingdom Come: Deliverance | null |
| Hollow Knight Voidheart Edition | null |
| ASTRONEER | null |

**Semantics confirmed:** `endTime` is a LEAVING date, not a rotation-window end every game carries — staying games answer null. A non-null `endTime` on the PS_PLUS-branded offer = the game leaves the catalog at that instant.

## Cost model (verified against production D1)

- Tracked games flagged `ps_plus_extra`: **39** (of 491 catalog products). Only these need the sweep.
- 2 calls per game first pass (concept resolve + pricing); the conceptId is stable → cached on `game`, steady state 1 call per game per window.

## Gate: PASS — story 10.4 reworked onto this contract (Luca approved the endTime-sweep design live, 2026-07-16). The "Last Chance to Play" category hunt (see `psn-last-chance-probe-2026-07-16.md`) is superseded: this signal is anonymous, discoverable, AND carries the exact date the category never had.

## Post-review amendment (same day)

The adversarial review found the branding-only match unsafe: a PS+-exclusive member DISCOUNT is also `serviceBranding: ["PS_PLUS"]`, and its `endTime` is the promo end. The shipped predicate requires the CATALOG-INCLUSION offer shape — `isFree: true, isTiedToSubscription: true` — which both captured payloads carry on their subscription nodes. Hollow-but-200 pricing replies (null `conceptRetrieve`, zero offer nodes) now fail closed, and `endTime` is bounds-checked (2015–2100) so an epoch-seconds regression can never write 1970.
