# Rubric-Walk Review — ARCHITECTURE-SPINE (PRESS START / PS Game Catalog)

- **Reviewer role:** rubric-walker (good-spine checklist)
- **Date:** 2026-07-05
- **Spine under review:** `architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md`
- **Verdict:** **PASS-WITH-FIXES** — the invariant set is strong, enforceable, and well-isolated; findings are targeted gaps, none blocking.

---

## Checklist walk

### 1. Fixes the real divergence points for the level below (feature→epics), misses none

**Largely met.** The ADs pin the genuine cross-epic invariants that would otherwise let two epics diverge:

- Layering + dependency direction with `core/` as a sink (AD-3, diagram).
- The two portability seams — persistence (AD-4) and providers (AD-5).
- Single-source computation of effective state (AD-7), derived state (AD-8), and title normalization (AD-9) — the three "computed twice → drift" traps.
- The append-only write guard (AD-10) and write-once dates (AD-11) — the "sync clobbers user data" trap that project-context flags as critical.
- The completion invariant at the boundary (AD-12), user-scoping from row one (AD-13), failure surfacing (AD-14), bulk-work chunking (AD-15), CI migrations (AD-16).

These are the right seams for epic decomposition. Minor residual divergence risks left implicit (all low, see findings): primary-key strategy (uuid vs autoincrement), infinite-scroll pagination shape (cursor vs offset, FR-19), and date/timezone semantics for the "≤ today" released check (FR-12). Each is de-risked by the shared `schema/` module (first-mover sets it), so they are acceptable to leave to the schema rather than an AD.

### 2. Every AD's Rule is enforceable and actually prevents its divergence

**Met.** The strongest rules are structurally/lint-enforceable rather than aspirational:

- AD-3 ("`core/` imports no `fetch`/D1") and AD-6 ("a `fetch` in a query path is an architecture violation, not a judgment call") are enforceable via a dependency-boundary linter (dependency-cruiser / Biome import rules) — the spine correctly frames them as structural, not stylistic.
- AD-4/AD-5 seams are enforceable by forbidding D1/`fetch` imports outside `repositories/` and `providers/`.
- AD-10's "membership-sourced entries filtered at the ingest boundary" is enforceable at one code location; the softer clause ("prefer skipping over flipping `Owned` when ambiguous") is a documented judgment default, which is appropriate — it fails safe.

No AD's rule is a mere restatement of its goal; each names the concrete mechanism.

### 3. Nothing under Deferred could let two units diverge

**Met.** Every deferred item is quarantined behind an existing seam before it is deferred:

- NPSSO/psn-api auth swap → isolated inside `PsnProvider` (AD-5). Explicitly flagged.
- RAWG score source → a second `providers/` adapter; IGDB stays authoritative for genres/covers.
- Sale detection → future Cron over wishlisted titles; its only prerequisite (PS Store product IDs) is already being captured via FR-16, and `EXTERNAL_LINK` can hold it — no schema fork forced later.
- Trophy sync / scores / Google OAuth → provider seam + `user_id` scoping already in place.
- Multi-tenant hardening → AD-13 keeps the door open, nothing more built.
- Convex/Postgres migration → AD-4 makes it a repository-layer change.

No deferred item requires two v1 units to agree on something the spine leaves unstated.

### 4. Named tech is verified-current (author web-verified 2026-07-05)

**Met, with two precision notes** (I re-verified the two most falsifiable, load-bearing claims on 2026-07-05):

- **Cloudflare Workers free-tier subrequest cap** (the load-bearing constraint behind AD-15): confirmed — free plan is **50 *external* subrequests** + 1000 subrequests to Cloudflare services (D1/KV/R2) per invocation; the paid-plan 1000 cap was lifted Feb 2026. AD-15's out-of-band seed decision is *correctly* motivated: enriching ~344 games hits IGDB once+ per game = ~344 external subrequests, far over the 50 external cap, so it must run out-of-band. **However** AD-1's phrase "D1 … reached via binding (not a subrequest)" and AD-15's bare "50-subrequests/invocation cap" are imprecise: D1 binding calls *are* subrequests, just under the separate 1000-Cloudflare-services limit, not the 50-external one. Practically harmless, but the label should read "50 *external* subrequests" so epics don't mistakenly ration D1 reads. (Finding 4.)
- **Drizzle ORM 0.44.x pin:** confirmed real and recent; current latest is 0.45.2 (published ~3 months prior) with a 1.0 RC line in progress. 0.44.x is one minor behind — conservative, not stale. Fine. (Finding 5, low.)
- Remaining stack (Hono, Zod, TanStack Query, Vite + vite-plugin-pwa, better-auth magic link, Biome v2, Workers Static Assets, Cron Triggers, `@cloudflare/vitest-pool-workers`) is internally consistent and matches the 2025-2026 Cloudflare-native stack; nothing reads as abandoned or pre-release-only. Workers Static Assets (not legacy Workers Sites/Pages) is the current serving primitive — good.

### 5. Ratifies rather than contradicts the brownfield project-context; the deliberate Bun overturn is justified and flagged

**Met — the Bun overturn is exemplary.** AD-2 does not silently drop the project-context "Bun runtime" preference; it:
- names it a *supersession* ("supersedes the project-context 'Bun runtime' preference"),
- gives the technical reason (Bun-only APIs like `bun:sqlite`/Bun globals can't run on workerd/V8),
- gives the priority chain (AD-1: free-tier hosting > SQLite preference > Bun preference — an explicit, defensible ordering rooted in NFR-1),
- confines Bun to a legitimate residual role (local package manager / test runner / out-of-band script runner), and
- commits to updating `project-context.md` to match.

This is a flagged, justified overturn, not an accident. Everything else in project-context is *ratified*: SQLite-flavored preference honored via D1 (SQLite); legacy Python frozen (Stack row "Legacy (frozen)"); `pdccws_p` cookie auth honored and localized (AD-5 + Secrets convention); append-only-by-game honored and hardened (AD-10); genres-from-external-DB honored (AD-9 + GENRE convention); PS4/PS5 collapse honored (AD-9); never-commit-cookie/DB honored (Secrets convention). No contradictions found.

The four PRD open questions that were architecture-time decisions are all resolved: DB (→ D1, AD-1; Convex deferred), PS auth (→ v1 cookie, NPSSO deferred), games DB (→ IGDB), scheduled job (→ Cron Triggers). Good closure.

### 6. Covers the PRD's capabilities (FR-1..FR-49, NFR-1..NFR-4) — flag any FR/NFR with no architectural home

**Substantially met.** Coverage map below. All NFRs and the large majority of FRs have a clear home. Genuine gaps: FR-38 (per-region dimension) and FR-30 (Notion status mapping) — see findings.

| FR/NFR | Home | Note |
|---|---|---|
| FR-1,2 | `core/` state model, GAME_TRACKING, AD-12 | ok |
| FR-3 | AD-12 (boundary invariant) | strong |
| FR-4 | read routes / AD-7 effective state | homed, not AD-named |
| FR-5,6 | AD-8, AD-11, structural seed | ok |
| FR-7 | AD-12 (confirm-gated) | ok |
| FR-8 | **AD-7** | strong |
| FR-9,10 | **AD-10** + addendum | strong |
| FR-11 | GAME_TRACKING.ownership_type | homed, no AD (low) |
| FR-12,13,14 | **AD-8** | strong |
| FR-15,16 | `web/` + read routes, AD-6 (persisted covers/links) | ok |
| FR-17,18,21 | AD-7 (ordering/labels/filters consume effective state) | ok |
| FR-19 | `web/` + read routes | search/scroll client concern; pagination shape unstated (low) |
| FR-20,22 | filter row, AD-7 | ok |
| FR-23,24,25 | AD-9 + GENRE convention + GAME_GENRE | ok |
| FR-26,27 | **AD-9, AD-10, AD-15** | strong |
| FR-28 | AD-14 (stragglers) | ok |
| FR-29 | EXTERNAL_LINK + "permanent alias survives re-sync" convention | ok |
| FR-30 | seed (`scripts/`+`services/`) | **no governing AD for the mapping table / "unknown→straggler"** (Finding 3) |
| FR-31,32 | AD-10 / AD-11 | ok |
| FR-33,34 | **AD-10, AD-9, AD-5** | strong |
| FR-35 | **AD-6** (captured at sync, persisted) | strong |
| FR-36 | AD-5 + AD-14 + Secrets convention | strong |
| FR-37,40 | AD-14 + four UI channels | ok |
| FR-38 | AD-5 (flag via provider); AD-8-style hide-once-owned | **per-region catalog dimension unhomed** (Finding 1) |
| FR-39 | **AD-1** (Cron Triggers) + AD-15 | strong |
| FR-41 | AD-5 + AD-14 (name-only → stragglers) | ok |
| FR-42 | AD-9 (normalizer on search path) | ok |
| FR-43 | `services/` add + AD-11 (wishlisted_on) | ok |
| FR-44,45 | **AD-11** | strong |
| FR-46 | Stack: React+Vite+vite-plugin-pwa | ok |
| FR-47 | Auth convention + Stack (better-auth magic link) | ok |
| FR-48 | **AD-13** | strong |
| FR-49 | Capability map: `routes/` streaming from D1, AD-4/AD-6 | ok |
| NFR-1 | **AD-1** (free-tier single vendor) | strong |
| NFR-2 | AD-1 + AD-15 (cron fits free tier) | strong |
| NFR-3 | **AD-6** (structural: no external on render) | strong |
| NFR-4 | **AD-14** (failures surface, no silent retry) | strong |

### 7. Every dimension the feature altitude owns is decided, deferred, or an open question — no whole silent dimension

**Mostly met; the operational envelope is decided on deployment/environments but thin on observability + backup/DR.**

- **Deployment:** decided (AD-16 CI-runs-migrations-then-deploy + the deployment mermaid: local wrangler → CI → Prod).
- **Environments:** decided (Dev = wrangler dev/miniflare + local D1; CI; Prod). Single-user scale justifies no staging tier.
- **Infra / hosting:** decided (AD-1 single-vendor Cloudflare; Worker + Static Assets + D1 + Cron).
- **Secrets:** decided (Wrangler secrets + live cookie in D1 settings table; never committed).
- **Operations — partial silence (Finding 2):** the *user-facing* failure strategy is well-specified (AD-14 + four UI channels + "failed scheduled refresh surfaces on next app open"). But there is **no observability/logging/monitoring posture** for the unattended Cron path (a monthly PS+ refresh can fail silently to the operator until the next app open — acceptable by design, but structured logging / `wrangler tail` / error visibility is unstated), and **no backup/disaster-recovery posture** beyond FR-49 CSV export (D1 Time Travel and an export cadence are unmentioned, though Deferred alludes to "the DB provider's backups are not the only copy"). This is a *narrow* gap, not a whole silent dimension — deployment and environments are decided — and it is defensible at single-user free-tier scale, but it should be named rather than left implicit.

---

## Findings (ranked)

**Finding 1 — [HIGH] FR-38 per-region PS+ Extra catalog is an undecided dimension with no home.**
FR-38 states the catalog "is per-region — the check runs against the user's account region," but no AD, no `SETTING`/user field, and no provider rule captures *where region comes from* or *where it is stored*. Two ingest paths (button-triggered vs Cron-triggered PS+ check) could resolve region differently, or the Cron path could run region-less.
*Fix:* add region to the `SETTING`/user config (or derive-and-persist it from the PSN account on sync) and cite it in AD-5's `PsnProvider` rule so both the manual and scheduled PS+ checks read the same region source.

**Finding 2 — [HIGH] Operational envelope is thin on observability and backup/DR.**
Deployment and environments are decided, but the unattended Cron path has no logging/monitoring posture and backup/DR is limited to the FR-49 CSV export.
*Fix:* add a short Operations note — structured logging + `wrangler tail`/error visibility for ingest & cron jobs (the "failures surface" bar extends to the operator, not only the UI), and state the D1 backup posture (Time Travel + a periodic export cadence) so recovery isn't solely the user remembering to hit Export CSV.

**Finding 3 — [MEDIUM] FR-30 Notion status-mapping is unhomed by any invariant.**
The mapping table (`Completed`→null+`completed_on`; `Up next!`→`Up next`; `Not released`→`Not started`; `Rating` dropped; unknown-status/`Completed`-without-date → stragglers) has no governing AD. Risk is low (one-time, isolated in `scripts/`+`services/`), but it is a real business rule with no single-source guarantee.
*Fix:* note that the mapping lives as one pure function in `core/` (reusing the AD-9 normalizer), one-time, with the "can't place it → straggler, never guess" rule pinned — even a one-line convention row closes it.

**Finding 4 — [LOW] Subrequest-cap wording is imprecise (verified 2026-07-05).**
Free-tier cap is **50 *external* subrequests** (plus a separate 1000 for Cloudflare-service calls like D1). AD-1's "D1 … not a subrequest" and AD-15's bare "50-subrequests/invocation cap" could lead an epic to needlessly ration D1 reads. The out-of-band-seed decision itself is correctly motivated.
*Fix:* relabel to "50 *external* subrequests"; note D1 binding calls fall under the separate 1000-Cloudflare-services limit.

**Finding 5 — [LOW] Drizzle pin is one minor behind.**
0.44.x verified real/recent; current latest is 0.45.2 (1.0 RC in progress). Conservative, not stale — optionally bump to 0.45.x or note the 1.0 line as a watch item.

---

## What the spine gets right (worth preserving)

- The two-seam ports-and-adapters call ("not full hexagonal — a single-user app doesn't earn that ceremony") is correctly scoped to portability + testability, not ceremony.
- AD-3/AD-6 framed as *structural, lint-enforceable* violations rather than review judgment — this is what makes the invariants hold across epics.
- The Bun overturn (AD-2) is the model for how to overrule brownfield context: named, reasoned, priority-ordered, and committed back to project-context.
- The membership-sourced-entitlement guard (AD-10) directly encodes the adversarial addendum finding (123/175 export entries are PS+ claims) into a boundary rule with a fail-safe default.
- Every Deferred item is quarantined behind an existing seam before deferral — no future feature forces a v1 schema/interface fork.
