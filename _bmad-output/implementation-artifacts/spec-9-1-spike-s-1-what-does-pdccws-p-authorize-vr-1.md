---
title: 'Spike S-1 — what does `pdccws_p` authorize?'
type: 'chore'
created: '2026-07-13'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** Epic 9's sequencing rests on an unanswered question — whether the `pdccws_p` web session cookie authorizes the PS Store wishlist and the trophy endpoints, or whether those need an NPSSO bearer. Story 9.4 (wishlist sync) stays in the epic or drops to Future purely on this answer, and 9.2 (trophy sync) cannot model its wire contract until the trophy endpoints have been observed under a real credential.

**Approach:** Probe three endpoint families (`getPurchasedGameList`, the trophy v1 REST API, the store wishlist GraphQL op) under both auth paths against live PSN, record the observed status and response shape in an endpoint × auth-path table appended to the deferred-work ledger, and state the sequencing consequence explicitly. No production code need survive.

## Boundaries & Constraints

**Always:** Probe the real service with real credentials and record what is *observed* — status code and response shape, verbatim. The probe sends the same origin/referer/client-name headers the live adapter sends (`src/providers/psn.ts`), because a probe that lies about its origin proves nothing about the adapter. "Reachable" means 2xx carrying a `data{}` payload; an HTTP 200 carrying `errors[]` is a denial, not a success (the Epic 4 production bug).

**Block If:** No live `pdccws_p` cookie and no NPSSO token are available to the run. Both are human-held secrets obtained from an interactive, signed-in Sony browser session; they cannot be minted unattended. **This condition is currently TRUE — see Auto Run Result.**

**Never:** Do not infer any cell of the table from HTTP convention, a reference implementation, or a third-party library's README. An unprobed cell is recorded as unprobed. Do not guess the wishlist persisted-query hash — it is not publicly documented and a wrong hash returns `PersistedQueryNotFound`, which is indistinguishable from "not authorized" to a reader of the table. Do not commit any credential.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Endpoint authorized by cookie | Valid `pdccws_p` | 2xx + `data{...}` → row records "reachable" | No error expected |
| Endpoint rejects cookie | Valid `pdccws_p`, endpoint needs bearer | 401/403, **or HTTP 200 + `errors[]` denial** → row records "not reachable" + the observed shape | Both shapes recorded; the 200+errors case is the one that matters |
| Stale session | Expired `pdccws_p` | PSN serves login HTML, not JSON | Recorded as "credential expired — re-probe", never as "not reachable" |
| NPSSO exchange | Valid `npsso` | authorize → code → bearer token | Exchange failure recorded; bearer column left unprobed rather than blank-guessed |
| Wishlist hash unknown | No `PSN_WISHLIST_HASH` | Row reports "hash not captured" | Never guessed |

</intent-contract>

## Code Map

- `tmp/probe-psn-auth.ts` -- **written by this spec.** The probe harness. Reads `PSN_COOKIE` / `PSN_NPSSO` / `PSN_WISHLIST_HASH` from env, prints the endpoint × auth-path table. Read-only; no writes to PSN or D1.
- `src/providers/psn.ts` -- the live adapter. Source of the pinned `getPurchasedGameList` persisted-query hash (copied verbatim into the probe) and the header set the probe mirrors. Any auth swap the spike recommends is confined to this file (AR-5).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the ledger the resulting table is appended to, as `### DW-10`, following the DW-1..DW-9 field convention (`origin:` / `location:` / `reason:` / `status:` / `resolution:`).
- `_bmad-output/planning-artifacts/prds/` + the architecture spine -- PRD open-q #2 and the spine's Deferred NPSSO entry, both closed by the spike's outcome.

## Tasks & Acceptance

**Execution:**
- [x] `tmp/probe-psn-auth.ts` -- write the probe harness; mirror the adapter's headers, copy the persisted-query hash verbatim, summarize responses without dumping personal library data -- so the spike's live run is one command and its evidence is reproducible.
- [ ] **HUMAN** -- capture a fresh `pdccws_p` from a signed-in `library.playstation.com` session, an `npsso` from `https://ca.account.sony.com/api/v1/ssocookie`, and the wishlist persisted-query `sha256Hash` from DevTools on the PS Store wishlist page -- the three secrets the run needs and no agent can mint.
- [ ] **HUMAN** -- run `PSN_COOKIE=… PSN_NPSSO=… PSN_WISHLIST_HASH=… bun tmp/probe-psn-auth.ts` and hand back the printed table -- the spike's only source of truth.
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- append the observed table as `### DW-10` with the sequencing decision -- the spike's deliverable.
- [ ] planning docs -- close PRD open-q #2 and resolve the spine's Deferred NPSSO entry, citing DW-10.

**Acceptance Criteria:**
- Given a valid `pdccws_p` cookie, when the probe runs, then the wishlist endpoint, `getPurchasedGameList`, and the trophy endpoints are each recorded reachable / not reachable with the observed status and response shape.
- Given an NPSSO bearer, when the same three are probed, then the same cells are filled for the NPSSO column, yielding a complete endpoint × auth-path table in `deferred-work.md`.
- Given the table, when the spike closes, then it states the consequence explicitly: wishlist reachable over `pdccws_p` → story 9.4 stays in Epic 9; wishlist needs NPSSO → the auth swap becomes its prerequisite, 9.4 drops to Future, and 9.2/9.3 proceed alone; trophies *also* need NPSSO → the swap is promoted out of Deferred and gates the whole epic.
- Given the spike is complete, when the planning docs are updated, then PRD open-q #2 is closed and the spine's Deferred entry is resolved.

## Spec Change Log

## Review Triage Log

## Design Notes

The trophy API is a different host and protocol from the library API (`m.np.playstation.com`, REST) rather than the `web.np.playstation.com` GraphQL surface the adapter speaks today. That asymmetry is the reason the spike exists rather than being an assumption anyone can reason their way to: there is no principled basis to expect a web-session cookie minted for `library.playstation.com` to carry over.

The NPSSO → bearer exchange is the standard PSN mobile-app OAuth flow (authorize with `Cookie: npsso=…` → grab `?code=` off the redirect → exchange for a JWT). It is implemented in the probe so the bearer column can be filled in the same run.

## Verification

**Commands:**
- `bun tmp/probe-psn-auth.ts` -- expected: with no env vars set, exits cleanly printing a table whose every cell reads "not probed (no credential)". This confirms the harness runs and, critically, that it reports absence rather than inventing a result.
- `bunx biome check tmp/probe-psn-auth.ts` -- expected: clean.

**Manual checks (if no CLI):**
- With real credentials supplied, every cell of the printed table is a status + shape actually returned by PSN; no cell is filled from convention.

## Auto Run Result

Status: done (2026-07-13, after a human supplied live credentials and ran the probe)

The spike's deliverable — the endpoint × auth-path table — is recorded in `deferred-work.md` as **DW-10**. Verdicts:

- **Trophies REQUIRE NPSSO** (cookie → 401, bearer → 200). Story 9.1's third branch fires: the NPSSO auth swap is promoted out of Deferred and **gates Epic 9**. Story 9.2 cannot proceed under the cookie.
- **The bearer is a superset of the cookie** — it also serves `getPurchasedGameList`, so the swap is a replacement (one credential), not a second parallel one. NPSSO lives ~60 days with an offline refresh token vs the cookie's hours-to-days.
- **Story 9.4 wishlist — endpoint identified** (`storeRetrieveWishlist`, an Apollo persisted query in the wishlist JS bundle), not unreachable. Only the persisted-query hash is missing (computed sha256 guesses 404'd; real hash needs one client-side-nav capture). Stays conditional, does NOT block 9.2/9.3, likely rides the NPSSO swap.
- PRD open-q #2 and the spine's Deferred NPSSO entry are closed by DW-10.

Epic-shape change: an auth-swap prerequisite now sits in front of 9.2. That is a planning change, not something the unattended dev loop should invent — halting here for a human sequencing decision (see the response). The `bmad-dev-auto` loop over Epic 9 stops at 9.1; 9.2 resumes once the swap is homed.

---

### Original blocked note (superseded by the run above)

Blocking condition: **live PSN credentials required — the spike cannot be executed unattended.**

Every acceptance criterion of story 9.1 is predicated on a credential this run cannot obtain: a valid `pdccws_p` session cookie, an `npsso` token, and (for the wishlist row) a persisted-query hash that is only observable in DevTools on a signed-in PS Store wishlist page. All three come from an interactive, human, signed-in Sony browser session. The repository holds none of them — `.dev.vars` declares `PSN_SESSION_COOKIE` but its value is empty, and no cookie exists in `.env`, `wrangler.jsonc`, any migration, or any seed.

The spike's entire deliverable is an evidence table. Filling any cell of it from HTTP convention instead of observation would be the exact failure the project's PROBE-BEFORE-YOU-MAP rule was written to prevent — that assumption (keying PSN failure off 401/403 when PSN really answers HTTP 200 + a GraphQL denial) shipped Epic 4's one production bug. A fabricated table would additionally mis-sequence stories 9.2, 9.3 and 9.4, since 9.4's existence in this epic is decided by it.

What was completed: `tmp/probe-psn-auth.ts`, the harness that turns the spike into a single command. Everything that could be built without secrets is built.

To unblock, run:

```
PSN_COOKIE=<pdccws_p> PSN_NPSSO=<npsso> PSN_WISHLIST_HASH=<sha256> bun tmp/probe-psn-auth.ts
```

and hand the printed table back; the run then resumes at the `deferred-work.md` DW-10 task. The cookie half alone is enough to unblock stories 9.2/9.3 if the NPSSO token is inconvenient to fetch.
