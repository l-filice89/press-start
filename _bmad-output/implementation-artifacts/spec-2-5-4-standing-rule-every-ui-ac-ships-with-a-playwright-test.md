---
title: 'Standing rule — every UI AC ships with a Playwright test (story 2.5.4)'
type: 'chore'
created: '2026-07-10'
status: 'done'
final_revision: 'd3dfd3a48656cccece39d57548c336586ae4b055'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
baseline_revision: '559f262'
---

<intent-contract>

## Intent

**Problem:** The Playwright suite only grows if future stories are forced to feed it — without a standing rule bound into the dev automation, the e2e tier rots the moment Epic 3 starts (TR-3, Epic 2 retro action item 3).

**Approach:** Add a persistent fact to `_bmad/custom/bmad-dev-auto.toml` (the same mechanism as the hazard-test rule) stating every AC with a matching UI user flow ships with a Playwright test, and verify it loads through the customization resolver so the next `bmad-dev-auto` session binds it.

## Boundaries & Constraints

**Always:** Same mechanism as the existing rules (append to `workflow.persistent_facts`); existing facts stay verbatim. The rule must name the coverage-note escape hatch (skips listed with a reason in `playwright/COVERAGE.md`) so it can't be satisfied by silence or blocked by untestable ACs.

**Block If:** The resolver cannot load the amended file (syntax error it can't recover from).

**Never:** No changes to the skill's base `customize.toml` or step files; no reformatting of the existing facts.

</intent-contract>

## Code Map

- `_bmad/custom/bmad-dev-auto.toml` -- team override; `workflow.persistent_facts` array to append to
- `_bmad/scripts/resolve_customization.py` -- resolver; its output is the load-verification
- `playwright/COVERAGE.md` -- the coverage-note contract the rule references
- `playwright/README.md` -- already states the rule for humans (Practices)

## Tasks & Acceptance

**Execution:**
- [x] `_bmad/custom/bmad-dev-auto.toml` -- append the standing-rule persistent fact (rule text: every AC with a matching UI user flow ships with a Playwright e2e test in the same story; ACs without a UI flow or unreachable today are added to playwright/COVERAGE.md with a one-line reason; check during step-03 and step-04) -- TR-3
- [x] verify: run `resolve_customization.py --skill .claude/skills/bmad-dev-auto --key workflow` and confirm the new fact appears in `persistent_facts` -- proves the next session loads and binds it (verified: 4 facts resolved, PLAYWRIGHT-COVERAGE RULE present)

**Acceptance Criteria:**
- Given `_bmad/custom/bmad-dev-auto.toml`, when the resolver runs, then the standing rule is present in the resolved `workflow.persistent_facts`
- Given the next story run through `bmad-dev-auto`, when its session activates (step "Load Persistent Facts"), then the fact loads and binds the dev agent — same mechanism the hazard-test rule already proves works

## Spec Change Log

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 3, medium 5, low 2)
- defer: 1: (low 1)
- reject: 5
- addressed_findings (all folded into one rewrite of the fact text; resolver re-verified):
  - `[high]` `[patch]` done-check only covered UI-facing ACs — non-UI ACs could be silently dropped despite the "never silently dropped" prose; definition of done now spans EVERY AC (test or row)
  - `[high]` `[patch]` "matching UI user flow" undefined, self-judged — added the operational rubric (user could observe or drive the behavior through the rendered app)
  - `[high]` `[patch]` "unreachable in the UI today" sanctioned skipping a story's own unbuilt UI — reasons must name the blocking dependency; false skip reasons explicitly forbidden (broken foundation → HALT blocked)
  - `[medium]` `[patch]` skip rows were a one-way door — the story that makes a flow reachable must convert the rows to tests
  - `[medium]` `[patch]` no quality bar on the test — must assert that AC's behavior and run green in the story's verification (test.skip / never-run specs no longer comply)
  - `[medium]` `[patch]` hazard-rule overlap unresolved — both rules now apply independently, neither exempts the other
  - `[medium]` `[patch]` story-AC vs epic-AC granularity — rows keyed by epic AC, story ACs map onto them, ad-hoc stories get their own section
  - `[medium]` `[patch]` all-non-UI stories would bloat COVERAGE.md — one summary line allowed
  - `[low]` `[patch]` "deleted in finally" narrower than README (fixtures allowed) and "pre-authed" overstated (auth-journey exception) — compressed parenthetical replaced by a README pointer
  - `[low]` `[patch]` one-line reason had no floor — reason must name what blocks or what covers instead
- deferred:
  - `[low]` ORCHESTRATION CONSTRAINT fact contradicts SKILL.md's mandatory synchronous subagents — logged to deferred-work.md (pre-existing)
- rejected: step-file changes to thread facts into subagent prompts / add step-04 audit instructions (out of scope — same mechanism as the proven hazard rule), resolver array dedup (hypothetical upstream), no-mechanical-backstop (accepted prompt-level enforcement), COVERAGE row timing (now explicit "in the same story"), TOML validity (verified clean)

## Verification

**Commands:**
- `python3 _bmad/scripts/resolve_customization.py --skill .claude/skills/bmad-dev-auto --key workflow` -- expected: JSON output contains the new fact alongside the two existing ones

## Auto Run Result

**Summary:** Added the PLAYWRIGHT-COVERAGE RULE as a persistent fact in `_bmad/custom/bmad-dev-auto.toml` (same mechanism as the hazard-test rule). The adversarial review hardened the rule text substantially: an operational rubric for "UI user flow", a definition-of-done spanning every AC (test or COVERAGE.md row), blocking-dependency-named skip reasons with false-skips forbidden, a convert-on-reachable obligation, a green-test quality bar, explicit independence from the hazard-test rule, and provisions for all-backend stories and broken test infra.

**Files changed:**
- `_bmad/custom/bmad-dev-auto.toml` — one appended persistent fact (existing facts untouched)
- `_bmad-output/implementation-artifacts/deferred-work.md` — one pre-existing tension logged (ORCHESTRATION fact vs mandatory synchronous subagents)

**Review findings:** 10 patched (3 high, 5 medium, 2 low — all folded into the fact text), 1 deferred, 5 rejected.

**Verification:** `resolve_customization.py` returns 4 facts including the rule (run before and after the amendment); TOML parses; existing facts byte-identical.

**Residual risks:** enforcement is prompt-level (no CI backstop validating COVERAGE.md completeness) — accepted; a mechanical audit could be a future chore if the rule proves leaky in Epic 3.
