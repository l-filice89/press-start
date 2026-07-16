# Sprint Change Proposal — Time-to-beat Shelf Filter (2026-07-16)

**Status: approved & applied (Luca, 2026-07-16).** Scope: **Moderate** — a new one-story
epic; no code exists to change, no story in flight. All §4 edits applied same session.

## 1. Issue

Luca wants to filter the shelf by how long a game takes to beat — bands: ≤25h, 25–50h,
50–75h, 75–100h, >100h. Split from the 2026-07-16 minor-bugs sweep as epic/story-sized
(deferred-work.md, unhomed entry `source_spec: none`). The filter system (Epic 3) has no
time dimension; the data already exists — Story 10.3 persisted `ttbStorySeconds`,
`ttbCompleteSeconds`, `ttbCount` on every game and the shelf payload already carries them.

## 2. Impact

- **Epics:** Epic 3 (filters) and Epic 10 (TTB data) are both done, retroed, and merged —
  neither reopens. No future epic is invalidated; Epic 8 unaffected (TTB is a game-level
  fact, correctly global). New home needed.
- **Stories:** one new story. All work is client-side: a new group in
  `web/shelf/filters.ts` + `FilterRow`/`FilterSheet`, summary-sentence integration, e2e.
  No schema, no API, no cron.
- **Artifacts:** `epics.md` (VR-9, coverage map, Epic 12 entry + story), `prd.md`
  (§3 FR-20 table row, §6 v1.x bullet), `roadmap.md` (v1.x row),
  `sprint-status.yaml` (epic-12 backlog entries), `deferred-work.md` (decision line).
- **Technical:** none until built. Pure client predicate over fields already on the
  payload (AD-7 posture: server computes facts, client filters).

## 3. Approach — Direct Adjustment: new Epic 12, one story

Neither done epic reopens (both merged + retroed; the working pattern is epic = branch =
merge gate = retro). A one-story **Epic 12** follows the Epic 11 precedent for
correct-course-born epics and keeps the process machinery intact. Rejected: Story 3.7 /
10.6 in a closed epic (reopening a retroed epic for new scope, not follow-ups), and
bundling with bug sweeps (Luca explicitly split it out).

Decisions taken in this session (Luca, 2026-07-16):

- **Both metrics, toggle** — bands evaluate against **story** hours by default; a
  story/100% toggle inside the group switches the metric.
- **Unknown band** — a game missing the selected metric matches only an explicit
  `Unknown` band pill, never a numeric band and never silently shown (NFR-4 posture).
- **Five bands as sketched**, half-open so no game matches two: ≤25 · >25–50 · >50–75 ·
  >75–100 · >100.

Effort: small-medium — one filter group, one toggle, summary + sheet + e2e. Risk: low;
the only design risk is filter-row crowding on desktop, owned by the UI-MOCK-GATE.

## 4. Detailed changes

### 4.1 `epics.md` — Post-v1 Requirements: add VR-9

```
- **VR-9** — **Time-to-beat shelf filter**: a new shelf filter group over the VR-8
  hours — five bands (≤25h, 25–50h, 50–75h, 75–100h, >100h) plus an explicit
  `Unknown`, OR within the group, AND across groups (FR-20 semantics), evaluated
  against story hours by default with a story/100% toggle. Pure client-side over the
  persisted 10.3 fields — no new data, no new fetch. [new 2026-07-16,
  sprint-change-proposal-2026-07-16-ttb-filter]
```

Coverage map: `VR-9 → E12`.

### 4.2 `epics.md` — Epic List entry + section

```
### Epic 12: Fit the Time I Have — the Time-to-beat Filter — _v1.x, after Epic 10_
The shelf answers "what can I actually finish?" — a time-to-beat filter group narrows
the backlog to games that fit the hours available, riding the TTB data Story 10.3
already persists. One story; pure client-side filter-system revision.
**VRs covered:** VR-9 · reuses FR-20/21 semantics (OR within, AND across), AD-7
(server computes, client filters), Story 10.3 fields
```

### 4.3 `epics.md` — Story 12.1

```
### Story 12.1: Filter the shelf by time-to-beat bands (VR-9)

As Luca,
I want to filter the shelf by how many hours a game takes,
So that I pick a game that fits the time I actually have — the 10.3 numbers become
a lens, not just a label.

**Acceptance Criteria:**

**Given** the filter row
**When** it renders
**Then** a Time group offers five bands — ≤25h, 25–50h, 50–75h, 75–100h, >100h — plus
`Unknown`, OR within the group, AND across groups (FR-20 amended) [VR-9, FR-20]

**Given** band boundaries
**When** a game's hours land exactly on one (e.g. 50h)
**Then** it matches exactly one band — bands are half-open (25 < h ≤ 50), no overlap,
no gap [VR-9]

**Given** the story/100% toggle inside the group
**When** it switches
**Then** every selected band re-evaluates against the chosen metric (default: story
hours); the toggle is part of the filter state, not a global setting [VR-9, Luca 2026-07-16]

**Given** a game missing the selected metric (IGDB gap, unenriched, or only the other
value)
**When** a band filter is active
**Then** it matches only the `Unknown` band — never a numeric band, never a zero
standing in for a value (the 10.3 absence contract extended to filtering) [VR-9, NFR-4]

**Given** active Time selections
**When** the shelf renders
**Then** the live summary sentence narrates them with the same or/and words and the
mobile filter sheet carries the group + count badge [FR-20, UX-DR23, UX-DR26]

**Given** the standing rules
**When** this story is specced
**Then** it carries a placement-level UI mock signed off by Luca before implementation
(UI-MOCK-GATE) and ships Playwright coverage for every UI AC (PLAYWRIGHT-COVERAGE)
```

### 4.4 `prd.md` — §3 Filters table (FR-20): new group row

```
| Time to beat *(v1.x, VR-9 — added 2026-07-16)* | Band pills + story/100% toggle | `≤25h`, `25–50h`, `50–75h`, `75–100h`, `>100h`, `Unknown` — OR among themselves; AND against other groups |
```

### 4.5 `prd.md` — §6 v1.x: extend the time-to-beat bullet

Append to the existing Time to beat bullet:

```
 A **shelf filter over these hours** (five bands + Unknown, story/100% toggle) is
 VR-9 / Epic 12 — added 2026-07-16.
```

### 4.6 `roadmap.md` — v1.x row for VR-9 / Epic 12

### 4.7 `sprint-status.yaml`

```
  # Epic 12: Fit the Time I Have — the Time-to-beat Filter — v1.x, after Epic 10
  # Added 2026-07-16 via correct-course (sprint-change-proposal-2026-07-16-ttb-filter.md)
  epic-12: backlog
  12-1-filter-the-shelf-by-time-to-beat-bands: backlog
  epic-12-retrospective: optional
```

### 4.8 `deferred-work.md` — decision line on the unhomed entry

```
  decision: 2026-07-16 Homed in Story 12.1 (Epic 12, VR-9) via correct-course
  (sprint-change-proposal-2026-07-16-ttb-filter.md) — five bands + Unknown,
  story/100% toggle, half-open boundaries. Ledger closes when 12.1 ships.
```

## 5. Handoff

**Moderate** — backlog reorganization (new epic), then standard dev flow.

- **PO/epics (this session, on approval):** apply §4 edits.
- **Developer (later):** run Story 12.1 through create-story → dev-auto as usual.
  Success criteria: bands filter correctly on both metrics, `Unknown` honest,
  summary + sheet + e2e green. The spec must clear UI-MOCK-GATE and EXTERNAL-RISK-FLAG
  is N/A (no external call). `EXPERIENCE.md`'s filter-row line gains the group when
  the mock is signed off — design decisions live with the story, not this proposal.
