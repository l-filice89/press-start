# Sprint Change Proposal — Play Next

**Date:** 2026-08-02  
**Mode:** Incremental  
**Status:** Approved 2026-08-02  
**Change scope:** Moderate  
**Input:** `_bmad-output/brainstorming/brainstorm-play-next-feature-2026-08-02/course-correct-input.md`

## 1. Issue Summary

### Trigger

After finishing a game, users still face choice fatigue when deciding what to play next. Existing Shelf filters support manual exploration, and Stats explains past play, but neither produces a small, transparent, actionable shortlist.

This is a stakeholder-driven product expansion, not a defect or failed implementation story. No LLM or machine learning is required. Existing Shelf facts and play history are sufficient.

### Desired outcome

Add a standalone **Play Next** section that:

- immediately presents three varied suggestions with no required input;
- lets users intentionally tune later suggestions;
- explains every choice using visible reason/category tags;
- supports Surprise Me and session-aware Shuffle;
- can recommend resuming paused or completed-but-not-platinumed games;
- preserves current manual Shelf filtering unchanged.

### Evidence and context

- PRD already identifies choice fatigue, includes a manual “What next?” flow, and previously listed tunable Play Next suggestions as Future scope.
- Stats aggregation and the cached Shelf DTO now expose the required history, access, genre, release, lifecycle, score, PS+ departure, and time-to-beat facts.
- Epic 8 is already complete and deployed. Remaining Epic 8 merge/deploy actions in `sprint-status.yaml` are stale documentation, not unfinished work.

## 2. Impact Analysis

### Epic impact

- Add **Epic 13: Choose What to Play Next**.
- Do not reopen or replace any completed epic.
- Remove Play Next from Future scope and map FR-53–FR-63 plus NFR-5 to Epic 13.
- Correct stale Epic 8 sprint status to reflect its completed and deployed state.

### Story impact

Add four stories:

1. **13.1 Get three transparent suggestions** — standalone destination, default Surprise Me, eligibility, scoring, diversity, explanations, and detail access.
2. **13.2 Tune recommendations intentionally** — grouped intent controls, explicit generation, wishlist inclusion, Finish Them, and closest-match fallback.
3. **13.3 Shuffle without repetition** — visit-scoped exclusions, smaller exhausted slates, pool reset warning, focus, and announcements.
4. **13.4 Act on a recommendation and harden flow** — Play this mutation, return to Shelf, preserved detail state, responsive/accessibility/E2E hardening.

Every UI-changing story has an implementation-time mock gate: mock approval is required immediately before UI code begins.

### Artifact conflicts and updates

| Artifact | Required update |
|---|---|
| PRD | Promote Play Next from Future; add active flow, FR-53–FR-63, NFR-5, and success condition. Preserve current manual flow. |
| Architecture | Add `/stats` retrofit and `/play-next`; define pure derivation boundary, visit state, cache reuse, and mutation reuse. |
| UX `EXPERIENCE.md` / `DESIGN.md` | Add standalone navigation, page behavior, controls, cards, actions, exhaustion, accessibility, and mock gate. |
| Epics | Add Epic 13 and four implementation stories; update coverage maps. |
| Sprint status | Mark stale Epic 8 release actions complete; add Epic 13 backlog entries after proposal approval. |
| Project context | Add Play Next capability boundaries and implementation-time UI mock rule. |

### Technical impact

Existing data can support this feature:

- `/api/shelf?include=hidden` already supplies required candidates and enrichment.
- TanStack Query cache key `['shelf']` can be reused.
- Recommendation derivation can remain client-side and pure.
- Existing router and status mutation support Open details and Play this.
- Existing ETag behavior remains intact.

No new database schema, migration, provider, cron job, external recommendation service, LLM, machine-learning system, or new API endpoint is expected.

Primary technical risks:

- deterministic but varied selection without accidental repeats;
- clear relaxation of conflicting or sparse intent combinations;
- correct access eligibility for owned, PS+, and optional wishlist candidates;
- preserving visit state across game detail navigation;
- preventing completed-but-not-platinumed suggestions from dominating Surprise Me.

## 3. Recommended Approach

### Path: Direct Adjustment

Add Epic 13 to current product plan and update affected planning artifacts. Preserve shipped behavior and use existing Shelf/query/mutation seams.

### Why

- Feature is additive and standalone.
- Current manual Shelf flow remains valid.
- Existing data model and API already cover requirements.
- No rollback is useful.
- Scope reduction is not recommended; requested outcome is complete feature, not MVP.

### Estimate and risk

- **Effort:** Medium
- **Risk:** Medium-low
- **Schedule impact:** One new epic after planning artifacts and story files are prepared. No dependency on Epic 8 or unfinished infrastructure work.
- **Scope classification:** Moderate — backlog reorganization and coordinated PO/Developer handoff required, but no fundamental replan.

## 4. Detailed Change Proposals

### 4.1 PRD

#### Success condition

**OLD:**

Shelf filters and Stats support manual understanding and selection.

**NEW:**

Add a success condition: users can move from choice fatigue to a justified next-game choice in one short Play Next visit, while manual Shelf filtering remains an available alternative.

**Rationale:** Measures desired user outcome without replacing established workflows.

#### Scope placement

**OLD:**

Future scope includes tunable Play Next suggestions.

**NEW:**

Remove that Future bullet and add Play Next to active scope.

**Rationale:** Feature is now selected for implementation.

#### Functional requirements

**NEW:**

- **FR-53 — Standalone flow:** User can open Play Next as a standalone section. Current manual Shelf filter flow remains unchanged.
- **FR-54 — Eligibility:** Candidate must have no known future release date and must not be Playing, Platinum, or Dropped. Known released and unknown/TBA release dates are eligible. Owned and currently playable PS+ games are eligible. Paused and story-completed-but-not-platinumed games remain eligible as Finish Them candidates.
- **FR-55 — Missing facts:** Missing enrichment never makes an otherwise eligible game ineligible; missing facts contribute no score or explanation claim.
- **FR-56 — Transparent ranking:** Recommendations use additive, inspectable factors: intent match, ownership/playability, Up next priority, PS+ departure urgency, backlog age, genre familiarity/variety, time-to-beat fit, confidence, and Finish Them progress.
- **FR-57 — Intent controls:** User may select at most one tag per group. Active groups describe the desired conjunctive match. Groups cover Genre, Length, Shelf age, Confidence, Priority, and Progress.
- **FR-58 — Generate and fallback:** Editing tags does not replace current cards. `Show me 3` applies draft intent. Exact combined matches are preferred; when fewer than three exist, Play Next automatically returns closest matches and labels every relaxed result `Closest match`.
- **FR-59 — Access:** `Include wishlist` adds non-owned, non-PS+-playable wishlist games. Current PS+ games remain eligible regardless of ownership and checkbox state.
- **FR-60 — Default variety:** Every visit immediately generates a varied three-game Surprise Me slate where possible. Finish Them candidates participate but occupy at most one default card. Selecting Finish Them removes that cap and prioritizes those candidates.
- **FR-61 — Explanations:** Every card states its primary reason/category and only claims known facts. Supported labels include Familiar, Different, Quick win, Fresh, Forgotten, Safe bet, Wildcard, Follow my list, Last chance, Finish them, Available now, and Discover.
- **FR-62 — Session Shuffle:** Shuffle uses applied intent and excludes every game already shown during the visit. If only one or two unseen matches remain, show the smaller slate and warn that the next Shuffle refreshes the pool. Pool reset still excludes currently visible games. Visit state does not persist after leaving Play Next.
- **FR-63 — Actions:** User can open details without losing Play Next visit state or choose `Play this`, which uses existing lifecycle behavior to set Playing and returns to Shelf.

#### Non-functional requirement

**NEW:**

- **NFR-5 — Local, explainable derivation:** Play Next must use existing application data and deterministic client-side rules. It must not require LLMs, machine learning, external recommendation services, or persistent recommendation-preference/history data.

#### User flow

**OLD:**

Flow 3 manually narrows Shelf using filters.

**NEW:**

Keep Flow 3 unchanged. Add **Flow 7 — Play Next**:

1. Open Play Next.
2. See three varied Surprise Me suggestions immediately.
3. Optionally tune tags and checkbox, then press `Show me 3`.
4. Review reasons and any `Closest match` disclosure.
5. Shuffle, open details, or press `Play this`.

**Rationale:** Play Next adds a guided alternative; it does not replace manual Shelf selection.

### 4.2 Architecture

#### Route decisions

**OLD AD25:**

Router owns existing Shelf, Catalog, and game-detail destinations. Stats exists in shipped code but is absent from the older route record.

**NEW AD25:**

Retrofit `/stats` into the route record and add `/play-next` as a first-class destination. Router continues to own destination transitions and detail overlay behavior.

**Rationale:** Architecture must match shipped Stats and planned Play Next navigation.

#### New AD34 — Play Next derivation boundary

**NEW:**

- `core` owns pure eligibility, scoring, explanations, closest-match relaxation, slate diversity, Finish Them classification/capping, and seeded tie-breaking.
- `web/play-next` owns `draftIntent`, `activeIntent`, `seenGameIds`, current slate, pool exhaustion, and route-local interaction state.
- Visit state resets when Play Next unmounts. No preference or recommendation history persistence.
- Play Next reuses cached `['shelf']` data and existing ETag behavior.
- Open details uses existing router behavior; Play this uses existing status mutation, lifecycle semantics, invalidation, toast, and race guards.
- No new API, schema, migration, provider, cron job, or external service.

**Rationale:** Keeps recommendation logic testable and domain-pure while isolating ephemeral UI state.

#### Capability and testing map

**NEW:**

Add Play Next eligibility, ranking, slate generation, explanation, and session-state capabilities. Require unit coverage for rule boundaries and Playwright coverage for every visible acceptance criterion.

### 4.3 UX

#### Navigation

**OLD:**

`SHELF | CATALOG | STATS`

**NEW:**

`SHELF | PLAY NEXT | CATALOG | STATS`

- Route: `/play-next`
- Existing tablist semantics retained.
- Search hidden on Play Next as on Stats.
- Route focus moves to page heading.
- No Shelf panel, completion prompt, or secondary entry point in this change.

#### Page and controls

**NEW:**

- Heading: `WHAT NEXT?`
- Immediate default Surprise Me slate.
- Desktop: tuning controls, three equal cards, then Shuffle.
- Phone: heading, three compact vertical cards, collapsible `TUNE THE PICKS`, and full/sticky-width `Show me 3` when draft differs.
- No card carousel.
- Groups: Genre (`Familiar`, `Different`), Length (`Quick win`), Shelf age (`Fresh`, `Forgotten`), Confidence (`Safe bet`, `Wildcard`), Priority (`Follow my list`, `Last chance`), Progress (`Finish them`).
- `Include wishlist` is a checkbox.
- Draft changes preserve visible cards. `Show me 3` applies them. Button remains disabled when draft equals active intent.
- `Surprise me` clears tuning and immediately generates a varied slate.
- Shuffle uses active intent and ignores unapplied draft changes.

#### Cards and actions

**NEW:**

- Cover, title, primary reason tag, optional access tag, known supporting facts, one plain-language explanation, optional `Closest match`, `Play this`, and `Open details`.
- `Available now` identifies accessible owned/PS+ games; `Discover` identifies wishlist shopping suggestions.
- Open details preserves slate, intent, and seen set when closed.
- Play this sets Playing; success navigates to Shelf and exposes game in Playing tier. Failure keeps user on Play Next and shows existing error treatment.

#### Finish Them

**NEW:**

- Candidate is Paused or story-completed but not Platinum.
- Included in Surprise Me, clearly tagged, maximum one per default three-card slate.
- Selecting Finish Them lifts cap and prioritizes those candidates.
- Playing, Platinum, and Dropped always remain excluded.

#### Shuffle and accessibility

**NEW:**

- Keep focus stable and announce refreshed result count through live region.
- Do not re-show any game seen during current visit.
- Show one or two cards when pool is nearly exhausted and display: `You’ve seen every other match. Next Shuffle starts a fresh pool.`
- Next Shuffle resets pool but excludes current cards.
- Use fieldsets, `aria-pressed`, minimum 44×44 targets, non-color-only state, reduced motion, existing cyan interaction treatment, and magenta only for Playing semantics.

#### Implementation-time UI mock gate

**NEW standing requirement:**

Every story that changes UI must present implementation-specific mocks and receive user approval immediately before UI implementation. Course Correct UX specifies behavior and information architecture; it is not final visual approval.

### 4.4 Epics and stories

#### Epic list and coverage

**OLD:**

Play Next remains mapped to Future scope. Epic list ends at Epic 12.

**NEW:**

Add **Epic 13: Choose What to Play Next** and map FR-53–FR-63 plus NFR-5 to it.

#### Story 13.1: Get three transparent suggestions

**NEW acceptance scope:**

- Standalone `/play-next` route and navigation item.
- Immediate three-card Surprise Me slate when candidate count permits.
- Eligibility, missing-data tolerance, transparent scoring, seeded tie-breaking, slate diversity, and explanations.
- Owned and current PS+ candidates included.
- Finish Them participates with maximum one default card.
- Open details preserves visit state.
- Mock approval required before UI implementation.

#### Story 13.2: Tune recommendations intentionally

**NEW acceptance scope:**

- Mutually exclusive choices within groups; active groups form desired AND target.
- Draft-versus-active intent and explicit `Show me 3` generation.
- `Include wishlist` affects only non-owned, non-PS+-playable wishlist games.
- Automatic closest-match fallback with explicit labels.
- Surprise Me clears tuning and generates immediately.
- Finish Them prioritizes paused and story-completed-but-not-platinumed games and lifts default cap.
- Mock approval required before UI implementation.

#### Story 13.3: Shuffle without repetition

**NEW acceptance scope:**

- Shuffle uses active intent, including default Surprise Me.
- Whole-visit seen set; current cards never immediately return.
- Smaller slate and exhaustion warning when one or two unseen candidates remain.
- Next Shuffle resets exhausted pool while excluding current cards.
- State resets after leaving destination.
- Focus preservation and accessible announcements.
- Mock approval required before UI implementation.

#### Story 13.4: Act on a recommendation and harden flow

**NEW acceptance scope:**

- Play this uses existing mutation to set Playing.
- Existing lifecycle semantics, invalidation, toast, race protection, and failure handling retained.
- Success returns to Shelf; Open details preserves Play Next state.
- Responsive, keyboard, reduced-motion, and Playwright coverage.
- Regression coverage proves current manual Shelf filtering remains unchanged.
- Mock approval required before UI implementation.

### 4.5 Sprint status correction

**OLD:**

Epic 8 still contains open merge/deploy release actions.

**NEW:**

Mark those actions complete and record release evidence:

- PR #35 / merge commit `4d1522f`
- release tag `v3.0.0 — Multi-User Readiness`
- successful deployment run `29940002606`
- migrations `0016`–`0018`
- subsequent production lineage through `v3.3.2`

Add Epic 13 and Stories 13.1–13.4 as backlog items after approval.

**Rationale:** Sprint tracking must reflect actual deployed state before adding new work.

## 5. Implementation Handoff

### Classification

**Moderate change.** Requires backlog and planning-artifact updates, then normal story creation and implementation. No PM/Architect escalation or fundamental replan required.

### Recipients

- **Product Owner:** approve priority and Epic 13 backlog placement; keep feature complete rather than MVP-reduced.
- **Developer:** create story files, present mock before each UI-changing implementation, implement through existing architecture seams, and maintain regression coverage.
- **UX reviewer/user:** approve each implementation-time mock before UI code begins.

### Ordered handoff

1. Apply approved PRD, architecture, UX, epics, project-context, and sprint-status edits.
2. Create Story 13.1 with current artifact context.
3. Present and approve Story 13.1 UI mock.
4. Implement, test, review, and complete Story 13.1.
5. Repeat story creation and mock gate for Stories 13.2–13.4.
6. Run full regression and validate manual Shelf flow remains unchanged.

### Success criteria

- Play Next opens as standalone destination and immediately supplies a varied slate.
- Suggestions obey access and lifecycle eligibility, including conservative unknown-release handling.
- Finish Them works both within Surprise Me and as explicit intent.
- Tuning is explicit; closest-match relaxation is automatic and visible.
- Shuffle avoids repeats for whole visit and handles exhaustion honestly.
- Every card explains itself using known facts.
- Play this and Open details reuse existing lifecycle/router behavior safely.
- No LLM, machine learning, external recommendation service, new API, or schema work is introduced.
- Every UI-changing story receives mock approval before implementation.
- Existing manual Shelf flows remain unchanged and covered by regression tests.
