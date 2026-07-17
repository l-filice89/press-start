# Sprint Change Proposal — Epic 8 capacity rework (per-region refresh + read-budget hardening)

**Date:** 2026-07-17
**Trigger:** capacity research, not a story
**Mode:** Batch review — approved by Luca 2026-07-17
**Status:** APPROVED

---

## 1. Issue Summary

The free-tier capacity research (`research/technical-cloudflare-free-tier-capacity-research-2026-07-17.md`) established hard numbers for a hypothetical multi-user press-start:

- **Binding limit is D1 rows read (5M/day)**, not the 100k Worker request cap — whole-library scans on hot routes cost ~1,500 rows/hit. Multi-user DAU ceiling ≈ **~550 active users**.
- **Write cliff:** `ps-plus-check` writes a ~490-row snapshot (~1,000 rows w/ indexes) per run → **~100 runs/day**. Epic 8.4 as written (per-user scheduled checks) recreates this cliff and caps the app at ~100 users regardless of reads.
- **Story 8.4 is also stale:** its AC fans the cron out over "each user's own `pdccws_p` cookie" — Epic 11 (2026-07-15) deleted all credentialed PSN access; the catalog fetch is anonymous. Blocker **B5 has no referent anymore**.

Discovered during capacity research 2026-07-17, before any Epic 8 implementation — zero code affected.

## 2. Impact Analysis

| Artifact | Impact |
|---|---|
| **Epic 8 / Story 8.0** | Design gate names only the subrequest budget; must also name D1 read/write budgets + caching strategy + refresh model |
| **Epic 8 / Story 8.3** | Needs one AC pinning the per-user flag to a *derivation* over the shared region-scoped snapshot (no per-user catalog copies) |
| **Epic 8 / Story 8.4** | Rewrite: per-user fan-out → per-**region**; stale cookie AC removed; recovery model added; manual trigger removed in multi-user |
| **Epic 8 / new Story 8.6** | Read-budget hardening (research fixes) — raises DAU ceiling ~550 → ~6,600 |
| **`publication-blockers.md`** | B4 fix text rewritten per-region; B5 retired (Epic 11); Epic-10 departure columns noted as same shape |
| **PRD FR-39 / FR-40** | Amendment notes: multi-user refresh is cron + login-guard only (button removed); staleness surfaces via timestamp + updating notice, not banners |
| **`sprint-status.yaml`** | Story 8.6 added (backlog) |
| **Architecture spine** | No direct edit — all spine changes route through Story 8.0's gate (its purpose) |
| **UX / other epics / code** | None |

## 3. Recommended Approach

**Direct Adjustment** (Option 1). Modify three stories, add one, sync two docs. Effort: Low (documentation only; Epic 8 is demand-driven with nothing in flight). Risk: Low. Rollback / MVP review: N/A (post-v1.0.0; MVP shipped).

Design rationale (from review discussion):

- **Per-region shared refresh** — writes scale with active regions (~handful), not users; kills the write cliff outright. Natural post-Epic-11 shape: the fetch is anonymous, so there is nothing per-user about it.
- **One login guard replaces separate revive/failed-month paths**: snapshot >35 days old at sign-in → refresh via `waitUntil` + "updating…" notice. Covers region revival, all-cron-fires-failed, and new regions with a single rule.
- **Retry ledger, not a DLQ** — the cron is already the scheduler; a region-state row + retry-failed-first ordering gives recovery without new infrastructure.
- **No failure banners** — users have no action to take (no button); FR-40's as-of timestamp + the updating notice are the honest, free surfacing. Detail goes to Worker logs.
- **Per-active-region caching** — catalog is already region-scoped (AD-24); users only read their own region. Whole-vs-paged catalog delivery to the FE is an 8.0 design decision.

## 4. Detailed Change Proposals

### E1 — Story 8.0, third AC widened

```
OLD: Then it names the free-tier subrequest budget per run and the chunking
     strategy that stays inside it as user count grows [B4, B5; NFR-1, NFR-2, AR-15]

NEW: Then it names the free-tier budgets per run — subrequests AND D1 rows
     read/written (binding limits per capacity research 2026-07-17: 5M reads,
     100k writes/day) — the per-REGION refresh model (not per-user; the
     catalog fetch is anonymous post-Epic 11), and the caching strategy
     (per-active-region, version-keyed on refresh; per-user library version
     for ETag/304; paged-vs-whole-catalog delivery to the FE)
     [B4; NFR-1, NFR-2, AR-15; research 2026-07-17]
```

**Rationale:** the gate must design against the actual binding limits, not just subrequests.

### E2 — Story 8.4 rewritten

```
OLD title: The scheduled refresh serves every user (B4 + B5)
NEW title: The scheduled refresh serves every region (B4; B5 retired by Epic 11)

OLD AC1: cron loops ALL users, each with their own region (8.3) and their own
         pdccws_p cookie from SETTING (getPsnCookie) [B4, B5]
(remaining OLD ACs: chunking within subrequest budget; per-user failure surfacing)

NEW ACs:
AC1: cron fans out over the DISTINCT REGIONS of registered users — one
     anonymous fetch + shared snapshot per region, never per-user (per-user
     checks recreate the ~100-runs/day write cliff) [B4]
AC2: on sign-in, if the user's region snapshot is >35 days old, a refresh is
     triggered via waitUntil and the UI shows "PS+ catalog updating…" beside
     the FR-40 as-of timestamp — covers region revival, a fully failed month,
     and first user of a new region
AC3: a region-state row (last_success, last_attempt, failure_count,
     cycle-complete) records every outcome; each cron fire retries
     failed/stale regions first — recovery is automatic, no user action
     exists or is needed
AC4: cron skips regions with no sign-in for 60 days, and regions already
     cycle-complete (membership pass + leaving sweep both succeeded since
     this month's rotation date — freed fires go to failed/stale regions);
     exact conditions named by Story 8.0's design gate
AC5: the manual ps-plus-check trigger is removed in multi-user — snapshot
     writes come only from the cron and the AC2 login guard (single-user
     keeps its button until this story lands)
AC6: no failure banners; staleness surfaces via the FR-40 timestamp (+ AC2
     updating notice), failure detail via Worker logs [NFR-4 passive]
AC7: chunking stays inside the budgets named by 8.0 as region count grows
     [NFR-1, NFR-2, AR-15]
```

**Rationale:** Epic 11 staleness fix + write-cliff removal + recovery model, per review discussion (Luca: login-guard merge, retry ledger over DLQ, no banners, button removal, cycle-complete skip).

### E3 — Story 8.3, one AC added

```
ADD: Given the per-region catalog snapshot is a shared dataset (AD-24)
     When the per-user flag shape is designed
     Then the per-user PS+ answer derives from user.region joined against the
     region-scoped catalog — no per-user copy of catalog rows [B2; AD-19, AD-24]
```

**Rationale:** pins 8.3's migration target to the shared-snapshot model 8.4 depends on.

### E4 — NEW Story 8.6: Free-tier read-budget hardening

```
As the maintainer,
I want the hot routes to stop scanning the whole library per hit,
So that the free-tier DAU ceiling rises from ~550 toward the request cap (~6,600).

ACs (each from research 2026-07-17 Headroom table):
- GET /api/games/:id does a single-row WHERE id = ? (~1,500 → ~10 rows/hit)
- GET /api/settings uses SQL COUNT(*) instead of full-library scans
- GET /api/ps-plus-catalog pages via LIMIT/OFFSET in SQL
- catalog snapshot writes are diff-based upserts (only changed rows;
  write cliff ~100 → ~2,000 runs/day even before E2's per-region model)
- shelf responses carry a per-user library-version ETag → 304 on unchanged
  refetch; catalog responses cached per active region, version-keyed,
  invalidated by refresh (paged-vs-whole delivery decided by 8.0)
- (optional) better-auth session.cookieCache enabled

> Single-tenant-safe, no schema migration — pullable into v1.x like 8.1,
  outside 8.0's gate. When Epic 8 activates: before or parallel to 8.2.
```

### E5 — `publication-blockers.md`

- **B4 fix text** → per-region fan-out over distinct active regions; region-state ledger + retry-first; 60-day / cycle-complete skips; 35-day login guard.
- **B5** → retired: "Epic 11 removed all per-user PSN credentials; the catalog fetch is anonymous. Folded into B4's per-region model."
- **Epic 10 addendum** → note the departure columns (`ps_plus_left_on`, `ps_plus_leaving_on`, `psn_concept_id`) follow the same per-region shape.

### E6 — PRD amendment footnotes

- **FR-39:** "Amended (Epic 8): in multi-user, the refresh is per-region and cron-driven plus a stale-snapshot login guard; the manual button is removed (single-user keeps it until 8.4)."
- **FR-40:** "Amended (Epic 8): scheduled-refresh failures surface via the as-of timestamp and an 'updating…' notice, not attention banners — recovery is automatic (8.4 AC3) and no user action exists."

### E7 — `sprint-status.yaml`

Add Story 8.6 under Epic 8 with status `backlog`.

## 5. Implementation Handoff

**Scope: Minor–Moderate** — documentation-only backlog reorganization; no code, no schema, nothing in flight.

| Who | What |
|---|---|
| Developer agent (this session) | Apply E1–E7 edits to `epics.md`, `publication-blockers.md`, `prd.md`, `sprint-status.yaml` |
| Story 8.0 (future, when Epic 8 activates) | Absorbs the design decisions this proposal defers to it (budgets, cache delivery shape, skip conditions) |

**Success criteria:** all four artifacts updated consistently; Epic 8 contains no reference to per-user PSN credentials; Story 8.6 tracked in sprint status; research doc cross-referenced from Epic 8.

**Capacity effect (from research):** write cliff eliminated (writes scale with regions, not users); with 8.6 applied, DAU ceiling ~550 → ~6,600 (binding limit flips to the 100k request cap).
