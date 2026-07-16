# IGDB Score Coverage Probe — 2026-07-16 (Story 10.1, first task)

Live probe against the production D1 library and the IGDB v4 API
(`scripts/probe-igdb-score-coverage.ts`), same query shape the refresh job
uses: `fields id, aggregated_rating, aggregated_rating_count, rating,
rating_count; where id = (…); limit 500;` — one subrequest for the whole
id list.

## Result

| Metric | Count | Coverage |
| --- | --- | --- |
| IGDB-linked games (population) | 65 | — |
| Critic score (`aggregated_rating`) | 55 | 84.6% |
| User score (`rating`) | 61 | 93.8% |
| **Either score** | **63** | **96.9%** |
| Rows returned by IGDB | 65/65 | 100% |

Scoreless titles (2): Nioh 2 Remastered: The Complete Edition (143350),
Kingdom Hearts coded (20285) — both legitimately absent, render with no
score area per VR-5.

## Decision

**GATE PASS (≥60% either-score): IGDB is the score source. OpenCritic is
not built.** (Per sprint-change-proposal-2026-07-13 §3.3 the fallback is
named, not assumed — it stays unwritten unless coverage degrades.)

Notes:
- Population is the 65 IGDB-*linked* games, not the full ~175-game library:
  scores join on the stored IGDB external id, so unlinked/unenriched games
  cannot carry a score until they are enriched (their score area is absent —
  the same VR-5 rule). Straggler resolution, not this story, is the path
  that grows the linked population.
- Whole population fetched in ONE IGDB call (65 ids ≪ 500 limit) —
  SAMPLE-OF-ONE satisfied: this is the full distribution, not a sample.
- Story 10.3 records its time-to-beat coverage next to this file.
