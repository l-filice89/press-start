# Sprint Change Proposal — Epic 9 auth swap (S-1 outcome)

**Date:** 2026-07-13 · **Author:** Luca (via correct-course) · **Scope:** Moderate (backlog reorganization) · **Status:** Approved, applied

## 1. Issue Summary

Spike S-1 (Epic 9 story 9.1) ran live against PSN and produced the endpoint × auth-path table in `implementation-artifacts/deferred-work.md` (DW-10). It overturned the epic's working assumption that the `pdccws_p` session cookie could carry trophy sync:

- **Trophy endpoints reject the cookie (401)** and require an NPSSO bearer.
- **The bearer also serves the existing library sync** (`getPurchasedGameList` → identical `data{purchasedTitlesRetrieve}`), so it *replaces* the cookie rather than complementing it. NPSSO lives ~60 days with an offline refresh token vs the cookie's hours-to-days.
- **The wishlist is reachable in principle** — it's the Apollo persisted query `storeRetrieveWishlist` (document recovered from the public JS bundle) — but its hash is not client-computable (Apollo hashes the printed AST; freeform GraphQL is refused 400), so one client-side-nav capture is still needed.

Per story 9.1's own third branch, trophies needing NPSSO **promotes the auth swap out of Deferred and gates the epic**.

## 2. Impact Analysis

- **Epic 9:** gains an auth-swap prerequisite before trophy work; 9.4 re-scoped from "conditional on 9.1" to "conditional on a new 9.1c".
- **Story impact:** 9.2 (trophy sync) is now blocked on a new 9.1b; 9.4 blocked on a new 9.1c. 9.3 unchanged (still depends on 9.2).
- **Epic 4 (shipped):** its library-sync + PS+ catalog auth path migrates from cookie to bearer under 9.1b — the only touch to working code; contained behind `PsnProvider` (AR-5), re-verified with the degenerate-response guard.
- **Artifacts:** epics.md, roadmap.md, sprint-status.yaml, PRD (open-q #2 + FR-36), ARCHITECTURE-SPINE (Deferred S-1 entry) — all updated.

## 3. Recommended Approach — Direct Adjustment (chosen: full swap)

Add two stories within the existing epic rather than replan:

- **9.1b — full cookie→NPSSO swap** (gates 9.2). Bearer is a superset, so a replacement is less surface than a parallel two-credential hybrid: one credential, one refresh flow, far less user re-pasting. Risk (touching Epic 4 auth) is contained behind `PsnProvider` and the probe already proved response parity.
- **9.1c — final wishlist spike** (gates 9.4). Runs *after* 9.1b so it probes with the bearer the app will actually carry. Captures the real `storeRetrieveWishlist` hash + auth path.

Sequence: 9.1 ✓ → 9.1b → 9.2 → 9.3 → 9.1c → 9.4 (conditional). 9.4 does not block the valuable trophy work and may still drop to Future.

## 4. Detailed Change Proposals (applied)

- **epics.md** — reframed Epic 9 intro to the S-1 outcome; appended the DW-10 outcome to story 9.1's blockquote; inserted **Story 9.1b** (swap, 5 ACs) and **Story 9.1c** (wishlist spike, 2 ACs); re-scoped Story 9.4 header + first AC to 9.1c.
- **roadmap.md** — v1.3.0 sequence row, trophy-sync row (NPSSO prerequisite), wishlist row (conditional on 9.1c, endpoint identified), Epic 9 detail paragraph, and Deferred S-1 entry (marked done).
- **sprint-status.yaml** — epic-9 → in-progress; 9-1 → done; added 9-1b and 9-1c (backlog); 9-2 noted blocked on 9-1b; 9-4 conditional on 9.1c.
- **PRD** — open-q #2 RESOLVED (NPSSO replaces cookie); FR-36 updated to a credential-neutral statement moving to NPSSO in 9.1b.
- **ARCHITECTURE-SPINE** — Deferred S-1 entry marked resolved with findings; swap now scheduled as 9.1b, not "revisit when friction bites".
- **Probe harness** — moved to `tmp/probe-psn-auth.ts` (gitignored, local-only), not committed.

## 5. Implementation Handoff

**Scope: Moderate.** Next actionable story is **9.1b** (spec it via `bmad-dev-auto`, needs a live NPSSO to verify end-to-end). Then 9.2 → 9.3 resume automatically. 9.1c is a human-in-the-loop capture (one browser DevTools grab) before 9.4.

**Success criteria:** `PsnProvider` authenticates via NPSSO with silent bearer refresh; Epic 4 library + PS+ catalog sync verified green on the bearer; cookie path removed; settings stores `npsso`.
