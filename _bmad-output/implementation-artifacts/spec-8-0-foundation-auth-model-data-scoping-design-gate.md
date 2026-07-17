---
title: 'Story 8.0: Foundation — auth model & data-scoping design gate'
type: 'chore'
created: '2026-07-17'
status: 'blocked'
baseline_revision: '14ae6d2'
final_revision: 'bd219d7'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-17-epic8-capacity.md'
  - '{project-root}/_bmad-output/planning-artifacts/research/technical-cloudflare-free-tier-capacity-research-2026-07-17.md'
  - '{project-root}/_bmad-output/implementation-artifacts/publication-blockers.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Stories 8.2–8.5 would improvise registration, per-user PS+ facts, and a multi-user cron against a schema shaped for one tenant. The design decisions exist scattered across the 2026-07-17 sprint change proposal, the capacity research, and `deferred-work.md`'s admission items — but the architecture spine still records single-tenant reality, so there is no signed-off target to migrate toward.

**Approach:** A design gate, not runtime code (the Story 7.0 pattern). Distill the multi-user decisions into a `bmad-architecture` spine update — new ADs plus amendments — covering the auth/admission model, the per-user/per-region scoping target of each global fact, the per-run free-tier budgets with arithmetic, and the refresh/caching model. Record the update in `.memlog.md`, then present it for Luca's sign-off. NO application code changes.

## Boundaries & Constraints

**Always:**
- The spine update states, for each of these, a single unambiguous ruling:
  1. **Admission model** — what replaces `isAllowedEmail` (registration vs invite), covering EVERY door: user creation, the OAuth account-LINK path (better-auth links by email without the create hook), de-admission (land on login, session rows revoked), and auth-endpoint rate limiting (verification-row residue). [AR-13; deferred-work items homed in 8.2]
  2. **Scoping target per global fact** — `game.ps_plus_extra`, `ps_plus_left_on`, `ps_plus_leaving_on`, `psn_concept_id` move to the per-region snapshot side; per-user answers are DERIVATIONS (user's region joined against region-scoped data), never per-user copies. Region stays a per-user SETTING row, seeded per-user, `env.PSN_REGION` demoted to first-boot default. `critic/user score` + `ttb_*` stay shared on `game`. [AD-17, AD-19, AD-23]
  3. **Per-region refresh model** — cron fans out over distinct regions of registered users; anonymous fetch, shared snapshot; region-state ledger (`last_success`, `last_attempt`, `failure_count`, cycle-complete) with retry-failed-first; skip regions idle 60 days or cycle-complete; sign-in against a >35-day snapshot triggers a `waitUntil` refresh; failures are passive (logs + as-of timestamp, no banners); the manual check button is removed in multi-user.
  4. **Budgets with arithmetic written out** — per cron run AND per user-facing request: 50 subrequests/invocation (D1 binding calls count), 5M D1 rows read/day, 100k rows written/day (indexed writes bill double), ~1,000 rows per full ~490-row snapshot write, ~1,500 rows per whole-library scan. Enumerate every consumer including auth middleware's session read. [BUDGET-COUNTS-EVERY-SUBREQUEST]
  5. **Caching + delivery** — per-active-region version-keyed catalog cache; per-user library version for ETag/304; paged-vs-whole catalog delivery to the FE (feeds 8.6).
- External-surface risk statement in the spine update: the per-region catalog fetch is the anonymous public PS+ catalog endpoint — no account identity, no credential on the wire (EXTERNAL-RISK-FLAG one-liner; the credentialed path died with Epic 11).
- Spine format matches the existing AD style (AD-24..28 precedent from Story 7.0); `.memlog.md` gains the update event.
- Decisions come FROM the existing artifacts (change proposal, capacity research, epic context, deferred-work); where they conflict, the 2026-07-17 change proposal wins. Do not invent new product decisions.

**Block If:**
- The artifacts are drafted and internally consistent but await Luca's recorded sign-off — sign-off is a human act; HALT blocked with condition `awaiting design sign-off (story 8.0 gate)` AFTER the artifacts are written and reviewed.
- Any two source artifacts contradict on a ruling the spine must make and the change proposal does not arbitrate it.

**Never:**
- No application/schema/migration code, no test changes — documents only.
- No tenancy platform: no roles, no sharing, no per-tenant D1. AD-13 keeps the door open; this design does not walk through it.
- Do not redesign what Epic 7 settled (snapshot table shape AD-24..28) — extend, don't reopen.

</intent-contract>

## Code Map

- `_bmad-output/planning-artifacts/architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md` -- the spine; gains the multi-user ADs + amendments (AD-13 note at line ~385 "multi-tenant door" is the anchor to supersede).
- `_bmad-output/planning-artifacts/architecture/architecture-ps-game-catalog-2026-07-05/.memlog.md` -- append the Epic 8 design-gate event (7.0 precedent: "spine finalized (Epic 7 update…)").
- `src/services/auth.ts:41-130`, `src/routes/auth.ts:35-68` -- current admission reality (4 enforcement points) the design must name as migration source.
- `src/schema/catalog.ts:51-118,236-246,272-325` -- `game` global-fact columns, per-user `setting`, region-keyed `ps_plus_catalog` — the scoping source/target tables.
- `src/services/psplus.ts:356-467`, `worker/index.ts:39-71`, `wrangler.jsonc:46-48` -- single-tenant cron the per-region model replaces.
- `src/services/shelf.ts:157-168`, `src/services/psplus-browse.ts:137-188` -- whole-library read paths the budget section must count.
- `_bmad-output/implementation-artifacts/deferred-work.md:312-324` -- the three admission items (link gate, session revocation, rate limiting) the auth model must absorb.
- `_bmad-output/implementation-artifacts/epic-8-context.md` -- step-01 compiled epic context, regenerated this run from the 2026-07-17 planning rework; kept consistent with AD-30's writer split.

## Tasks & Acceptance

**Execution:**
- [x] `ARCHITECTURE-SPINE.md` -- draft the Epic 8 spine update: new ADs for (1) admission model covering all four doors, (2) per-region ownership of the four PS+ facts + derivation rule, (3) per-region refresh with ledger/skip/revival rules, (4) free-tier budget table with enumerated arithmetic, (5) caching/delivery strategy -- one AD per ruling, existing AD prose style, each AD naming the stories that consume it (8.2/8.3/8.4/8.6).
- [x] `ARCHITECTURE-SPINE.md` -- amend AD-23 (region stored per-user, env demoted) and the line-~385 multi-tenant-door note (door now has a named admission model; still no roles/sharing) -- amendments marked in place per spine convention.
- [x] `.memlog.md` -- append the design-gate event naming the ADs added/amended (7.0 precedent format).
- [x] Self-consistency pass -- every ruling in Boundaries #1–#5 appears in exactly one AD; budget arithmetic totals stated per cron run and per request; no ruling contradicts the change proposal.

**Acceptance Criteria:**
- Given the spine update, when 8.2 is planned, then the admission model answers registration-vs-invite, the link-path gate, de-admission behavior, and rate limiting without reopening design.
- Given the spine update, when 8.3 is planned, then every global PS+ fact has a named target (per-region snapshot side + per-user derivation) and 8.3 is a migration, not a design exercise.
- Given the spine update, when 8.4/8.6 are planned, then per-run budgets, ledger/skip/revival rules, and the caching/delivery shape are stated as numbers and rules, not intents.
- Given the drafted artifacts, when this story ends, then status is `blocked: awaiting design sign-off` — no 8.2+ code merges before Luca's recorded sign-off.

## Spec Change Log

## Review Triage Log

### 2026-07-17 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 17: (high 6, medium 7, low 4)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` **AD-32's arithmetic disproved by shipped code**: "34 subrequests membership-alone, passes never combine" (`psplus.ts` H3 guard) vs the drafted "~30 → one region per invocation"; fires/month (~28, the scarcest budget) never counted. Rewritten to the rotation-slot model: full region ≈ 7–8 slots, **3–4-region monthly ceiling** named with its remedy; DAU chain fixed (~9,000 rows/session → ~550; ~2,000 post-8.6 per research; ~6,600 correctly attributed to the proposal's request-cap ceiling).
  - `[high]` `[patch]` **Departure facts can't live in a pruned snapshot** (`ps_plus_left_on` exists only post-prune): AD-30 now mandates a `(region, product_id)` departure ledger surviving every prune, with lossless 8.3 carry-over.
  - `[high]` `[patch]` **Admission-table bootstrap deadlock**: fail-closed empty table on the switch-over deploy locks out the owner. AD-29 now seeds from `AUTH_ALLOWED_EMAIL` in the same migration.
  - `[high]` `[patch]` **Self/last-row de-admission lockout**: settings editor refuses self-removal and last-row removal; seeded owner row removable only by migration.
  - `[high]` `[patch]` **Writer-shape contradiction** (epic-context "per-user shape" vs AD-30 "per-region shape"; un-claim called "future" though 6.4 shipped it): both artifacts now state the split — check/cron write per-region, un-claim writes per-user tracking only.
  - `[high]` `[patch]` **AD-33 diff-upserts broke AD-28's generation-carried sweep/prune** (unchanged rows stranded on an old generation = silently skipped band). Diff-upserts rejected outright — saves ~1% of a day's write budget, integrity wins; deliberate, recorded override of the change proposal.
  - `[medium]` `[patch]` Rate limiting designed (WAF edge rules, never D1 counters an attacker can drain; verification-row TTL sweep), poison-region quarantine (3 failures → back of rotation), idle measured by `last_user_activity` not sign-ins, stale guard extended to region-change + first-request-of-day, region-keyed single-flight lock + membership-only `waitUntil` revival scope, cycle-complete defined + sweep state moved to the region ledger, de-admitted regions leave the fan-out with data retained, ETag bump invariant + cookieCache TTL ≤5min bound.
  - `[low]` `[patch]` Five admission doors (not four) incl. `sendMagicLink`; emails lowercased; spine header flags AD-29..33 as PROPOSED; spec Verification/Code Map now name `epic-8-context.md`; 8.4 named owner of banner-machinery retirement.

## Design Notes

Story 7.0 is the template: its "done" was signed-off artifacts (spine AD-24..28 + memlog), gating 7.1–7.3. The unattended run drafts and self-reviews; the sign-off itself is the one step only Luca can take, so the terminal state of this run is `blocked` by design, not `done`.

## Verification

**Commands:**
- `git diff --stat` -- expected: only `ARCHITECTURE-SPINE.md`, `.memlog.md`, `epic-8-context.md` (step-01 cache regen) and this spec touched — zero code files.

**Manual checks (if no CLI):**
- Read each new AD against Boundaries #1–#5: one ruling each, consumer stories named, arithmetic present in the budget AD.

## Auto Run Result

Status: blocked
Blocking condition: awaiting design sign-off (story 8.0 gate) — Luca must review and sign off AD-29..33 before any 8.2+ code merges.

**Implemented:** The Epic 8 design gate (Story 7.0 pattern) — five PROPOSED ADs added to `ARCHITECTURE-SPINE.md` plus amendments, distilled from the 2026-07-17 sprint change proposal + capacity research + deferred-work admission items:
- **AD-29** admission = invite-shaped stored allowlist, one function at five doors, migration-seeded (no bootstrap lockout), self/last-row removal refused, WAF rate limiting, session revocation on de-admission.
- **AD-30** membership derives from the per-region snapshot; departure facts move to a `(region, product_id)` departure ledger that survives prunes; writer split stated; scores/TTB stay on `GAME`.
- **AD-31** per-region cron over admitted users' distinct regions; region-state ledger (+`last_user_activity`), 3-failure quarantine, 60d-idle/cycle-complete skips, 35d stale guard (sign-in, region change, first request of day) with region-keyed single-flight lock; passive failures; 8.4 retires the banner machinery + manual button.
- **AD-32** enumerated budget arithmetic incl. the fires/month budget: full region ≈ 7–8 rotation slots → **3–4-region monthly ceiling** at current cadence (remedy named); honest DAU chain (~550 → ~2,000 post-8.6; ~6,600 = request-cap ceiling).
- **AD-33** paged delivery, generation-keyed region cache, ETag/304 with the bump invariant, diff-upserts REJECTED (would break AD-28's generation-carried sweep), cookieCache TTL ≤5min bound.
- **AD-23** amended (region per-user, env demoted); AD-28 amended (post-Epic-11 slot arithmetic); multi-tenant-door note updated; spine header flags AD-29..33 PROPOSED.

**Files changed:**
- `ARCHITECTURE-SPINE.md` — AD-29..33 added; AD-23/AD-28/header/deferred-note amended.
- `.memlog.md` — design-gate event, six decision entries, reviewer-gate event.
- `epic-8-context.md` — step-01 cache regen from the 2026-07-17 planning rework; writer-split line aligned with AD-30.
- This spec.

**Review:** 2 adversarial lenses, 33 raw findings → 17 patched (6 high, 7 medium, 4 low), 0 deferred, 0 rejected, 0 intent gaps, 0 bad-spec loopbacks. The highs were exactly where a design gate hurts most — budget arithmetic contradicted by shipped code, a structurally impossible column home, and two lockout paths — see Review Triage Log. `followup_review_recommended: true` (volume + severity; the sign-off review itself is the natural venue).

**Verification:** `git diff --stat` since `14ae6d2` — only the four design artifacts above; zero code files. Manual pass: each Boundaries ruling #1–#5 lands in exactly one AD; arithmetic stated per slot, per month, and per request.

**Residual risks:** AD-29's invite-vs-registration is a PROPOSAL (invite) — Luca's sign-off decides it. AD-33 §5 deliberately overrides the change proposal's diff-upsert idea (recorded in the AD and memlog) — flag it at sign-off. The 3–4-region/month ceiling is fine at invite scale but is the number to re-check if invites spread geographically.
