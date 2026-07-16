# IGDB Time-to-Beat Coverage Probe — 2026-07-16 (Story 10.3, first task)

Live probe against production D1 + `api.igdb.com/v4/game_time_to_beats`
(`scripts/probe-igdb-ttb-coverage.ts`), recorded next to the Story 10.1
score finding ([igdb-score-coverage-2026-07-16.md]) per the epic AC.

## Result

| Metric | Count | Coverage |
| --- | --- | --- |
| IGDB-linked games (population) | 65 | — |
| Story hours (`normally`) | 61 | 93.8% |
| 100% hours (`completely`) | 55 | 84.6% |
| Either value | 62 | 95.4% |

No-record titles (3): Mafia: Trilogy (133900), Contrast (3839),
Stick it to the Man! (6581) — render with the hours absent per VR-8.

Captured sample row (verbatim, the test fixture's source):
`{"id":3540,"game_id":159119,"normally":54000,"completely":95400,"count":8}`
— values are SECONDS (54000 = 15h story, 95400 = 26.5h 100%), keyed by
`game_id`, one record per game with a single submission `count`.

## Decision

**GATE PASS (≥50% `normally`): IGDB is the time-to-beat source.
HowLongToBeat is not built** — exactly the outcome the 2026-07-13 sprint
change proposal scoped ("if IGDB covers the library, ship it and HLTB
never gets written"). Whole population probed in one call (SAMPLE-OF-ONE
satisfied — full distribution, not a sample).
