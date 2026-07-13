# Sprint Change Proposal — Time to Beat (2026-07-13)

**Status: approved & applied.** Scope: **Minor** — a scoped-but-not-started story added
to a scoped-but-not-started epic. No code exists to change, no story is in flight.

## 1. Issue

Luca asked for HowLongToBeat integration: hours to finish the story, hours to 100%.
The roadmap had no home for it. The nearest existing entry — Future, *"Playtime"* — is a
different thing (hours *he* put in, not hours the game takes) and was reading as coverage
it never provided.

## 2. Impact

- **Epic:** Epic 10 (*Know Before You Play*) — the decision-support epic. Same shape as
  Story 10.1 (scores): a game fact, fetched from a games DB, stored, refreshed on a cron,
  rendered from storage.
- **Stories:** one new — **10.3**. Depends on 10.1 (shares its refresh job). No existing
  story changes.
- **Artifacts:** `epics.md` (VR-8, coverage map, Epic 10 intro ×2, Story 10.3),
  `prd.md` (§6 v1.x bullet, §6 Future disambiguation, open-q #6), `roadmap.md`
  (v1.x row, Epic 10 summary, Future disambiguation).
- **Technical:** none until built. Reuses `IgdbProvider` (AR-5); no new adapter, no new
  credentials, no new cron.

## 3. Approach — Direct Adjustment, and a source swap

**HowLongToBeat is the fallback, not the source. IGDB is the source.**

IGDB's `/game_time_to_beats` returns `normally` / `completely` / `count` keyed by
`game_id` — the same data shape the request asked for, joined on the `igdbId` already
stored on every enriched game. HLTB has no official API: the community path is an
internal Next.js endpoint that breaks on their rebuilds, and with no shared id it must
match on **title** — the same fuzzy-matching class of bug PV-6 exists to fix.

This is the identical call made for scores on the same day (open-q #5 → IGDB, OpenCritic
as fallback), for the identical reason. Coverage is verified against the real ~175 titles
as the story's first task; if IGDB's user-submitted numbers are thin, HLTB comes in as a
second adapter behind the same port. **The fallback is named, not assumed away.**

Effort: small — one endpoint on a provider we own, two columns, one render slot, and a
refresh already scheduled. Risk: coverage, and coverage alone — measured before anything
is built on it.

## 4. Changes applied

| Artifact | Change |
| --- | --- |
| `epics.md` | **VR-8** added to Post-v1 Requirements; coverage map → `VR-5, VR-6, VR-8 → E10`; Epic 10 list entry and section intro "Two signals" → **three**; **Story 10.3** written with full ACs |
| `prd.md` | §6 v1.x: time-to-beat bullet (with the *not personal playtime* fence). §6 Future: "playtime" → "**personal** playtime tracking". §7: **open-q #6**, resolved to IGDB, open until the 10.3 coverage check |
| `roadmap.md` | v1.x table row; Epic 10 summary → 10.3; Future row disambiguated |

## 5. Handoff

**Developer** — nothing to implement now. Story 10.3 is v1.x, sequenced after 10.1.
Success criterion for whoever picks it up: **the coverage check runs first.** If IGDB
covers the library, ship it and HLTB never gets written. If it doesn't, HLTB is a second
adapter behind the existing port — never a rewrite.
