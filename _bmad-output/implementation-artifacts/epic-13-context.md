# Epic 13 Context: Choose What to Play Next

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Play Next removes next-game choice fatigue through a standalone, transparent recommendation flow over data already available to Shelf. It immediately offers three varied suggestions, supports deliberate tuning and non-repeating exploration, and turns a recommendation into the existing `Playing` lifecycle action without changing manual Shelf filtering.

## Stories

- Story 13.1: Get three transparent suggestions
- Story 13.2: Tune recommendations intentionally
- Story 13.3: Shuffle without repetition
- Story 13.4: Act on a recommendation and harden the flow

## Requirements & Constraints

- Every visit starts with a varied three-game Surprise me slate when at least three eligible candidates exist; no setup question blocks initial results.
- Eligible games have no known future release date. Known released and unknown/TBA games remain eligible. `Playing`, `Platinum`, and `Dropped` are always excluded. Owned and currently playable PS+ games remain eligible. `Paused` and story-completed-but-not-platinumed games are Finish them candidates.
- Missing enrichment never removes an otherwise eligible game. Unknown facts contribute neither score nor explanation claims.
- Ranking must remain additive and inspectable across intent match, access, `Up next`, PS+ urgency, backlog age, genre, time-to-beat, confidence, and progress. Suggestions must state one primary reason and only known supporting facts; selection uses seeded tie-breaking and cross-card variety.
- Tuning permits at most one choice within each intent group and combines active groups conjunctively. Editing changes draft intent only; `Show me 3` applies it. Exact matches lead, followed automatically by visibly labeled `Closest match` results when needed.
- `Include wishlist` adds non-owned, non-PS+-playable wishlist games; current PS+ games remain eligible regardless of that setting. Default Surprise me caps Finish them at one card, while explicit Finish them prioritizes those candidates and removes the cap.
- Shuffle uses applied intent, ignores unapplied draft changes, and excludes every game shown in the current visit. Exhaustion yields a smaller slate and warning; the following Shuffle resets the pool while still excluding currently visible cards. No visit history persists after leaving Play Next.
- `Open details` must preserve the slate and visit state. `Play this` must reuse existing status-to-`Playing` lifecycle behavior, query invalidation, toast feedback, and race guards; success returns to Shelf, while failure preserves the slate.
- Manual Shelf filtering, search, and status behavior must remain unchanged. Every visible acceptance criterion requires Playwright coverage; pure rule boundaries and seeded selection require core tests, while draft/applied intent and exhaustion require web tests.
- Every UI-changing story is blocked until an implementation-specific placement mock is presented and Luca's approval is recorded immediately before UI implementation.

## Technical Decisions

- Play Next is a pure local derivation over TanStack Query's cached `['shelf']` payload. It adds no backend route, schema, migration, provider, cron, external recommendation service, LLM, machine learning, or persisted preference/history data.
- `core/` owns candidate eligibility, Finish them classification, additive scoring, explanation facts, closest-match relaxation, slate diversity, and seeded tie-breaking. Missing values are represented as absence, never zero or guessed data.
- `web/play-next/` owns ephemeral `draftIntent`, `activeIntent`, current slate, `seenGameIds`, and exhaustion state. These reset when the destination unmounts.
- react-router owns `/play-next`, detail navigation, and return travel. Cross-tree state must not use `window` events. Opening detail must keep Play Next mounted so visit state survives.
- Reuse existing status mutation infrastructure for `Play this`; do not create a recommendation-specific write path.

## UX & Interaction Patterns

- Navigation is `SHELF | PLAY NEXT | CATALOG | STATS`. Play Next uses `/play-next`, hides search, and moves route focus to the `WHAT NEXT?` heading.
- Use the existing dark arcade shell and palette: electric cyan for interaction/focus and heat magenta only for `Playing`. Add no new brand color.
- Desktop places tuning controls above three equal cards and Shuffle below. Phone shows compact vertical cards followed by collapsible `TUNE THE PICKS`; use no carousel.
- Each card shows cover, title, primary reason, optional access tag, known facts, plain explanation, optional `Closest match`, `Play this`, and `Open details`.
- Controls use programmatic grouping and pressed/checked state; `Include wishlist` is a checkbox. Targets are at least 44x44, state is never color-only, focus remains visible and stable, refresh announces result count through a live region, and motion respects reduced-motion preference.

## Cross-Story Dependencies

- Story 13.1 establishes eligibility, scoring, explanation, navigation, slate, and detail-preservation foundations used by all later stories.
- Story 13.2 adds draft/applied intent and candidate-pool controls consumed by Story 13.3 Shuffle.
- Story 13.3 adds visit-level seen and exhaustion state that Story 13.4 must preserve through actions and responsive hardening.
- Story 13.4 depends on existing lifecycle mutation behavior and verifies regression safety for the pre-existing Shelf flow.
