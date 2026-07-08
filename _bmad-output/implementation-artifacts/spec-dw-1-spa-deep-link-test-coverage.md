---
title: 'SPA deep-link fallback regression coverage (DW-1)'
type: 'chore'
created: '2026-07-08'
status: 'done'
baseline_revision: '16e7bb079684ad209df05047ba19fcd27844ec93'
final_revision: 'e14b1ca5e1acc4185a0fe4e0834b93ccdd4d1018'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** The Worker's `app.all('*')` ASSETS fallback (`worker/index.ts:27`) — which serves the SPA `index.html` for any deep client route that isn't `/api/*` — has no automated test. The "SPA deep link" I/O scenario is verified only by hand, because `env.ASSETS` is undefined in the `vitest-pool-workers` env (`c.env.ASSETS.fetch` throws `TypeError: Cannot read properties of undefined`), and wiring a real assets directory into `wrangler.jsonc` risks disturbing the `@cloudflare/vite-plugin` production build.

**Approach:** Add a `vitest-pool-workers` integration test that provides a test-only stub `ASSETS` binding by spreading `cloudflare:test`'s `env` and overriding `ASSETS` with a spy. This gives the Worker a working `ASSETS.fetch` in-test without touching `wrangler.jsonc` or the build. Assert a non-`/api/*` deep route falls through to the stub (SPA fallback), while `/api/*` resolves to JSON and never reaches the stub.

## Boundaries & Constraints

**Always:** Provide the `ASSETS` binding at test call-time only (spread `env`, override `ASSETS`); assert the fallback is reached for a deep client route AND that `/api/*` requests never reach the `ASSETS` stub (API-before-fallback invariant).

**Block If:** Wiring the stub still throws `undefined ASSETS` at the Worker, or the only faithful fix requires editing `wrangler.jsonc`/`vite.config.ts` production assets config.

**Never:** Edit `wrangler.jsonc`, `vite.config.ts`, or `@cloudflare/vite-plugin` assets config. Do not add a real assets directory. Do not edit `worker/index.ts` behavior. Do not edit the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| SPA deep link | `GET /shelf/some/deep/route` (non-asset, non-api), stub `ASSETS` returns `index.html` | Response is the ASSETS stub result (SPA shell); stub called exactly once with the request | No error expected |
| API before fallback (matched) | `GET /api/health` | 200 JSON `{ status: 'ok' }`; ASSETS stub NOT called | No error expected |
| API before fallback (unmatched) | `GET /api/does-not-exist` | 404 JSON error; ASSETS stub NOT called | 404 handled by `app.all('/api/*')`, never SPA shell |

</intent-contract>

## Code Map

- `worker/index.ts` -- system under test: `/api` route, `/api/*` 404 catch-all, `app.all('*')` ASSETS fallback (line 27).
- `test/integration/health.test.ts` -- existing harness pattern (`cloudflare:test` env, `createExecutionContext`, `worker.fetch`); reuse it.
- `vitest.config.ts` -- `workers` project globs `test/integration/**/*.test.ts`; new file auto-included, no config change.

## Tasks & Acceptance

**Execution:**
- [x] `test/integration/spa-fallback.test.ts` -- new `vitest-pool-workers` test. Build a spy `ASSETS` binding (records call count + last URL, returns an `index.html` marker `Response`). For each I/O Matrix row, call `worker.fetch(request, { ...env, ASSETS: spy }, ctx)` and assert the row's outcome, including the ASSETS stub call-count invariant.

**Acceptance Criteria:**
- Given the `workers` vitest project, when the suite runs, then `test/integration/spa-fallback.test.ts` executes with a working stub `ASSETS` binding and does not throw `Cannot read properties of undefined`.
- Given a non-`/api/*` deep client route, when fetched, then the Worker returns the `ASSETS` stub's `index.html` response and the stub was invoked exactly once.
- Given any `/api/*` request (matched or unmatched), when fetched, then it resolves to JSON and the `ASSETS` stub is never invoked.

## Review Triage Log

### 2026-07-08 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - none

Reject (all low): Blind Hunter's two HIGH-labelled findings ("stub doesn't exercise `wrangler.jsonc` `not_found_handling`" and "not real workerd for the ASSETS path") re-litigate the spec's documented scope decision — the SUT is the Worker's routing decision (`app.all('*')` → `ASSETS.fetch`), not Cloudflare's asset server, with `not_found_handling` an explicit accepted residual risk covered by manual/live checks (per DW-1 and Design Notes). Blind Hunter's HIGH "implicit-any params" is false against the committed artifact (types present, `bun run typecheck` exit 0). "Duplicates health.test.ts" — not pure duplication: the `assets.calls === 0` API-before-fallback invariant is novel and load-bearing (health.test asserts no such thing). Remaining findings (env-spread fragility, bare `/`, bare `/api` boundary, non-GET, query-string, forwarding fidelity, exact-URL brittleness, `vi.fn` vs hand-rolled spy, comment overclaim) are gold-plating beyond the spec's I/O matrix or by-design per the spec's Approach — same class the prior pass rejected. Hazard-rule re-check passed: reordering `app.all('*')` ahead of `/api/*` (or dropping the `/api/*` 404 catch-all) turns the `assets.calls` / JSON assertions red.

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - none

Reject (low, dropped): (1) no test for root path `/` and non-GET methods on the deep-route fallback — same `app.all('*')` code path as the covered deep route; gold-plating beyond the spec's I/O matrix. (2) request-forwarding fidelity beyond URL — already asserted via `assets.lastUrl`. Hazard-rule check passed: reordering `app.all('*')` ahead of `/api/*`, or removing the `/api/*` 404 catch-all, turns the `assets.calls`/JSON assertions red.

## Design Notes

Stub over real assets: the untested unit is the Worker's routing decision (`app.all('*')` → `ASSETS.fetch`), not Cloudflare's asset server. A spy `ASSETS` exercises exactly that decision and lets us assert the API-before-fallback hazard directly (stub call count 0 for `/api/*`). Example shape:

```ts
let assetsCalls = 0;
const ASSETS = { fetch: async (req: Request) => { assetsCalls++; return new Response('<!doctype html><title>SPA shell</title>', { headers: { 'content-type': 'text/html' } }); } };
const res = await worker.fetch(new Request('http://x/shelf/deep'), { ...env, ASSETS }, ctx);
```

## Verification

**Commands:**
- `bun run test` -- expected: all projects pass, including new `spa-fallback` tests in the `workers` project.
- `bun run typecheck` -- expected: no type errors.
- `bun run lint` -- expected: clean.

## Auto Run Result

Status: done

**Summary:** Added `test/integration/spa-fallback.test.ts` — regression coverage for the "SPA deep link" I/O scenario (DW-1). It hands the Worker a test-only stub `ASSETS` binding (`{ ...env, ASSETS: spy }`) at call time, so `worker/index.ts`'s `app.all('*')` fallback is exercisable in `vitest-pool-workers` without a real assets directory. No production config touched.

**Files changed:**
- `test/integration/spa-fallback.test.ts` -- new; 3 tests: deep route → ASSETS SPA shell (stub called once, original URL forwarded); `/api/health` → 200 JSON, stub not called; `/api/does-not-exist` → 404 JSON, stub not called.

**Review findings:** Two passes, both zero-change. Pass 1: 0 intent_gap, 0 bad_spec, 0 patch, 0 defer, 2 reject. Follow-up pass: 0 intent_gap, 0 bad_spec, 0 patch, 0 defer, 11 reject (all low — Blind Hunter HIGH labels re-litigate the spec's documented stub-vs-real-assets scope decision or are false vs the committed artifact; remainder gold-plating beyond the I/O matrix). No loopbacks.

**Hazard coverage (HAZARD-TEST RULE):** The "API routes checked before SPA fallback" invariant is asserted directly via `assets.calls === 0` on both `/api/*` cases plus the JSON-shape assertions; reordering the fallback ahead of `/api/*` or dropping the `/api/*` 404 catch-all turns the test red.

**Verification:**
- `bun run test` -- 25 files, 267 tests passed (3 new).
- `bun run typecheck` -- clean (exit 0).
- `bun run lint` -- clean (biome, 108 files).

**Residual risk:** The stub does not exercise Cloudflare's real `not_found_handling: "single-page-application"` asset server — that layer stays covered by manual/live checks (per DW-1), not by this Worker-routing regression test.
