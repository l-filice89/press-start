---
title: 'Close Epic 13 responsive process gaps'
type: 'chore'
created: '2026-08-03'
status: 'done'
baseline_commit: 'bff824176750d51f98018ec465b86fb4e01675dc'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-retro-2026-08-03.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 13's per-story UI mock gates validated placement but did not require whole-feature behavior across phone, tablet, and desktop. Exact breakpoint evidence and integrated responsive acceptance arrived only after story completion.

**Approach:** Strengthen existing persistent workflow rules so UI specs cover every affected screen class and exact breakpoint boundaries, then add an epic merge gate requiring integrated responsive acceptance for UI epics.

## Boundaries & Constraints

**Always:** Keep UI-MOCK-GATE lightweight and pre-implementation; require behavior/state coverage for every affected screen class; require executable evidence on both sides of every introduced or changed breakpoint before story `done`; require product-owner acceptance of the integrated feature across supported widths and critical states after the last UI story and before the epic merge gate; keep rule wording available to both `bmad-dev-auto` and `bmad-dev-story`; update project context and retrospective tracking so no stale contract remains.

**Ask First:** Any new sign-off ceremony beyond the existing product-owner UI approval and final integrated responsive acceptance; any rule that mandates particular viewport pixel values for projects whose design defines none.

**Never:** Change Epic 13 product code, scoring, responsive CSS, tests, release scope, or approved UI; encode personal tool preferences; weaken existing UI, accessibility, E2E, follow-up-review, or operator-sweep gates.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| UI story changes one screen class | Only phone or desktop affected | Spec/mock and evidence cover that affected class; unaffected classes need explicit regression statement, not redundant redesign | Missing affected-class coverage blocks story readiness |
| Breakpoint introduced or changed | Layout transitions at a named width | Browser evidence exercises both adjacent sides of the boundary before story `done` | Representative viewport alone is insufficient |
| UI epic reaches last story | Multiple UI stories compose one feature | Integrated responsive review covers supported widths and critical states; product-owner acceptance recorded before merge | Missing closeout acceptance blocks merge |
| Non-UI work | No rendered surface changes | Responsive gates do not fire | Existing non-UI rules continue unchanged |

</frozen-after-approval>

## Code Map

- `_bmad/custom/standing-rules-core.md` -- shared UI-MOCK-GATE and E2E obligations consumed by every dev flow.
- `_bmad/custom/standing-rules-epic-process.md` -- epic/story merge gates consumed by `bmad-dev-auto` and `bmad-dev-story`.
- `_bmad-output/project-context.md` -- concise project-facing summary of binding UI workflow rules.
- `_bmad-output/implementation-artifacts/epic-13-retro-2026-08-03.md` -- approved action items and completion evidence.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- persistent action-item status ledger.

## Tasks & Acceptance

**Execution:**
- [x] `_bmad/custom/standing-rules-core.md` -- amend UI-MOCK-GATE with affected-screen behavior/state matrix and adjacent-breakpoint evidence requirements.
- [x] `_bmad/custom/standing-rules-epic-process.md` -- add integrated responsive epic-closeout merge gate.
- [x] `_bmad-output/project-context.md` -- synchronize concise UI workflow guidance.
- [x] `_bmad-output/implementation-artifacts/epic-13-retro-2026-08-03.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml` -- mark responsive actions done with file-level evidence.

**Acceptance Criteria:**
- Given any UI-changing spec, when readiness is assessed, then every affected screen class has placement plus behavior/state coverage and every introduced/changed breakpoint names passing evidence on both adjacent sides.
- Given an epic containing UI stories, when its merge gate is assessed, then integrated responsive acceptance across supported widths and critical states is recorded after the last UI story.
- Given non-UI work, when rules resolve, then no responsive mock or closeout obligation is created.
- Given both story development workflows, when customization resolves, then both updated standing-rule files remain loaded.
- Given Epic 13 tracking, when action status is inspected, then all three responsive-process actions are `done` with evidence while release remains open.

## Spec Change Log

- 2026-08-03: Implemented approved responsive process gates; no Epic 13 product code, CSS, tests, release scope, or approved UI changed.
- 2026-08-03 review patches: separated readiness inputs from pre-`done` evidence; triggered gates from actual rendered changes; defined exact-boundary evidence, screen-class source, responsive-contract reapproval, predeclared critical states, defect ownership, and stale-acceptance reruns; replaced policy-only action evidence with concrete Epic 13 tests and recorded acceptance. Kept product code and approved UI unchanged.

## Verification

**Commands:**
- `python3 _bmad/scripts/resolve_customization.py --skill .agents/skills/bmad-dev-auto --key workflow.persistent_facts` -- expected: both standing-rule files resolve.
- `python3 _bmad/scripts/resolve_customization.py --skill .agents/skills/bmad-dev-story --key workflow.persistent_facts` -- expected: both standing-rule files resolve.
- `rg -n "UI-MOCK-GATE|breakpoint|INTEGRATED RESPONSIVE" _bmad/custom _bmad-output/project-context.md` -- expected: synchronized enforceable wording.
- `bun run lint && git diff --check` -- expected: repository formatting gate passes.

**Result (2026-08-03):** Mandatory blind and edge-case reviews completed; review patches clarified gate timing, triggers, exact boundaries, state inventory, defect ownership, and stale-acceptance reruns. Both development workflows resolve `project-context.md`, `standing-rules-core.md`, and `standing-rules-epic-process.md`. Biome checked 281 files; typecheck and production build passed; Vitest passed 79 files / 2,173 tests; combined Epic 13 + unchanged Shelf browser flows passed 24/24 after one isolated transient retry; `git diff --check` passed.

## Suggested Review Order

**Responsive story gate**

- Start with readiness, reapproval, and exact-boundary evidence contract.
  [`standing-rules-core.md:21`](../../_bmad/custom/standing-rules-core.md#L21)

- Confirm concise project guidance matches binding story rule.
  [`project-context.md:68`](../project-context.md#L68)

**Responsive epic closeout**

- Review predeclared states, defect ownership, and stale-acceptance reruns.
  [`standing-rules-epic-process.md:13`](../../_bmad/custom/standing-rules-epic-process.md#L13)

- Confirm project workflow exposes merge-blocking closeout.
  [`project-context.md:73`](../project-context.md#L73)

**Evidence and tracking**

- Verify retrospective actions cite implemented rules and concrete Epic 13 evidence.
  [`epic-13-retro-2026-08-03.md:72`](epic-13-retro-2026-08-03.md#L72)

- Verify only release/deployment remains open.
  [`sprint-status.yaml:418`](sprint-status.yaml#L418)

**Release metadata**

- Review v3.4.0 user-facing change summary.
  [`CHANGELOG.md:7`](../../CHANGELOG.md#L7)

- Confirm package SemVer matches release plan.
  [`package.json:4`](../../package.json#L4)
