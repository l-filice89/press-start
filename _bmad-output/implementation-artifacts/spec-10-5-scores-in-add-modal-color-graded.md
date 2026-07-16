---
title: 'Story 10.5: Scores in the add-game modal, color-graded everywhere (VR-5 follow-on)'
type: 'feature'
created: '2026-07-16'
status: 'done'
review_loop_iteration: 0
baseline_revision: 'b2bdc7f'
final_revision: '2c1655d'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: ['multiple-goals']
---

<intent-contract>

## Intent

**Problem:** Luca's "hear about a game → check ratings → add if ~75+" flow leaves the app: candidate rows in the add/rematch/straggler pickers show no scores (the data is already in every response), and rendered scores carry no at-a-glance quality signal.

**Approach:** Pure UI. Render `criticScore`/`userScore` (already on `IgdbCandidate`, server AND client) in the one shared `IgdbMatchPicker` row — covering add, rematch, and straggler pickers at once — and color-grade every rendered score (card, detail panel, candidate rows) via a shared grade helper + CSS classes: ≤60 red, 61–74 yellow (warn-amber), ≥75 green. One new AA-safe red token; number always present; sr-only text unchanged.

## EXTERNAL-RISK-FLAG (mandatory, Epic 11 rule)

No external surface: zero new fetches, zero API/DTO changes — renders data already persisted/echoed (10.1). Nothing on the wire.

## Boundaries & Constraints

**Always:**
- No new fetch, no API/DTO/service change (carried from `spec-card-info-compact-stacked-scores.md` Never-clause: 10.5 owns color grading, not data).
- Grading buckets apply to the ROUNDED value the user sees: rounded ≤60 red, 61–74 yellow, ≥75 green — boundary values (60, 61, 74, 75) test-pinned (HAZARD-TEST).
- Yellow = `--color-warn-amber`; green = `--color-success-green`; red = a NEW light-tint token in `web/tokens.css` (none exists; `--color-heat-magenta` is reserved for Playing, never reuse it) — all three ≥4.5:1 on `--color-surface`/`--color-surface-raised`, ratio documented at the token like the muted-floor note.
- Never color-only: the numeric value stays rendered; sr-only strings byte-for-byte unchanged (grading is presentation-only).
- Missing score → slot absent (existing NFR-4 rule) — candidate rows included; a score of 0 is a real (red) score, not an absent slot.
- Candidate row shows critic AND user score when present, TTB never (Luca: "never a decision breaker"); markup mirrors Card's `aria-hidden` glyph + `sr-only` pattern.
- One grade helper shared by Card, DetailPanel, and IgdbMatchPicker — no per-component threshold copies.
- Dark theme only (tokens.css:8) — no light-theme variants.

**Block If:** (none — no unattended-undecidable branches; all data verified already on the wire.)

**Never:** TTB in any picker row; new API fields; touching `candidateScores()` write-payload plumbing; changing score rounding/compaction shipped by 10.1/card-info stories.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Scored candidate | `criticScore: 88.5, userScore: 71` | Row shows 89 green + 71 yellow, each with sr-only text | none |
| Boundary values | rounded 60 / 61 / 74 / 75 | red / yellow / yellow / green — exact bucket edges | none |
| Rounding across a boundary | `criticScore: 74.6` | rounds to 75 → green (grade follows displayed value) | none |
| Unscored candidate | both scores null | no score slot in the row — never a zero or gray pill | none |
| One score only | critic set, user null | only the critic slot renders, graded | none |
| Zero score | `userScore: 0` | renders 0, red — real value, not absent | none |
| Card/detail regrade | existing scored games | same numbers, now bucket-colored on card + detail | none |

</intent-contract>

## Code Map

- `web/tokens.css` -- new AA-safe red grading token (+ ratio comment beside the :21 muted-floor note); amber/green reused
- `web/shelf/score-grade.ts` (new, tiny) -- `scoreGrade(score): 'low' | 'mid' | 'high'` over the rounded value
- `web/shelf/IgdbMatchPicker.tsx` (:84-108 row) -- critic/user score spans (aria-hidden glyph + sr-only), absent-safe, grade class
- `web/shelf/stragglers-dialog.css` -- candidate score styling (shared by add/rematch/straggler dialogs)
- `web/shelf/Card.tsx` (:222-256) + `card.css` (:282 `--critic` accent rule dies) -- grade classes on `.card__score--critic/--user`
- `web/shelf/DetailPanel.tsx` (:325-406) + `detail-panel.css` -- grade classes on `.detail-panel__score-value`
- tests: `web/shelf/score-grade.test.ts` (boundaries), `Card.test.tsx` + `DetailPanel.test.tsx` (grade classes, sr-only unchanged), `AddGameDialog.test.tsx` (scored candidate row renders scores; unscored absent), `playwright/e2e/epic10-scores.spec.ts` (candidate-row scores in add modal + color grading assertions), `playwright/COVERAGE.md` 10.5 rows

## Tasks & Acceptance

**Execution:**
- [x] `web/tokens.css` -- red grading token, contrast ratio documented
- [x] `web/shelf/score-grade.ts` -- shared bucket helper (rounded value)
- [x] `web/shelf/IgdbMatchPicker.tsx` + `stragglers-dialog.css` -- score slots in the shared candidate row, graded, absent-safe
- [x] `web/shelf/Card.tsx`/`card.css` + `web/shelf/DetailPanel.tsx`/`detail-panel.css` -- apply grade classes to existing score renders
- [x] tests -- helper boundaries; jsdom Card/Detail grade classes + sr-only unchanged; AddGameDialog scored/unscored rows; Playwright add-modal candidate scores + grading; COVERAGE.md rows
- [x] verification pass -- typecheck, lint, vitest, playwright epic10 + epic6 (picker consumers)

**Acceptance Criteria:**
- Given add/rematch/straggler candidates render, when a candidate carries scores, then critic and user scores show in its row from the response data — no new fetch, no TTB.
- Given any rendered score (card, detail, candidate row), when it displays, then it carries the bucket color for its rounded value with AA contrast, the number present, sr-only unchanged.
- Given a candidate or game with no score, when it renders, then the slot is absent — never zero, never a gray pill.

## Spec Change Log

## Review Triage Log

### 2026-07-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 1, low 9)
- defer: 1: (high 0, medium 0, low 1)
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` The add modal's PRIMARY path showed no scores — the auto-match preview (where the add decision is made) rendered fields only; ratings appeared solely inside the correction picker. Both the epic intent ("check ratings -> add if ~75+") and the data (preview response carries the fields) covered it. Fixed: the ACTIVE candidate's (picked ?? auto-match) scores render on the preview via the new shared `ScoreBadges`; jsdom + e2e pins added
  - `[low]` `[patch]` Fourth-consumer trigger fired -> the duplicated glyph/sr-only badge markup extracted into `web/shelf/ScoreBadges.tsx` (picker + preview); Card/Detail keep their shipped, differently-laid-out markup — the THRESHOLD stays single-sourced in `scoreGrade`
  - `[low]` `[patch]` `scoreGrade` graded non-finite input green (both <= checks false -> 'high') — `Number.isFinite` guard -> 'low', domain comment, test pin
  - `[low]` `[patch]` Contrast ratios documented for only one of three tokens (spec required all three) — amber 10.2:1 and green 12.2:1 notes added in tokens.css
  - `[low]` `[patch]` Card test comment claimed "byte-identical" a11y strings while asserting substrings — now an exact `.sr-only` textContent compare
  - `[low]` `[patch]` The I/O matrix's zero-score row had no render-layer test (a future truthiness guard would silently drop real 0 scores) — jsdom pin: `userScore: 0` renders "★ 0" red
  - `[low]` `[patch]` Nothing pinned that RematchDialog/StragglersDialog keep USING the shared picker (scores would vanish there with all tests green) — one scored-row pin per caller
  - `[low]` `[patch]` DetailPanel test indexed score nodes positionally (`values[2]`) — now selected by meaning (Critics/Players/Story)
  - `[low]` `[patch]` Encapsulation-test comment misled ("stays covered by every credentialed pattern below" implied more than it said) — reworded: probe not spent (10.4 unblock path), credentialed patterns apply unweakened
  - `[low]` `[patch]` e2e/jsdom selectors updated for the ScoreBadges extraction (`.score-badge(s)` replace the stragglers-css hooks, which were removed)

## Verification

**Commands:**
- `bun run typecheck && bun run lint` -- expected: clean
- `bun run test` -- expected: green incl. new boundary + row tests
- `bunx playwright test epic10 epic6` -- expected: green


## Design Notes

- `scoreGrade` is the ONLY home of the bucket thresholds; `ScoreBadges` is the only home of the ◎/★ badge markup for candidate-shaped consumers. Card/Detail keep their own (pre-10.5, tested) markup but grade through the same helper.
- score-grade.css uses a doubled-class selector (0,2,0) so grades beat single-class component color rules regardless of CSS bundle order — bundle order follows the import graph and is not a contract. The e2e computed-color asserts pin this in the real bundle.

## Auto Run Result

- **Outcome:** done — all tasks complete, dual adversarial review triaged (10 patched / 1 deferred / 4 rejected), all patches verified green.
- **Summary:** candidate scores render in the shared `IgdbMatchPicker` row AND on the add modal's preview pane (review-widened — the primary decision screen), via a new shared `ScoreBadges` component; every rendered score (card, detail, candidate, preview) is color-graded on its rounded value (<=60 red / 61-74 amber / >=75 green) through one `scoreGrade` helper + doubled-specificity CSS classes; new AA-safe `--color-danger-red` token (7.9:1), amber/green ratios documented. Zero wire changes.
- **Files (key):** new `web/shelf/score-grade.ts|.css|.test.ts`, `web/shelf/ScoreBadges.tsx`; `IgdbMatchPicker.tsx`, `AddGameDialog.tsx`, `Card.tsx`+`card.css` (accent tint replaced by grading), `DetailPanel.tsx`, `web/tokens.css`; tests: Card/DetailPanel/AddGameDialog/Rematch/Stragglers jsdom pins, `epic10-scores.spec.ts` computed-color + route-stubbed picker/preview e2e, COVERAGE.md 10.5 rows. Plus `src/providers/psn-encapsulation.test.ts`: allowlists story 10.4's committed probe for the two ANONYMOUS patterns (10.4-commit fallout — the suite had not been run on that housekeeping commit).
- **Review:** 1 medium (preview-pane scores, fixed) + 9 low patches; 1 defer (`.sr-only` defined only in card.css yet used app-wide incl. catalog/ — pre-existing cross-file leak); 4 rejects (delete-the-probe recommendation — probe is 10.4's unblock path; response-schema min/max clamps — one weird score must not fail the whole shelf parse read-path-closed; "from 0 reviews" sr-only shape — mirrors the shipped Card pattern, IGDB does not emit count-0-with-score; badge-markup dedup beyond the two new consumers — YAGNI until a fifth).
- **Verification:** `tsc -b` clean; biome clean; vitest 1894/1894 (74 files); Playwright epic10+epic6 33/33 (incl. the two flaky-on-this-machine tests passing; the earlier CSV-export failure reproduces on the BASELINE commit — environmental EPERM on the download temp file, not a regression).
- **Residual risks:** grading trusts the wire's 0-100 domain (values >100 would grade green — nothing upstream emits them; helper guards non-finite); `.sr-only` cross-file dependency ledgered.
