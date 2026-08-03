# Correct Course Input: Play Next

## Change request and rationale

Add the complete agreed **Play Next** feature as a new standalone product section. It must use existing game metadata and play history to offer transparent, rules-based next-game recommendations without changing current completion, tracking, or Shelf flows.

The change addresses choice fatigue after finishing a game. Stats explains past activity; Play Next should help drive the next action. Its trust loop is: give useful choices immediately, explain each choice, allow optional intent steering, and provide effortless recovery when the slate misses.

## User and job outcome

After finishing a game—or whenever choosing what to play next—the user receives a curated set of plausible next-game options across useful intents. The user can understand why each game was suggested, refine ranking without building a filter query, and request fresh choices without repeated results during the visit.

## Agreed functional behavior

- Opening Play Next immediately generates a varied zero-input slate of up to three suggestions. This is the **Surprise me** behavior; it asks no questions and regenerates on every Play Next visit.
- Suggestions use existing game metadata and play history only.
- The default slate is intentionally diverse rather than three independently chosen top-scoring games.
- Optional intent tags let users steer genre continuity or change, game length, older backlog versus newer catalog additions, and PS+ departure urgency.
- Tags are grouped by facet. At most one tag may be selected from each facet group. Tags from different groups may be combined.
- Selecting tags changes draft intent but does not discard the visible slate. **Show me 3** applies selected tags and generates a new slate.
- Cross-group combinations use AND semantics as ranking intent, not universal hard filtering.
- **Shuffle** regenerates suggestions in every state. With active tags, it refreshes within the compound intent. Without active tags, it refreshes the varied Surprise me slate.
- During one Play Next visit, Shuffle excludes every game already shown. The seen set resets when the user leaves Play Next and requires no persistent history.
- If fewer than three unseen eligible candidates remain, show the smaller remaining slate and warn that the next Shuffle will refresh the pool. After refresh, do not include games in the currently visible slate.
- Each suggestion exposes understandable supporting facts, including time, playability/access, genre, and intent rationale where known.
- Recommendation cards use these agreed reason tags: **Safe bet**, **Wildcard**, **Fresh**, **Forgotten**, **Follow my list**, **Last chance**, **Available now**, and **Discover**.
- Each suggestion provides **Open details** and **Play this** actions.

## Candidate eligibility and access scope

Eligibility is a hard gate applied before ranking.

- Candidates must be released and not marked Completed, Platinum, Dropped, or Playing.
- With **Include wishlist** off, candidates must be owned or currently playable through PS+.
- Missing enrichment does not make a game ineligible. Missing facts contribute no score.
- **Include wishlist** is an explicit shopping opt-in. When enabled, wishlisted games join the candidate scope; arbitrary non-owned, non-wishlisted catalog games do not.
- A currently playable PS+ game may be non-owned without being a shopping candidate. PS+ access and wishlist status remain distinct.
- **Up next** increases priority but never guarantees selection.

Correct Course should resolve whether unknown release date counts as eligible and whether duplicate platform editions need consolidation; both were discussed but not confirmed as user decisions.

## Ranking and slate semantics

Ranking must remain transparent, tunable, and rules-based. No LLM or machine learning may participate.

A simple additive score should account for relevant known facts: selected intent, playability, Up next, PS+ departure urgency, backlog age, genre fit, and time fit. Missing facts add no score. Intent tags are soft scoring goals; candidate eligibility and Include wishlist scope remain hard constraints.

Slate selection must re-rank for diversity across genre, length, catalog/backlog age, access, and reason tag. This diversity rule applies to Surprise me and remains relevant when composing a tag-steered slate.

## Closest-match behavior

Prefer candidates satisfying every selected facet. If fewer than three exact compound-intent matches exist, automatically fill remaining positions with closest eligible matches. Clearly identify any non-exact suggestion and explain which selected intent or intents it satisfies. Never weaken eligibility or Include wishlist scope to fill a slate.

## Fixed constraints

- Deliver the complete agreed feature, not an MVP subset: immediate varied slate, grouped combinable tags, Show me 3, Include wishlist, explainable closest-match fallback, Open details, Play this, and visit-deduplicated Shuffle.
- Keep Play Next standalone.
- Do not alter current completion, tracking, or Shelf flows.
- Use existing data and play history only.
- Keep recommendation logic deterministic/rules-based, explainable, and tunable.
- Do not add persistent preference or recommendation-history data for this feature.

## Explicit exclusions

- Completion-triggered experiences or changes to completion flows
- Changes to existing tracking or Shelf flows
- Completion handoff or other new animations
- Preference learning
- Remembered **Not now** behavior
- Remembered mood, session length, accepted suggestions, or other new recommendation history
- Arbitrary non-owned, non-wishlisted catalog recommendations
- LLM-based or machine-learning recommendations

## Decisions deferred to Correct Course

Correct Course must determine UI design, exact entry point, navigation, architecture, required artifact edits, epic/story placement, effort, and delivery sequencing. It should also resolve unspecified interaction details, including exact Play this effects, intent-tag labels and facet taxonomy, explanation presentation, unknown-release handling, and duplicate-edition handling, while preserving all fixed behavior and exclusions above.

## Impact-analysis questions

1. Which PRD requirements, epics, stories, UX specifications, and architecture sections conflict with or must absorb this standalone feature?
2. Where should the complete feature sit in epic/story structure without treating agreed capabilities as optional or later-phase scope?
3. Which existing metadata, play-history fields, status rules, wishlist data, PS+ access/departure data, time-to-beat data, genre data, Up next state, and Stats aggregation helpers are available and reliable?
4. How should unknown release dates and duplicate platform editions be handled consistently with eligibility and missing-enrichment rules?
5. What exact tag facet taxonomy and labels preserve all agreed steering intents and one-per-facet selection?
6. What scoring, tie-breaking, diversity re-ranking, closest-match, and pool-reset rules make results tunable, explainable, and testable?
7. What does Play this do while respecting the boundary against changing existing completion, tracking, and Shelf flows?
8. What artifact changes, dependencies, risks, effort, and delivery sequence are required?
9. What acceptance criteria verify slate diversity, explanation accuracy, hard scope gates, closest-match disclosure, and visit-scoped no-repeat Shuffle behavior?
