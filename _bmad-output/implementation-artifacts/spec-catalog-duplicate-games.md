---
title: 'Catalog duplicate games — collapse edition pairs the platform-disjoint rule misses'
type: 'bugfix'
created: '2026-07-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: '04f11bfcbdd8f47cab6d015717ed49acf1b5d9bc'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Prod Catalog renders the same game twice (e.g. Crow Country, Deliver Us the Moon). Probe of prod `ps_plus_catalog` (it-it/extra, 2026-07-23) found 27 same-`title_normalized` SKU pairs + 2 suffix-variant pairs; ~13 of them defeat `collapseEditions`, whose collapse predicate requires **disjoint** platform lists — but the store often marks BOTH SKUs of a cross-gen pair `["PS4","PS5"]` (Crow Country, GoW Ragnarök, Hotline Miami 1/2, Syberia TWB, Oddworld, Assetto Corsa, Maneater, Kingdom Come, Rain World, Bang-On Balls; plus Concrete Genie: two SKUs sharing one `np_title_id`). Separately, bare trailing platform suffixes ("Deliver Us The Moon **PS4 & PS5**", Human: Fall Flat, Lake, Maneater) survive `normalizeTitle` — it only strips *parenthesized* tags — so the pair never shares a title key, which also breaks the catalog's title-key library marker.

**Approach:** (1) Extend `normalizeTitle` to strip a trailing *bare combined* platform run ("… PS4 & PS5", incl. `,`/`/`/`and` separators) — combined-only (≥2 tokens), never a lone trailing "PS4"/"PS5" (probed: only combined forms exist in prod, both tables). (2) Rework the `collapseEditions` predicate: same title collapses when SKUs share an `np_title_id`, OR are cross-generation (`CUSA…` vs `PPSA…` prefix), OR have disjoint platform lists (kept for null-`np_title_id` rows). PS5-native SKU still wins the card. Snapshot rows self-heal: the sweep upsert rewrites `title_normalized` on every refresh.

## Boundaries & Constraints

**Always:** One shared `normalizeTitle` (AD-9) — extend it, never fork a catalog-only variant. Snapshot stays a faithful store mirror (AD-24): both SKU rows persist; only the browse view collapses. Genre facet counts keep running the same `collapseEditions` pipeline (DW-11 chip parity). Two same-title rows that are BOTH PS5-native (`PPSA` + `PPSA`, distinct ids) stay two cards — different games may share a normalized title.

**Ask First:** Stripping a *single* trailing platform token, or any new normalizer rule beyond the combined-run strip. Any schema/migration change.

**Never:** No writes to `ps_plus_catalog` from the browse path. No prod data patching by hand — the sweep upsert heals `title_normalized`. No changes to add/seed/rematch identity logic (out of scope — duplicates live in the catalog view, prod `game` table probed clean).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Overlapping-platform pair | same title; `CUSA…` `["PS4","PS5"]` + `PPSA…` `["PS4","PS5"]` | one card, PPSA SKU wins | N/A |
| Same np_title_id twice | same title + same `np_title_id`, two product_ids (Concrete Genie) | one card | N/A |
| Bare suffix variant | "Deliver Us The Moon PS4 & PS5" | normalizes to `deliver us the moon` → collapses with plain SKU | N/A |
| Combined-run forms | "X PS4 & PS5", "X PS4/PS5", "X PS4, PS5", "X PlayStation 4 and PS5" | suffix stripped | N/A |
| Lone trailing token | "Everybody's Golf PS4" (hypothetical) | NOT stripped — key unchanged | N/A |
| Same-title different games | two `PPSA` rows, distinct `np_title_id`, both `["PS5"]` | two cards | N/A |
| Null np_title_id | same title, one row `np_title_id` null, disjoint platforms | collapses (legacy rule) | N/A |
| Null np_title_id, overlap | same title, null id, overlapping platforms | two cards (no evidence of same game) | N/A |

</frozen-after-approval>

## Code Map

- `src/core/title-normalizer.ts` -- `normalizeTitle` (AD-9 single normalizer); `PLATFORM_TOKEN` already defined — reuse for the trailing bare-run pattern
- `src/core/title-normalizer.test.ts` -- normalizer unit tests
- `src/services/psplus-browse.ts` -- `collapseEditions` (line ~117) + its doc comment (lines 84–101) claiming disjoint-platforms is safe — both change; `browseCatalog` + `listCatalogGenreFacets` consume it unchanged
- `test/integration/psplus-browse.test.ts` -- browse integration tests (seeded snapshot rows)
- `playwright/e2e/epic7-catalog.spec.ts` + `playwright/COVERAGE.md` -- catalog e2e + coverage map
- `src/repositories/psplus-catalog.ts` -- upsert (`onConflictDoUpdate` rewrites `title_normalized` each sweep) — read-only context, no change

## Tasks & Acceptance

**Execution:**
- [x] `src/core/title-normalizer.ts` -- add trailing bare combined-platform-run strip (reuse `PLATFORM_TOKEN`; ≥2 tokens joined by `&`/`,`/`/`/`and`; optional `:`/`-`/`–`/`—` lead separator) -- heals suffix-variant pairs at the shared key
- [x] `src/core/title-normalizer.test.ts` -- hazard tests: all four combined forms strip; lone trailing "PS4" does NOT; parenthesized tags still strip -- HAZARD-TEST
- [x] `src/services/psplus-browse.ts` -- rework `collapseEditions` predicate (shared `np_title_id` OR `CUSA`/`PPSA` cross-gen OR disjoint platforms; PS5-native wins) + rewrite the block comment to match reality (store platform lists are NOT reliable disjointness evidence — probed 2026-07-23) -- root-cause fix
- [x] `test/integration/psplus-browse.test.ts` -- hazard tests from the I/O matrix: overlapping-platform pair → one card (PPSA wins); same-np_title_id pair → one card; both-PPSA distinct games → two cards; null-id overlap → two cards; facet count reflects collapsed cards -- HAZARD-TEST
- [x] `playwright/e2e/epic7-catalog.spec.ts` -- e2e: seed a same-title CUSA/PPSA pair with overlapping platforms, grid shows ONE card; update `playwright/COVERAGE.md` -- E2E-COVERAGE
- [ ] post-deploy ops (manual, no code) -- no manual trigger exists (Story 8.4/AD-31 removed button + route; refreshes are cron-only, `0 9,21 15-28 * *`): after deploy, wait for the next cron pass to rewrite `title_normalized`, then re-run the dup-pair probe query — expect suffix variants merged and grid deduped. Predicate-class pairs dedupe on deploy alone.

**Acceptance Criteria:**
- Given the prod it-it/extra snapshot re-swept post-deploy, when the Catalog grid renders, then Crow Country and Deliver Us the Moon each show exactly one card.
- Given a genre whose tag rows include a collapsed pair, when facet counts render, then the chip count equals the filtered grid's card count (DW-11 parity).
- Given a library game matching a suffix-variant catalog row ("Deliver Us the Moon"), when the grid renders post-sweep, then the card carries the In library/Owned marker (title key now joins).

## Spec Change Log

## Design Notes

Generation prefix is the discriminator the store itself uses: every real cross-gen edition pair in the probed population is `CUSA…` (PS4-era) vs `PPSA…` (PS5-era); no counterexample exists in prod. Remaster-onto-original collapses (TLOU2/HZD Remastered) already happen today via the edition-suffix strip — same posture, not a new risk. External surface: none touched (read-path + pure function only) — no risk flag needed.

## Verification

**Commands:**
- `bun run test` -- expected: suite green incl. new normalizer + browse hazard tests
- `bun run test:e2e` -- expected: epic7-catalog green incl. new collapse spec
- `bunx biome check src test` -- expected: clean

**Manual checks (if no CLI):**
- Post-deploy: dup-pair probe SQL (same-title pairs per region+tier) returns only pairs the new predicate collapses; prod Catalog spot-check Crow Country / Deliver Us the Moon.

## Suggested Review Order

**Collapse predicate (the root-cause fix)**

- Rewritten design comment: why platform disjointness is unreliable, what evidence collapses instead
  [`psplus-browse.ts:84`](../../src/services/psplus-browse.ts#L84)

- `isEditionPair` — the three evidence rules (shared id, CUSA/PPSA cross-gen, legacy disjointness)
  [`psplus-browse.ts:135`](../../src/services/psplus-browse.ts#L135)

- `beatsForCard` — PPSA-native SKU wins the surviving card
  [`psplus-browse.ts:149`](../../src/services/psplus-browse.ts#L149)

- `collapseEditions` loop unchanged in shape; empty-title guard kept, empty-platform rows now id-collapsible
  [`psplus-browse.ts:156`](../../src/services/psplus-browse.ts#L156)

**Normalizer (the suffix-variant fix)**

- `BARE_PLATFORM_RUN_PATTERN` — combined-only (≥2 tokens), optional lead separator, never a lone token
  [`title-normalizer.ts:50`](../../src/core/title-normalizer.ts#L50)

- Pipeline placement + the post-suffix re-check (suffix strip can expose a trailing run)
  [`title-normalizer.ts:101`](../../src/core/title-normalizer.ts#L101)

**Tests**

- Hazard matrix: overlapping-platform pair, shared id, both-PPSA stay apart, null-id rows, row-order winner
  [`psplus-browse.test.ts:235`](../../test/integration/psplus-browse.test.ts#L235)

- Normalizer hazards: all separator forms, lone token untouched, suffix-ordering fold
  [`title-normalizer.test.ts:40`](../../src/core/title-normalizer.test.ts#L40)

- E2E: seeded CUSA/PPSA pair renders one card, PPSA claim link survives
  [`epic7-catalog.spec.ts:131`](../../playwright/e2e/epic7-catalog.spec.ts#L131)

- Coverage-map row 7.2l + seed helper platform/id knobs
  [`COVERAGE.md:314`](../../playwright/COVERAGE.md#L314)
