---
title: Sprint Change Proposal — PSN Account Safety
date: 2026-07-15
author: Luca (via Correct-Course)
status: approved
approved: 2026-07-15
scope_classification: major
trigger: PSN account lock; credentialed PSN automation is a standing ban risk
---

# Sprint Change Proposal — Sanitize the App of PSN Ban Risk

## 1. Issue Summary

**Problem:** Press Start authenticates to PlayStation **as the user**, with the user's own NPSSO token, to run library sync, trophy sync, and the platinum backfill. Every one of those calls is attributed to the user's real PSN account. On 2026-07-15 the account was **locked** (`error=login_required` / `error_code=4165` at the authorize leg), immediately after credentialed calls.

**Context of discovery:** Started as a "trophy sync isn't working" bug. Investigation found the immediate cause was an expired NPSSO token, plus a latent defect (the sign-in-page redirect wasn't recognized as a denial — fixed today in `src/providers/psn.ts`). While diagnosing, the account was locked, which reframed the problem from "one broken feature" to "the app carries a permanent, structural PSN-ban risk."

**Evidence:**
- The credentialed flow impersonates the PSN Android app (its `client_id`, the app's basic-auth secret, the `com.scee.psxandroid://redirect` scheme, a spoofed mobile UA) and calls undocumented endpoints via persisted-query hashes — a clear PSN Terms-of-Service breach. Verified against community docs (andshrew/PlayStation-Trophies, achievements-app/psn-api): **no official public trophy/library API exists**; everyone reverse-engineers the same surface, and "excessive use may lead to a PSN account being temporarily or permanently banned — create a dedicated account to mitigate."
- The platinum backfill fans out ~1 request per trophy title (~137 sequential calls) — the most bot-like traffic the app produces.
- The **only** unattended PSN traffic (the monthly PS+ catalog cron) is **anonymous** — no cookie, no bearer (verified: `fetchCatalogPage` sends only `accept`/`content-type`/`x-psn-store-locale-override`). It carries no account identity and **cannot** trip an account lock.

**The distinction that drives everything:** account-ban risk exists **only** where the app puts the user's credential on the wire. Remove the credential entirely, and the account leaves the blast radius. The anonymous PS+ catalog feature is unaffected.

## 2. Impact Analysis

### Epic impact
- **Epic 4 (Fill the Library from PlayStation — Sync):** functionality **removed**. The one-time seed already populated the library; going forward, new purchases are added via the existing Epic 6 add-by-name flow (manual).
- **Epic 9 (The PSN Record — Trophies):** functionality **removed** (trophy sync + platinum backfill + trophy display). Completion/platinum tracking survives via the manual milestone flow (Epic 2).
- **Epic 5 / Epic 7 (PS+ Extra awareness + catalog browse):** **unaffected** — anonymous store-browse, no credential.
- **New Epic 11 (this proposal):** the removal work.

### Artifact conflicts
- **PRD:** FR-33–FR-37 (library sync) and the sync clauses of FR-9/FR-10 no longer implemented; the v1.x trophy bullets in §6 and FR-36 (stored PS credential) are superseded. PRD §1 vision ("a library that fills itself" / "every owned game present without manual entry") is **partially rescinded** — the honest trade below.
- **Architecture:** AR-5 (`PsnProvider` seam) narrows to **anonymous catalog only**; the NPSSO exchange, `PsnAuthError` credentialed paths, and the auth-expired banner leave the spine. The single-flight PSN lock keeps only `catalog-refresh`.
- **UX:** FAB loses "Sync library" and "Sync trophies"; Settings loses the NPSSO token field and the expired-token banner; Card + DetailPanel lose the trophy %/grade readout.
- **Schema/migrations:** a new migration drops `trophy_*` columns and the `psn_npsso` / `psn_auth` settings rows. **`owned_via` / `bought_on` stay** — they serve the manual purchased-vs-claimed ownership model (Epic 6.4), not just sync.
- **Tests:** delete the credentialed provider/route/service suites and e2e (`epic9-trophies.spec.ts`); keep the anonymous catalog suites.

### The honest product trade
Removing library sync rescinds the PRD's headline promise ("bought and forgot becomes impossible"). New purchases now require a manual add — the exact "manual entry regresses" counter-metric §1 warned about. **Accepted deliberately:** the app was born as a manual tracker (the Notion era); credentialed sync was a late convenience, and its cost is the user's real PSN account. The seed import already delivered the trustworthy baseline once; the residual is manual upkeep.

## 3. Recommended Approach

**Direct adjustment — add one high-priority removal epic (Epic 11).** Not a rollback (git-reverting Epics 4/9 would also tear out shared infra the catalog features still use); not an MVP re-scope (the MVP stands, minus the credentialed surface). A clean forward-only excision, sequenced **now, ahead of all backlog epics**.

- **Effort:** Medium. Mostly deletion + a schema migration + UI trims.
- **Risk:** Low. Removing code, not adding behavior; the surviving surfaces (manual tracking, anonymous PS+) are already shipped and tested.
- **Ban-risk after:** effectively zero on the account axis — no credential ever on the wire. Residual is the anonymous catalog scrape (ToS-technical only; worst case is an endpoint IP-block, never an account ban).

## 4. Detailed Change Proposals

### 4.1 New epic — `epics.md`

Insert after Epic 10, and add to the Epic List:

```markdown
### Epic 11: PSN Account Safety — Sanitize the Credentialed Surface — _HIGH PRIORITY_
Every call Press Start makes to PlayStation with Luca's own NPSSO token is
attributed to his real account — and locked it once. This epic removes the
entire credentialed PSN surface: library sync, trophy sync, and the platinum
backfill, plus the NPSSO auth machinery and the trophy display that depended on
it. What stays is everything that carries no account identity — the anonymous
PS+ Extra catalog (check + monthly cron), manual add-by-name, and manual
milestone tracking. After this epic, no credential ever reaches the wire, so the
account is out of the ban blast radius. Supersedes Epic 4 (sync) and the
credentialed half of Epic 9 (trophies); PS+ awareness (Epics 5/7) is untouched.
**Sequenced first — ahead of Epics 8 and 10.**
**FRs affected:** FR-33–FR-37 removed; FR-9/FR-10 sync-clauses removed; FR-36 superseded; Epic 9 VR-2/VR-3 display removed · AR-5 narrowed to anonymous catalog
```

Stories:

```markdown
### Story 11.1: Sever the credentialed PSN operations
Delete the three credentialed routes (`POST /sync`, `/sync/trophies`,
`/backfill/platinum-dates`) and their services (`services/sync.ts`,
`services/trophies.ts`, `services/backfill.ts`). Remove the FAB "Sync library"
and "Sync trophies" buttons and both readout modals (`SyncSummaryModal`,
`TrophySyncModal`). The FAB keeps "Check PS+ Extra" and "Export CSV". The
Settings backfill panel is removed. AC: no route or UI path can trigger a
credentialed PSN call; catalog check + export still work; suites green.

### Story 11.2: Strip PSN credential auth from the provider and settings
Collapse `PsnProvider` to its anonymous catalog methods only — remove
`exchange`/`getBearer`, the `getNpsso` plumbing, `fetchPurchasedGames`,
`fetchTrophyTitles`, and the credentialed `PsnAuthError` paths. Remove the NPSSO
settings field, the expired-token banner (`markPsnAuthExpired`, `psn_auth`
setting), and the psn-lock ops that only served credentialed work (keep the lock
for `catalog-refresh`). Migration drops the `psn_npsso` and `psn_auth` setting
rows. Wrangler `PSN_NPSSO` secret retired from deploy. AC: the app builds and
runs with zero NPSSO code; the catalog cron + check still pass their tests.

### Story 11.3: Remove the trophy display and schema
Drop the trophy %/grade readout from `Card.tsx` and `DetailPanel.tsx`, delete
`core/trophy.ts` and its tests, and migrate out the `trophy_*` columns
(`trophy_earned_*`, `trophy_defined_*`, `trophy_np_comm_id`,
`trophy_np_service_name`). **Untouched:** `platinum_on` / `completed_on` and the
manual milestone flow (Epic 2), and `owned_via` / `bought_on` (manual ownership
model, Epic 6.4). Delete `playwright/e2e/epic9-trophies.spec.ts`. AC: no trophy
UI or column remains; manual platinum/completion tracking is unchanged.
```

### 4.2 PRD amendments — `prd.md`

Add a banner note under the affected FRs (do not delete the history):

- **§4.2 PS library sync (FR-33–FR-37):** prepend
  `> **RESCINDED 2026-07-15 (Epic 11, PSN Account Safety):** the credentialed PS library sync is removed — it authenticates as the user and risks an account ban. New purchases are added via §4.4 add-by-name (manual). The one-time seed (§4.1) remains the library's origin.`
- **FR-9 / FR-10:** append `(sync-set clause removed by Epic 11; ownership is now seed- or manually-set only).`
- **FR-36:** append `**Superseded 2026-07-15 (Epic 11):** no stored PS credential — the app makes no credentialed PSN call.`
- **§6 v1.x trophy bullet:** append `**Removed 2026-07-15 (Epic 11):** trophy sync withdrawn (account-ban risk); completion/platinum tracked manually via milestones (§2).`
- **§1 vision:** append a footnote to "a library that fills itself" — `† Amended 2026-07-15: automated PS sync removed for account safety; the library is seeded once, then maintained by manual add. Trust now rests on manual upkeep, an accepted trade (see sprint-change-proposal-2026-07-15).`

### 4.3 Architecture amendments — `ARCHITECTURE-SPINE.md`

- **AR-5:** note the `PsnProvider` seam is now **anonymous store-browse only**; the NPSSO exchange and `PsnAuthError` credentialed paths are removed (Epic 11).
- **Single-flight PSN lock:** `PsnOp` reduces to `catalog-refresh` (the credentialed ops are gone).

## 5. Implementation Handoff

- **Scope classification: Major** (rescinds shipped functionality across two epics and amends the PRD vision) — but low-risk mechanically.
- **Route to:** Product Manager (John) to land the PRD/architecture/epics amendments; then Developer (Amelia) to implement Stories 11.1–11.3 in order (11.1 → 11.2 → 11.3; 11.2 depends on 11.1's callers being gone, 11.3 is independent but sequenced last for a clean migration).
- **Success criteria:** (1) grep proves no `fetchPurchasedGames` / `fetchTrophyTitles` / NPSSO / bearer-exchange code remains; (2) the app builds, runs, and the anonymous PS+ catalog check + cron + CSV export still pass; (3) manual add and manual milestone flows unchanged; (4) a migration cleanly drops the trophy columns and PSN credential settings; (5) full suite + e2e green.
- **Note:** today's `login_required` provider fix (`src/providers/psn.ts` + test) is subsumed by Story 11.2's deletion of that code — it can ship now as a stopgap or be folded into 11.2.

## 6. Deferred / revival note

If trophies are ever wanted back **without** account risk, the only safe path is the PSNProfiles model: authenticate as a **dedicated burner account** reading the user's **public** profile — never the main account's credential. Recorded here as the sanctioned revival route; not in scope for Epic 11.
