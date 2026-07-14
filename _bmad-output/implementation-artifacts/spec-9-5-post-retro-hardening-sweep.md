---
title: 'Post-retro hardening sweep — the Epic 9 merge gate'
type: 'chore'
created: '2026-07-14'
status: 'done'
baseline_revision: '2e16f73106b9339706a6bef2fab505320c816fc9'
review_loop_iteration: 0
followup_review_recommended: true # HIGH findings auto-forced it; the independent pass RAN in this story
context: []
warnings: [multiple-goals, oversized]
---

<intent-contract>

## Intent

**Problem:** Epic 9's reviews left six known defects in the ledger, and the epic is about to merge to main and run its first live trophy sync on production. Three are real production hazards (unlocked PSN long-ops that two tabs can double, a credential charset the outbound `Cookie:` header cannot carry, discarded games reported as unmatched noise on every trophy sync); three are latent traps in the test/tooling seams (a copy-pasted NPSSO exchange stub in four suites, a `Db.batch()` the seed driver does not implement, a pre-existing e2e flake).

**Approach:** Six independent, tightly-scoped fixes, no new surfaces. A single-flight lock (one per-user settings row, atomically claimed) wraps all three PSN long-ops at the route layer; the npsso guard gains a Latin1 bound at save; the trophy sync learns the discarded set and drops those titles silently; the four test suites share one exchange stub; the seed driver supplies a batch callback and is brought under `tsc`; the 6.4a e2e awaits its write like its already-fixed sibling does.

## Boundaries & Constraints

**Always:** The lock is per-user and covers library sync, trophy sync, and platinum backfill together — they all fan out to PSN under the same credential. A refusal is a 409 carrying a human message the UI shows verbatim. Acquisition is ATOMIC (one SQL statement — an upsert whose conflict branch only fires on an expired lock, checked by its `RETURNING` row), because a read-then-write acquire is exactly the race it is meant to close. The lock is TTL-bounded and always released on the way out (success or failure), so a crashed run cannot lock the user out permanently. Every new D1 call is counted into the subrequest arithmetic the backfill's `CHUNK_SIZE` doc block states (BUDGET rule).

**Block If:** the atomic-acquire idiom (upsert + `setWhere` + `returning`) does not behave as one statement on D1 — i.e. a test proving two concurrent acquires yield exactly one winner cannot be made to pass.

**Never:** No Durable Object, no KV, no new table, no new dependency — the `setting` table already is the per-user KV store. Do not change what the trophy sync writes (trophy columns only) or what the backfill fills (NULLs only). Do not relax the existing npsso guard. Do not "fix" the 6.4a flake by retrying, extending a timeout, or marking it flaky — it awaits the write.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Single-flight, second run | A library sync is running; a trophy sync is posted (same user) | 409 + "A PlayStation sync is already running…" — no PSN fetch, no write | Never racing, never a partial double-write |
| Single-flight, other user | User B posts a sync while user A's runs | Runs normally — the lock is user-scoped | — |
| Lock released | A sync finishes (or fails 401/502) | The lock row is gone; the next run acquires immediately | A crash mid-run: the TTL expires it |
| Backfill chunk loop | Chunk 1 acquires; chunks 2..n carry a cursor | Continuation chunks refresh the TTL and proceed; a SECOND tab starting at cursor-0 is refused | The loop's own chunks are never self-refused |
| npsso non-Latin1 | Paste containing `✓` / an emoji / any codepoint > U+00FF | 400 "invalid npsso value" at SAVE | Not a 502 at sync time |
| npsso valid | Ordinary base64url token | Saved, expired flag cleared (unchanged) | — |
| Trophy title = discarded game | PSN title normalizes to a game the user discarded | Matched and dropped SILENTLY — absent from `unmatched`, absent from `updated`, no write | — |
| Trophy title = no game at all | PSN title matches nothing | Still reported in `unmatched` (unchanged) | — |
| Seed driver batch | A repository fn calls `db.batch([...])` through the seed's proxy driver | Executes the statements and returns their results | A type error at COMPILE time if the driver stops satisfying `Db` |

</intent-contract>

## Code Map

- `src/repositories/settings.ts` -- add `acquireLock(db, userId, key, value, ttlMs)` → boolean and `releaseLock(db, userId, key, value)`. The atomic claim: `insert … onConflictDoUpdate({ set, setWhere: CAST(value AS INTEGER) < now }).returning()` — a returned row means we own it, none means someone else does. The `setting` table's `(user_id, key)` PK is what makes it atomic.
- `src/services/psn-lock.ts` -- **NEW.** `withPsnLock(db, userId, op, fn)` / the acquire + release + TTL-refresh helpers and `PSN_BUSY_MESSAGE`. Lock value = `${expiryEpochMs}:${op}` (SQLite's `CAST` reads the leading integer, so the SQL compare stays one column) — the op name rides along so the message can name what is running.
- `src/routes/sync.ts` -- wrap `/sync`, `/sync/trophies`, and `/backfill/platinum-dates` in the lock; 409 + message when busy. The backfill acquires only on the FIRST chunk (no cursor) and releases when `nextCursor` is null or the run fails; continuation chunks refresh.
- `src/routes/settings.ts` -- the npsso guard: add the Latin1 bound (`^[^Ā-￿]+$`) to the existing pipe — a codepoint above U+00FF cannot be encoded into the outbound `Cookie:` header at all.
- `src/services/trophies.ts` + `src/repositories/games.ts` -- a discarded-key lookup (`listDiscardedTitleKeys` — normalized titles of this user's discarded rows; `listLibraryForUser` correctly excludes them, so the trophy sync currently sees them as unmatched). A collapsed title whose key is in that set is dropped: not `updated`, not `unmatched`, no write.
- `test/integration/psn-stub.ts` -- **NEW.** The one NPSSO→bearer exchange double (authorize 302 → code, token → `test-bearer`), taking a per-suite handler for the PSN host and falling through to the real fetch otherwise. `sync.test.ts`, `discard.test.ts`, `trophies.test.ts`, `backfill.test.ts` all consume it and delete their copies.
- `scripts/seed-import.ts` -- `createHttpDb` passes drizzle-sqlite-proxy's **batch callback** (execute each statement against the D1 HTTP endpoint, return `{ rows }` per query).
- `tsconfig.node.json` -- add `scripts` to `include` so the seed driver is typechecked against `Db`: the AC's "must fail at COMPILE time" only holds if the file is in a project.
- `playwright/e2e/epic6.spec.ts` -- 6.4a "Claimed with PS+": await the owned toast before the D1 read, exactly as its "Purchased" sibling already does (that sibling was fixed; this one was not).
- `playwright/COVERAGE.md` -- rows for what has no drivable UI flow (the single-flight refusal needs two concurrent PSN runs; PSN is unstubbable in e2e).

## Tasks & Acceptance

**Execution:**
- [x] `test/integration/psn-stub.ts` (NEW) + `sync.test.ts` / `discard.test.ts` / `trophies.test.ts` / `backfill.test.ts` -- one shared exchange double, four copies deleted -- a stale exchange shape can no longer keep the suites green while production breaks.
- [x] `scripts/seed-import.ts` + `tsconfig.scripts.json` (NEW, referenced from `tsconfig.json`) -- batch callback on the proxy driver + the file brought under `tsc` -- a repository fn that batches and is reused by the seed path fails at compile time, never at runtime. (A new project, not `tsconfig.node.json`: the scripts import `src/`, so they need the Worker program's bundler resolution and Cloudflare types, which `nodenext` cannot give them.)
- [x] `src/repositories/settings.ts` + `src/services/psn-lock.ts` (NEW) + `src/routes/sync.ts` (+ `test/integration/psn-lock.test.ts`) -- the atomic single-flight lock over all three PSN long-ops; 409 + message; released on every exit path; TTL-bounded -- two tabs can no longer double the PSN fan-out or both report the same rows as written. Hazard test: two concurrent acquires, exactly one wins.
- [x] `web/shell/Fab.tsx` + `web/settings/SettingsPanel.tsx` (+ their tests) -- a 409 from any PSN op shows the server's message (not "try again later") -- FR-37: the user is told WHY, not just that it failed.
- [x] `src/routes/settings.ts` (+ `test/integration/settings.test.ts`) -- the Latin1 bound on the npsso guard -- refused at SAVE with a 400, never at sync time with a 502.
- [x] `src/repositories/games.ts` + `src/services/trophies.ts` (+ tests) -- discarded games matched and dropped silently -- a game the user threw away is not "unmatched" noise on every run.
- [x] `playwright/e2e/epic6.spec.ts` + `playwright/COVERAGE.md` -- 6.4a awaits the ownership write before querying D1; coverage rows for the non-drivable ACs -- the pre-existing flake is fixed, not carried into main.
- [x] `playwright.config.ts` + `playwright/e2e/epic2-tracking.spec.ts` + `playwright/e2e/epic4-settings.spec.ts` -- **the three-consecutive-green gate forced two more pre-existing races into the open, both fixed at the root** (see Design Notes): a cross-FILE data race (epic6's "I cancelled PS+" bulk-un-owns every membership row of the shared e2e user, wiping the claim epic4-settings seeded in a parallel worker → that test moved into epic6's serial group) and a swallowed click in the shared `openStatusMenu` helper (a click landing in a mid-commit DOM is dropped; the helper now re-clicks rather than waiting longer). Local workers capped at 4 — Playwright's default put TEN chromium workers on one vite+workerd+D1.

**Acceptance Criteria:**
- Given a PSN long-op is running for a user, when the same user starts any of the three (library sync, trophy sync, platinum backfill), then it is refused with a 409 and a human message, no PSN call is made, and the first run is unaffected — while another user's run is never blocked.
- Given a run that fails (401/502) or completes, when it exits, then the lock is released — a subsequent run acquires immediately, and a crashed run's lock expires by TTL rather than locking the user out forever.
- Given an npsso paste carrying any codepoint above U+00FF, when it is saved, then the response is a 400 and nothing is stored.
- Given a trophy title that matches a DISCARDED game, when the trophy sync runs, then it appears in neither `updated` nor `unmatched` and no trophy row is written for it.
- Given the seed script's proxy driver, when a repository function calls `db.batch()`, then it executes — and `bun run typecheck` fails if the driver ever stops satisfying `Db`.
- Given the full Playwright suite, when it runs three times consecutively, then 6.4a passes every time.

## Spec Change Log

## Review Triage Log

### 2026-07-14 — Review pass (Blind Hunter + Edge Case Hunter, then a forced independent follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 2, medium 4, low 3)
- defer: 2: (low 2)
- reject: 5
- addressed_findings:
  - `[high]` `[patch]` **The single-flight guard was bypassable with a query string.** Both reviewers landed on it independently: the backfill's continuation path treated `?cursor=` as proof that the caller owned the loop, and "renewal" was an unconditional write. But a cursor is a `game_id` the endpoint itself publishes in its response body (and in a failed chunk's `partial`) — so `POST /api/backfill/platinum-dates?cursor=anything` while a library sync was mid-flight would OVERWRITE the running sync's lock, fan out to PSN beside it, and then DELETE the lock on its way out, opening the door to a third op. The `if (!token) → 409` on that path was dead code. Fixed: the capability is now a rotating token the server mints and hands back (`lockToken`), checked against the stored row inside the claim statement itself; a forged, stale, or absent token is refused exactly like a fresh second run.
  - `[high]` `[patch]` **No test covered the continuation path at all** — which is why the above shipped into review. Two hazard tests added: a cursor (and a forged token) cannot steal a running sync's lock and makes zero PSN calls; a continuation presenting its OWN token renews and proceeds, and the spent token no longer works.
  - `[medium]` `[patch]` The Latin1 bound still admitted the **C1 control block** (U+0080–U+009F): those ARE Latin1-encodable, so the outbound `Cookie:` header would carry them happily. Replaced the blocklist with RFC 6265's `cookie-octet` ALLOWLIST, which drops every control, all non-ASCII, and `;` `,` `"` `\` in one expression — no `u`-flag surrogate reasoning left to get wrong.
  - `[medium]` `[patch]` A failing `releasePsnLock` inside the `finally` would have thrown away a SUCCESSFUL run's result (a 500 for work that already landed). It now logs and swallows; the TTL clears the row.
  - `[medium]` `[patch]` A discarded game whose stored title ends in " Trophies" would still have been reported as unmatched — the trophy side strips that suffix, so the two keyings differ. The discard set now carries both.
  - `[medium]` `[patch]` The seed script's doc block named `tsconfig.node.json` — the one config file it is deliberately NOT in. The single sentence justifying the whole 9.5e change pointed at the wrong file.
  - `[low]` `[patch]` `acquireLock` is a generic export whose `cast(value as integer)` expiry check silently reads "expired" for any ordinary setting value — the value format is load-bearing and nothing enforces it. Trap named in the doc block, with the single legitimate caller.
  - `[low]` `[patch]` The lock test's `afterEach` wrote a sentinel value instead of DELETING the row, so tests asserting absence were passing on ordering luck.
  - `[low]` `[patch]` The backfill's subrequest arithmetic said "claim + release = 2" on every chunk; it is 1 mid-loop and 2 on the chunk that ends it. Restated honestly (BUDGET rule).
  - `[low]` `[defer]` An abandoned backfill loop (tab closed, or the 40-chunk brake) holds the lock until the TTL — self-healing, and the busy message says so, but a release endpoint would close it. Ledgered.
  - `[low]` `[defer]` `listDiscardedTitleKeys` is a second full join per trophy sync where one query partitioned in JS would do. Ledgered.
  - `[rejected]` The TTL-without-a-fence preemption (a live-but-slow run can be taken over): real, but the worst case is the pre-9.5 doubled fan-out, not corruption — every write is idempotent/COALESCE. Named as a `ponytail:` ceiling in the code with its upgrade path, not fixed.
  - `[rejected]` "The atomicity test does not prove concurrency because D1 serializes in one isolate" — it does catch the defect it exists to catch (a read-then-write acquire interleaves across the awaits), and real cross-request concurrency is what the route-level tests drive.
  - `[rejected]` Moving `serverMessage` out of `web/shelf/api.ts` (where `callApi` lives): a module-location preference, no behaviour.
  - `[rejected]` `tsconfig.scripts.json` re-including `src` rather than project-referencing the worker config: both are `noEmit` with separate build info; `tsc -b` is clean and fast.
  - `[rejected]` The seed batch callback's non-atomicity: already named as a ceiling in its own `ponytail:` comment, and the AC asked for a compile-time guarantee, which it delivers.

### 2026-07-14 — Independent follow-up pass (forced: the review carried HIGH findings)

An independent reviewer tried to break the fixed lock: token forgery, replay after rotation, release-by-wrong-token, cursor-as-capability, poisoning the lock row through another settings route, and any PSN-reaching route outside the lock. **It could not** — and it confirmed the npsso `cookie-octet` allowlist accepts a real base64url NPSSO (and every documented paste shape) while rejecting every smuggling byte, C0 and C1 alike. What it did find was a leak and thin tests:

- patch: 5: (medium 2, low 3)
- addressed_findings:
  - `[medium]` `[patch]` **The chunk brake leaked a live lock, and the refusal then LIED.** When the client's 40-chunk brake trips, the loop stops without a final request — so the server, which releases only on the chunk that ends the loop, kept the lock. The summary says "run it again to continue"; doing so got "a PlayStation sync is already running", which was false, and library/trophy sync were refused too, for the whole TTL. The client now hands the lock back explicitly (`release=1` + its token) when it stops on purpose.
  - `[medium]` `[patch]` **The entire multi-chunk contract was unpinned.** The only backfill-lock test ran against a user with no trophy data, so `nextCursor` was always null, so `lockToken` was never once emitted in the whole suite: releasing on EVERY chunk, or a client that stopped carrying the token, would have passed green — reopening the exact hazard (a second tab between chunks). The 16-candidate chunk test now asserts chunk 1 hands back a token AND holds the lock across the gap (a concurrent `/api/sync` gets 409, PSN untouched), and that the terminating chunk clears the row.
  - `[low]` `[patch]` The "atomic claim" test fired three claims for three different ops and would have passed under a naive acquire too. Added the assertion with teeth: two CONCURRENT `POST /api/sync` → `[200, 409]` and PSN called exactly ONCE.
  - `[low]` `[patch]` The no-timezone refusal (9.3) happens AFTER the lock is claimed — if its release regressed, one click would lock the user out of all three ops. Now pinned, plus a release-by-wrong-token row.
  - `[low]` `[patch]` The `ponytail:` ceiling justified TTL preemption with "a sync is one request" — it is a paged loop. Premise corrected; the ceiling itself stands (worst case is a doubled fan-out, not corruption).
  - `[note]` The lock also forced a REAL e2e change: the suite has one user, so epic9's backfill click and epic4's FAB sync now refuse each other across parallel workers — the app behaving correctly. Every PSN-op flow moved into the one serial file that owns PSN state.

## Design Notes

**Why the lock is one SQL statement.** A read-then-write acquire (`getSetting` → if free → `setSetting`) has the exact TOCTOU race the story is closing: two tabs both read "free", both write, both sync. SQLite's upsert with a conditional update branch is atomic, and `RETURNING` tells us which caller won:

```ts
const [row] = await db.insert(setting)
  .values({ userId, key, value: `${now + ttlMs}:${op}` })
  .onConflictDoUpdate({
    target: [setting.userId, setting.key],
    set: { value: `${now + ttlMs}:${op}` },
    setWhere: sql`CAST(${setting.value} AS INTEGER) < ${now}`, // held & unexpired → no update, no row
  })
  .returning({ value: setting.value });
return Boolean(row); // acquired
```

**Subrequest arithmetic (BUDGET rule).** The lock adds 2 D1 binding calls to a run (acquire + release; a backfill continuation chunk refreshes instead of acquiring — still 1). The backfill chunk's stated worst case was ~38 of 50; it becomes ~40. Restate it in the `CHUNK_SIZE` doc block rather than leaving the old number.

**What the "three consecutive green runs" gate actually caught.** The 6.4a fix (await the write) was the easy half. Holding the WHOLE suite green three times running exposed two more races that had been passing as "machine contention" since Epic 1 (DW-9): (1) epic6's `I cancelled PS+` un-owns EVERY `owned_via='membership'` row of the single shared e2e user — epic6 is serial for exactly that reason, but serial mode does not cross FILES, and epic4-settings seeded a membership row in a parallel worker, so the cancel wiped it mid-assert (~2 in 5 runs); that test now lives in epic6's serial group. (2) `openStatusMenu`'s pill click could land in a mid-commit DOM and be silently dropped — no amount of waiting delivers an event that was already discarded, so the helper re-clicks (`expect(...).toPass()`). With both fixed and local workers capped at 4, the suite ran 88/88 three times consecutively.

**The backfill's cursor IS its lock token.** Only the tab that started the loop holds a cursor, so continuation chunks are trusted to refresh the TTL without a separate owner check. A second tab necessarily starts at cursor-0 and is refused. Worst case (the user closes the tab mid-loop) the lock expires by TTL.

## Verification

**Commands:**
- `bun run lint` + `bun run typecheck` -- clean (typecheck now covers `scripts/`).
- `bun run test` -- green, including the two-concurrent-acquires hazard test, the non-Latin1 npsso 400, and the discarded-title drop.
- `bun run test:e2e` -- green, run THREE times consecutively: 6.4a must pass in all three (the AC).

## Auto Run Result

Status: done (2026-07-14)

**Change.** The six ledger fixes Epic 9's retro homed here, plus what holding the suite green forced out of hiding.

1. **Single-flight across all three PSN long-ops.** One per-user lock (a `setting` row, value `<expiry-ms>:<op>:<uuid>`) covers the library sync, the trophy sync and the platinum backfill — they fan out to PSN under the same credential and write the same rows. A second run is refused with a 409 and a message the UI shows verbatim, and makes zero PSN calls. The claim is ONE SQL statement (an upsert whose DO UPDATE branch fires only on an expired lock — or on the exact token the caller already holds, which is how the backfill's chunked loop keeps the lock across requests — with `RETURNING` naming the winner), because a read-then-write acquire is precisely the race being closed. TTL-bounded at two minutes so a dead Worker cannot lock the user out; released on every exit path including failure, and handed back explicitly when the client stops on purpose.
2. **The npsso guard** is now RFC 6265's `cookie-octet` allowlist: a value the outbound `Cookie:` header cannot carry is refused at SAVE with a 400, never at sync time with a 502.
3. **Discarded games** are matched and dropped silently by the trophy sync — they are not "unmatched" noise on every run; the user threw them away.
4. **One shared NPSSO exchange double** backs four suites (not the two the AC named), so a stale exchange shape can no longer keep tests green while production breaks.
5. **The seed driver supplies drizzle's batch callback**, and `scripts/` is now a `tsc` project — the `Db.batch()` promise is checked at COMPILE time.
6. **The 6.4a flake** awaits the ownership write before reading D1.

**What the "three consecutive green runs" bar actually bought.** It was the expensive AC and the valuable one. Meeting it exposed three more real races, all pre-existing or newly-created-and-real, none of them 6.4a: epic6's "I cancelled PS+" bulk-un-owns every membership row of the single shared e2e user and was wiping a claim epic4-settings seeded in a parallel worker (serial mode does not cross files); `openStatusMenu`'s pill click could land in a mid-commit DOM and be silently dropped (no amount of waiting delivers an event already discarded — the helper re-clicks); and the new lock itself, being per-user, made epic9's backfill click and epic4's FAB sync refuse each other across workers — the app behaving correctly, the tests pretending to be different people. Every PSN-op flow now lives in the one serial file that owns PSN state. Local Playwright workers are capped at 4: the default put ten chromium workers on one vite + workerd + D1.

**Review found the lock bypassable, and the tests were why.** The first cut treated the backfill's CURSOR as proof that the caller owned the loop — but a cursor is a `game_id` the endpoint publishes in its own response body, so `?cursor=anything` would have overwritten a running sync's lock, fanned out to PSN beside it, then deleted the lock on the way out. No test covered the continuation path at all. The capability is now a rotating token; forgery, replay-after-rotation and release-by-wrong-token are each pinned, as is the multi-chunk hold (a concurrent sync between chunks gets 409) and the concurrent-request race itself (two simultaneous `POST /api/sync` → one 200, one 409, PSN called ONCE).

**Files changed.** New: `src/services/psn-lock.ts`, `test/integration/psn-lock.test.ts`, `test/integration/psn-stub.ts`, `tsconfig.scripts.json`. Changed: `src/repositories/{settings,games}.ts` (atomic claim/release; the discarded-title lookup), `src/routes/{sync,settings}.ts` (the lock on all three routes + the release path; the cookie-octet guard), `src/services/{trophies,backfill}.ts`, `scripts/seed-import.ts`, `tsconfig.json`, `web/settings/{api.ts,SettingsPanel.tsx}`, `web/shell/Fab.tsx`, `web/shelf/api.ts` (`serverMessage`), four integration suites onto the shared double, `playwright.config.ts`, three Playwright specs, `playwright/COVERAGE.md`.

**Review findings.** First pass (Blind Hunter + Edge Case Hunter): 9 patched (2 high, 4 medium, 3 low), 2 deferred, 5 rejected. Forced independent follow-up (the HIGHs auto-force it, and it cannot be declined): 5 more patched (2 medium, 3 low) — it could not break the fixed lock. No intent gaps, no spec loopbacks.

**Verification.** `bun run lint` and `bun run typecheck` clean (typecheck now covers `scripts/`); `bun run test` — 2063 passed; `bun run test:e2e` — 88 passed, THREE consecutive runs, after the fixes above.

**Residual risks.** The TTL is preemption without a fence: a run still alive after two minutes (PSN throttling hard) can have its lock taken over, and neither run notices — worst case is the pre-9.5 doubled fan-out, not corruption, since every write is idempotent/COALESCE. Named in the code with its upgrade path. Two items ledgered: an abandoned loop (tab closed mid-run, as opposed to the brake, which now releases) still waits out the TTL, and `listDiscardedTitleKeys` is a second D1 join per trophy sync where one partitioned query would do.
