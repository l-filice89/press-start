---
title: 'Story 13.2: Tune recommendations intentionally'
type: 'feature'
created: '2026-08-02'
status: 'done'
baseline_revision: 'f854622'
final_revision: '56dd11d'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Surprise me cannot express deliberate play intent, so a user cannot narrow recommendations without leaving Play Next or mentally filtering the slate.

**Approach:** Add ephemeral draft/applied tuning state, pure conjunctive intent matching with automatic closest-match fallback, and an Option A Tune modal that applies only on `Show me 3`.

## Boundaries & Constraints

**Always:** Keep intent predicates, distance, wishlist eligibility, exact/closest ordering, Finish them behavior, and match metadata pure in `src/core/`. Keep draft and applied intent separate in `PlayNextPage`; edits never regenerate. Active groups combine with AND and permit at most one choice each. Exact matches lead; relaxed cards say `Closest match`. Missing data proves neither side of an intent. Current PS+ remains eligible regardless of `Include wishlist`. Preserve visit state through detail.

**Block If:** Luca has not explicitly approved `_bmad-output/design-demos/epic-13-play-next/05-story-13-2-tune-modal.html` immediately before UI implementation; a requested visible claim requires a Shelf fact that does not exist.

**Never:** Add backend/schema/provider/persistence, mutate manual Shelf filters, implement Shuffle/seen/exhaustion, regenerate while draft controls change, treat missing data as a negative match, or let additive score place a partial match before an exact match.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Draft edit | One or more choices changed | Draft indicator changes; active label and ordered slate stay fixed | No implicit generation |
| Apply | `Show me 3` with changed canonical draft | Draft snapshots to active; one deterministic slate generation; count announced | Smaller honest slate allowed |
| Multi-group | Two or more active groups | Exact candidates satisfy every known predicate | AND, never OR |
| Sparse exact pool | Fewer than three exact candidates | Exact first; smallest-distance fills labeled `Closest match` | Never relax terminal/future rules |
| Missing fact | Predicate input absent | Candidate matches neither inverse | May appear only as closest |
| Wishlist off/on | Inaccessible wishlisted game | Excluded when off; admitted as `DISCOVER` when on | Owned/current-PS+ unchanged |
| Finish intent | Explicit Finish them | Finish candidates prioritized; default cap removed | Closest non-Finish fills if needed |
| Detail round-trip | Draft differs from active | Draft, active, slate, seed, and focus survive | Existing overlay error behavior stays |

</intent-contract>

## Code Map

- `src/core/play-next.ts` -- extend candidate with `wishlisted`, add intent types/predicates/distance/match factors, closest metadata, Discover access, and explicit-Finish cap rule.
- `src/core/play-next.test.ts` -- conjunctive, missing-data, wishlist, Finish, exact/closest, factor, and determinism hazards.
- `web/play-next/PlayNextPage.tsx` -- own visit Shelf snapshot, draft/applied intent, explicit generation, active summary, and live announcement.
- `web/play-next/TunePanel.tsx` -- Shelf/Catalog-style focus-trapped modal, grouped deselectable pressed buttons, wishlist checkbox, draft indicator, and apply control.
- `web/play-next/SuggestionCard.tsx` -- reuse Shelf/Catalog 3:4 cover composition, cover trigger, cover-error fallback, access/leaving flags, live ownership diamond/source dialog, facts, and card-level `Closest match`/`DISCOVER` presentation.
- `web/play-next/play-next.css` -- compact Tune trigger, centered desktop modal, phone bottom sheet, and Shelf/Catalog-aligned game-card layout.
- `web/play-next/PlayNextPage.test.tsx` -- draft/apply/reset, detail continuity, announcement, closest, and access behavior.
- `playwright/e2e/epic13-play-next.spec.ts`, `playwright/COVERAGE.md` -- real-D1 Story 13.2 visible flows and AC ledger.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/play-next.ts`, `src/core/play-next.test.ts` -- implement and pin intent matching before UI.
- [x] `web/play-next/TunePanel.tsx`, `web/play-next/PlayNextPage.tsx` -- after approval, implement draft/applied state and one-shot application.
- [x] `web/play-next/SuggestionCard.tsx`, `web/play-next/play-next.css` -- add approved closest/access treatment and responsive placement.
- [x] `web/play-next/PlayNextPage.test.tsx` -- pin all state transitions, missing facts, detail persistence, and announcements.
- [x] `playwright/e2e/epic13-play-next.spec.ts`, `playwright/COVERAGE.md` -- prove every visible Story 13.2 criterion.

**Acceptance Criteria:**
- Given the default slate, when Tune opens and draft choices change, then current cards and applied `SURPRISE ME` remain unchanged until `Show me 3`.
- Given each control group, when choices change, then zero or one value is pressed per group, groups are programmatically labeled, and `Include wishlist` is a checkbox.
- Given multiple applied groups, when recommendations derive, then exact matches satisfy all groups and always precede smallest-distance `Closest match` cards.
- Given a missing genre/date/TTB/score, when an inverse intent is active, then the missing fact proves no match and creates no claim.
- Given `Include wishlist` off/on, when the same Shelf snapshot derives, then inaccessible wishlist games are excluded/admitted as `DISCOVER`, while owned/current-PS+ eligibility is unchanged.
- Given explicit Finish them, when applied, then Finish candidates lead without the default one-card cap and any relaxed filler is visibly labeled.
- Given `Show me 3`, when applied, then exactly one generation occurs, focus stays stable, and a polite live region announces the honest result count.
- Given a routed detail round-trip or a new destination visit, when navigation completes, then the first preserves draft/applied/slate state and the second resets it.
- Given desktop and 320px phone, when Tune opens, then a modal backdrop isolates it, desktop uses a centered dialog, phone uses the existing filter-sheet disposition, focus is trapped/restored, Escape/backdrop dismiss, and every target is at least 44px.
- Given a suggestion card, when its cover renders, then it reuses Shelf/Catalog 3:4 proportions, cover detail trigger, known access/leaving flag placement, `◆/◇` ownership icon, and `▹` fallback wherever the candidate data supports them.
- Given a suggestion ownership diamond, when ownership changes, then it uses the existing guarded ownership mutation and source dialog rather than a duplicate or decorative control.

## Spec Change Log

- 2026-08-02: Replaced inline/below Tune panel with Shelf/Catalog-style modal;
  aligned suggestion covers with existing Shelf/Catalog composition and icons
  following Luca's design correction.

## Review Triage Log

### 2026-08-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 10, low 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` kept visit recommendation facts, reasons, factors, and ordering frozen across Shelf refetches while reconciling only ownership/access fields consistently.
  - `[medium]` `[patch]` disabled Tune until its visit snapshot exists and added intent-specific empty-state copy.
  - `[medium]` `[patch]` made UTC date predicates reject malformed and impossible calendar dates.
  - `[medium]` `[patch]` pinned unchanged-draft single generation, complete modal focus wrapping, ownership mutation confirmation, visit detail continuity/reset, and centered desktop geometry.
  - `[medium]` `[patch]` expanded real-D1 browser evidence for source-guarded ownership changes and phone control targets.
  - `[low]` `[patch]` scoped cover failures to the failed URL so a changed cover can retry.

## Design Notes

Intent groups are exact: Genre = `Familiar | Different`; Time = `Quick win`; Backlog age = `Fresh | Forgotten`; Confidence = `Safe bet | Wildcard`; Priority = `Follow my list | Last chance`; Progress = `Finish them`. Each is nullable. `Include wishlist` is a pool control, not a match group.

Public core shape is exact: `PlayNextIntent` has nullable `genre`, `time`, `backlogAge`, `confidence`, `priority`, and `progress` fields plus boolean `includeWishlist`; export `EMPTY_PLAY_NEXT_INTENT`. `getPlayNextSuggestions` accepts optional `intent` inside its existing options. `PlayNextSuggestion` adds integer `intentDistance` and boolean `closestMatch`; access tags expand to `OWNED | PS+ EXTRA | DISCOVER`. Default empty intent must preserve Story 13.1 outputs byte-for-byte except for the new metadata fields.

Predicate reuse: Familiar overlaps normalized active Shelf anchors; Different requires a known genre with zero overlap. Quick win requires valid TTB ≤20h. Forgotten requires known backlog age ≥180 UTC days; Fresh requires known age <180. Safe bet reuses qualified critic ≥80/10 or user ≥80/20. Wildcard requires at least one known score/count pair and no Safe bet qualification; unknown confidence matches neither. Follow my list is raw `Up next`; Last chance is current PS+ leaving in 0–30 days; Finish them reuses `isFinishThem`.

Every matched active group adds named `intent-*` factor +24 for explanation inspection, but selection sorts intent distance before additive total, so points cannot move partial above exact. Distance is active-group count minus matched-group count. Fill in ascending distance; `closestMatch` is true only when distance >0. Within one distance tier, reuse Story 13.1 score/diversity/seed/id order. Explicit Finish removes the cap; otherwise default cap remains one.

Base factors remain in their Story 13.1 order; matching intent factors append in fixed group order: genre, time, backlog age, confidence, priority, progress. Every greedy selection step first restricts candidates to the smallest remaining `intentDistance`; diversity and the third-card anti-duplicate alternative operate only inside that tier. This lexicographic boundary is a named hazard and requires a direct test.

Eligibility adds `wishlisted`: terminal/platinum/future rules stay absolute. Base access is owned/current PS+; `includeWishlist` additionally admits actual wishlisted games with neither, tagged `DISCOVER`. Missing facts never match Different, Fresh, Forgotten, Wildcard, or any other predicate.

A known confidence pair requires a finite score from 0 through 100 and a positive finite count. Malformed, negative, out-of-range, zero-count, or missing pairs match neither Safe bet nor Wildcard. `DISCOVER` cards retain live `Play this`; they already represent tracked wishlisted Shelf rows, and the existing guarded status write may move them to Playing.

ARIA pattern: semantic `fieldset`/`legend`; deselectable exclusive buttons use `aria-pressed`; native checkbox for wishlist; disclosure button exposes `aria-haspopup="dialog"`, `aria-expanded`, and `aria-controls`. The portal dialog reuses `useModalTrap`, locks/restores body scroll, closes on Escape/backdrop/close/apply, and restores focus to the Tune trigger. Dismissal preserves the draft. `Show me 3` derives exactly once even when unchanged, snapshots draft to active, closes, restores trigger focus, and announces the honest count through the existing polite live region.

Applied readback is exact: empty active intent renders `SURPRISE ME`; otherwise render active choice labels in group order, followed by `INCLUDE WISHLIST` when enabled. Trigger badge count equals active group choices plus the wishlist pool control. Draft edits never change either readback or badge. New destination mount resets draft, active intent, visit Shelf snapshot, seed, and slate; routed detail preserves all of them.

Placement mock: `_bmad-output/design-demos/epic-13-play-next/05-story-13-2-tune-modal.html`. Direction is an iteration of Luca-approved Option A; it does not reopen direction selection. Supersedes the rejected inline/below-controls structure in `04-story-13-2-tune-expanded.html`. Approval received verbatim on 2026-08-02: `Use this as a mock: [05-story-13-2-tune-modal.html](_bmad-output/design-demos/epic-13-play-next/05-story-13-2-tune-modal.html)`. The app-aligned mock is binding for UI implementation.

## Verification

**Commands:**
- `bun x vitest run --project unit src/core/play-next.test.ts`
- `bun x vitest run --project web web/play-next/PlayNextPage.test.tsx`
- `bun x playwright test playwright/e2e/epic13-play-next.spec.ts --workers=1`
- `bun run lint && bun run typecheck && bun run test && bun run build`

## Auto Run Result

Status: done

Summary: shipped ephemeral Tune draft/applied state, conjunctive exact-first intent matching with closest fallback, wishlist discovery, explicit Finish behavior, approved Shelf/Catalog-style modal, and app-aligned suggestion covers with guarded ownership controls.

Review findings: 11 patches applied (high 0, medium 10, low 1); 0 deferred; 0 rejected. Significant cross-layer review changes require independent follow-up (`followup_review_recommended: true`).

Verification: core 19/19; targeted web 15/15; Epic 13 Playwright 6/6 across full run plus corrected final-case retry; full Vitest 2159/2159 with `--maxWorkers=2`; lint, typecheck, build, and `git diff --check` pass. Initial unrestricted full-suite run suffered unrelated local resource-starvation timeouts; clean bounded-worker retry passed.
