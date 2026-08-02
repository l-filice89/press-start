---
title: 'Story 13.2: Tune recommendations intentionally'
type: 'feature'
created: '2026-08-02'
status: 'blocked'
review_loop_iteration: 0
followup_review_recommended: false
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
- `web/play-next/SuggestionCard.tsx` -- reuse Shelf/Catalog 3:4 cover composition, cover trigger, flags, ownership diamond/fallback glyph, facts, and card-level `Closest match`/`DISCOVER` presentation wherever compatible.
- `web/play-next/play-next.css` -- compact Tune trigger, centered desktop modal, phone bottom sheet, and Shelf/Catalog-aligned game-card layout.
- `web/play-next/PlayNextPage.test.tsx` -- draft/apply/reset, detail continuity, announcement, closest, and access behavior.
- `playwright/e2e/epic13-play-next.spec.ts`, `playwright/COVERAGE.md` -- real-D1 Story 13.2 visible flows and AC ledger.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/play-next.ts`, `src/core/play-next.test.ts` -- implement and pin intent matching before UI.
- [ ] `web/play-next/TunePanel.tsx`, `web/play-next/PlayNextPage.tsx` -- after approval, implement draft/applied state and one-shot application.
- [ ] `web/play-next/SuggestionCard.tsx`, `web/play-next/play-next.css` -- add approved closest/access treatment and responsive placement.
- [ ] `web/play-next/PlayNextPage.test.tsx` -- pin all state transitions, missing facts, detail persistence, and announcements.
- [ ] `playwright/e2e/epic13-play-next.spec.ts`, `playwright/COVERAGE.md` -- prove every visible Story 13.2 criterion.

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

## Spec Change Log

- 2026-08-02: Replaced inline/below Tune panel with Shelf/Catalog-style modal;
  aligned suggestion covers with existing Shelf/Catalog composition and icons
  following Luca's design correction.

## Review Triage Log

## Design Notes

Intent groups are exact: Genre = `Familiar | Different`; Time = `Quick win`; Backlog age = `Fresh | Forgotten`; Confidence = `Safe bet | Wildcard`; Priority = `Follow my list | Last chance`; Progress = `Finish them`. Each is nullable. `Include wishlist` is a pool control, not a match group.

Predicate reuse: Familiar overlaps normalized active Shelf anchors; Different requires a known genre with zero overlap. Quick win requires valid TTB ≤20h. Forgotten requires known backlog age ≥180 UTC days; Fresh requires known age <180. Safe bet reuses qualified critic ≥80/10 or user ≥80/20. Wildcard requires at least one known score/count pair and no Safe bet qualification; unknown confidence matches neither. Follow my list is raw `Up next`; Last chance is current PS+ leaving in 0–30 days; Finish them reuses `isFinishThem`.

Every matched active group adds named `intent-*` factor +24 for explanation inspection, but selection sorts intent distance before additive total, so points cannot move partial above exact. Distance is active-group count minus matched-group count. Fill in ascending distance; `closestMatch` is true only when distance >0. Within one distance tier, reuse Story 13.1 score/diversity/seed/id order. Explicit Finish removes the cap; otherwise default cap remains one.

Eligibility adds `wishlisted`: terminal/platinum/future rules stay absolute. Base access is owned/current PS+; `includeWishlist` additionally admits actual wishlisted games with neither, tagged `DISCOVER`. Missing facts never match Different, Fresh, Forgotten, Wildcard, or any other predicate.

ARIA pattern: semantic `fieldset`/`legend`; deselectable exclusive buttons use `aria-pressed`; native checkbox for wishlist; disclosure button exposes `aria-expanded`/`aria-controls`. Applied summary remains separate from draft indicator. `Show me 3` stays focused and uses existing polite live-region provider.

Placement mock: `_bmad-output/design-demos/epic-13-play-next/05-story-13-2-tune-modal.html`. Direction is an iteration of Luca-approved Option A; it does not reopen direction selection. Supersedes the rejected inline/below-controls structure in `04-story-13-2-tune-expanded.html`. Approval: **PENDING Story 13.2-specific sign-off.**

## Verification

**Commands:**
- `bun x vitest run --project unit src/core/play-next.test.ts`
- `bun x vitest run --project web web/play-next/PlayNextPage.test.tsx`
- `bun x playwright test playwright/e2e/epic13-play-next.spec.ts --workers=1`
- `bun run lint && bun run typecheck && bun run test && bun run build`

## Auto Run Result

Status: blocked
Blocking condition: UI-MOCK-GATE approval missing for revised Story 13.2 Tune modal and Shelf/Catalog-aligned cards. Luca must explicitly approve `_bmad-output/design-demos/epic-13-play-next/05-story-13-2-tune-modal.html` before UI implementation.
