# Sprint Change Proposal — 2026-07-13

Post-v1.1.1 roadmap consolidation. Three planning gaps surfaced while writing
`roadmap.md`: an item with no epic, an unresolved feasibility gate, and an open
question left open since the PRD.

**Scope: Moderate** — backlog reorganization across planning artifacts. No code
change, no rollback, MVP unaffected (v1 shipped).

## 1. Issue summary

| # | Issue | Evidence |
| --- | --- | --- |
| 1 | **Google sign-in has no epic.** PRD FR-47 defers Google OAuth to "v1.x"; Epic 8/B1 owns "real auth — drop the single-email gate". Nobody owns OAuth, and the two are the same publication blocker described twice. | `prd.md:152` (FR-47), `epics.md:1358` (B1), `publication-blockers.md:11` |
| 2 | **Wishlist sync has an unanswered feasibility gate.** Pulling the PS Store wishlist may or may not be reachable over the current `pdccws_p` cookie. Unanswered, it cannot be sequenced. The spine already defers a *separate* NPSSO spike asking the same question about a different endpoint. | `roadmap.md:17`, `ARCHITECTURE-SPINE.md:331` |
| 3 | **Score source open since the PRD.** RAWG vs IGDB vs OpenCritic (PRD open-q #5); the spine pre-committed to RAWG without deciding. IGDB is already a wired provider. | `prd.md:211`, `ARCHITECTURE-SPINE.md:332` |

## 2. Impact analysis

- **Epic impact:** Epic 8 only. B1's scope is restated; no epic added, removed, or resequenced. Epic 7 untouched.
- **Story impact:** no in-flight stories. B1 splits into B1a / B1b. One new spike (S-1) added to the deferred-technical ledger, not to an epic.
- **Artifact conflicts:** `prd.md` (FR-47, open-q #2 and #5), `ARCHITECTURE-SPINE.md` (Deferred), `epics.md` (Epic 8), `publication-blockers.md` (B1), `roadmap.md` (three rows).
- **Technical impact:** none until a story is picked up. B1a is a better-auth provider-config change (`src/services/auth.ts`), no schema migration. The `isAllowedEmail` gate keeps working unchanged under an OAuth callback.

## 3. Recommended approach

**Direct adjustment.** Effort: low (doc edits). Risk: low. Rollback and MVP review are not applicable — no work is invalidated and v1 has shipped.

### Decision 1 — Google OAuth is Epic 8, story B1a

B1 was one story doing two things with different trigger conditions. Split it:

- **B1a — Google OAuth provider.** Add Google to better-auth alongside magic link. The `AUTH_ALLOWED_EMAIL` gate **stays** and applies to the OAuth callback. Shippable **now** as a v1.x item; single-tenancy holds.
- **B1b — Drop the single-email gate.** Registration/invite replaces `isAllowedEmail`. Only correct once a second user is wanted; **stays demand-driven with the rest of Epic 8** and still gates B2–B6.

Both live in Epic 8. No Epic 9. The roadmap's "largest v1.x item with no home" is now B1a, pullable ahead of the rest of its epic — that is a sequencing choice, not an epic split.

### Decision 2 — one PSN auth spike (S-1), gating wishlist sync

Merge the wishlist feasibility gate with the spine's deferred NPSSO spike. They are one question:

> **S-1 — What does `pdccws_p` authorize, and what needs NPSSO?** Timebox: one afternoon. Probe, with the current cookie: (a) the PS Store wishlist endpoint, (b) `getPurchasedGameList`, (c) trophy endpoints. Then the same three under an NPSSO bearer. Output: a table of endpoint × auth-path, appended to `deferred-work.md`.

Branches:

- **Wishlist reachable over `pdccws_p`** → wishlist sync and trophy sync scope together as **one PSN epic** (shared provider work, one sync surface). Both stay v1.x.
- **Wishlist needs NPSSO** → the NPSSO swap becomes its prerequisite, not a nice-to-have. **Wishlist slips to Future**; trophy sync stays v1.x on its own (unless the spike shows trophies need NPSSO too — then the swap gates both and is promoted out of Deferred).

The spike also settles the spine's long-standing NPSSO question as a side effect. It buys a sequencing decision for an afternoon; leaving it open costs a scoping cycle every time either feature comes up.

### Decision 3 — critic & user scores come from IGDB

IGDB is the source. `aggregated_rating` / `aggregated_rating_count` (critic) and `rating` / `rating_count` (user) are on the same `/games` endpoint the app already queries — no new provider, no new credentials, no new rate-limit budget. RAWG and OpenCritic are both a second adapter for data one already-wired call returns.

**Fallback, not a plan:** if coverage proves thin for the library's actual titles, **OpenCritic** (a real critic aggregator, unlike RAWG's second-hand Metacritic scrape). Verify coverage on real data as the first task of the scores story — not with another spike.

## 4. Detailed change proposals

### 4.1 `epics.md` — Epic 8 story list (line ~1358)

**OLD**

```
- **B1 — Real auth** (registration/invite; drop or list-ify the single-email gate). Gates everything below.
```

**NEW**

```
- **B1a — Google OAuth** (FR-47). Add Google to better-auth alongside magic link; the
  `AUTH_ALLOWED_EMAIL` gate stays and applies to the callback. Single-tenant-safe, so it is
  **pullable into v1.x ahead of this epic** — it does not gate, and is not gated by, B1b.
- **B1b — Drop the single-email gate** (registration/invite replaces `isAllowedEmail`). Demand-driven.
  Gates everything below.
```

**Rationale:** the two halves have different trigger conditions. Splitting them gives Google sign-in an owner without creating an epic for it, and without dragging the demand-driven half into v1.x.

### 4.2 `publication-blockers.md` — B1 row

Split the B1 row into B1a / B1b matching 4.1, keeping `src/services/auth.ts:34` as the "where" for B1b. Update the **Order** line to `B1b → B2+B3 → B4+B5 → B6` and note that **B1a is independent of the ordering** (it can ship at any time). Update the status line: still none resolved.

**Rationale:** this table is the live source; if it and `epics.md` disagree on B1 the split is undone by the next reader.

### 4.3 `prd.md` — FR-47 (line 152)

**OLD**

```
- **FR-47** — **better-auth with magic link** for v1; Google OAuth is v1.x.
```

**NEW**

```
- **FR-47** — **better-auth with magic link** for v1; **Google OAuth is v1.x, owned by Epic 8 story B1a**
  (added alongside magic link; the `AUTH_ALLOWED_EMAIL` gate still applies to the callback — dropping
  that gate is B1b, and is a separate, demand-driven decision).
```

### 4.4 `prd.md` — §7 Open Questions

- **Q2 (PS auth / NPSSO)** — mark **superseded by spike S-1**, which subsumes it and adds the wishlist + trophy endpoints.
- **Q5 (Score source)** — mark **RESOLVED: IGDB** (`aggregated_rating` + `rating`, already-wired provider). OpenCritic is the fallback if coverage is thin.

### 4.5 `ARCHITECTURE-SPINE.md` — Deferred (lines 331–334)

**OLD**

```
- **NPSSO/psn-api auth swap** — a spike must confirm an NPSSO bearer token authorizes
  `getPurchasedGameList` + the PS+ catalog queries; then swap the `PsnProvider` auth ...
- **RAWG as Metacritic score source** — v1.x (PRD open-q #5). Added as a second `providers/`
  adapter; genres/covers stay on IGDB.
```

**NEW**

```
- **Spike S-1 — PSN auth surface** (one afternoon) — probe, under `pdccws_p` and then under an NPSSO
  bearer: the PS Store **wishlist** endpoint, `getPurchasedGameList`, and the trophy endpoints. Output is
  an endpoint × auth-path table. It answers the old NPSSO-swap question **and** gates whether wishlist
  sync ships with trophy sync as one PSN epic or slips to Future. Isolated by AD-5; the swap itself stays
  a `PsnProvider` internal.
- **Critic & user scores — IGDB** (PRD open-q #5, RESOLVED). `aggregated_rating` (critic) and `rating`
  (user) come from the `/games` endpoint the `IgdbProvider` already calls — **no second adapter**. Scored
  fields + a scheduled refresh only. Fallback if coverage is thin on real titles: OpenCritic. RAWG is out.
```

Line 334's "Trophy sync, critic/user scores, 'leaving PS+ soon', Google OAuth — v1.x" stays accurate; append `(Google OAuth → Epic 8/B1a)` so the pointer exists.

**Rationale:** the spine's RAWG bullet pre-committed to a source the PRD had left open — the docs contradicted each other. One bullet now carries the decision and its fallback.

### 4.6 `roadmap.md` — three rows

- **Google sign-in** — replace "**No epic owns it**" with "**Epic 8, story B1a**"; drop the "Epic 8/B1 is adjacent but is registration/invite, not OAuth" sentence (the split makes it false).
- **Wishlist sync** — replace the trailing feasibility-gate sentence with a pointer to **spike S-1** and the two branches (ships with trophy sync as one PSN epic / slips to Future).
- **Critic & user scores** — replace "Open question, never resolved: RAWG vs IGDB vs OpenCritic" with "**IGDB** (`aggregated_rating` + `rating`) — no new adapter. OpenCritic if coverage is thin."
- **Deferred technical work** — replace the NPSSO bullet with S-1.

## 5. Implementation handoff

**Scope: Moderate** → Product Owner / Developer. All six edits are documentation; no story is in flight and no code moves.

| Deliverable | Owner |
| --- | --- |
| Apply edits 4.1–4.6 | Developer (direct) |
| `sprint-status.yaml` — no change | — (Epic 8 is not in the sprint; B1a/B1b enter it when scoped) |
| Run spike S-1 | Developer, one afternoon, next session |
| Re-file wishlist sync per the S-1 branch | PO, after S-1 |

**Success criteria:** every v1.x roadmap item names an owning epic or a gate that decides its tier; PRD open-q #5 is closed; no two artifacts disagree about B1 or the score source.
