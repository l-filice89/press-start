---
title: 'Central 401 re-auth redirect'
type: 'bugfix'
created: '2026-07-09'
status: 'done'
baseline_revision: '2dc8ce0f3ba410fd4cf6f1a58e0b590397c2f2c8'
final_revision: 'aa3bbba4b52a308879fc23bfdcd8a2860e79b2d2'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** When a better-auth session expires, any authed query (today `/api/shelf` and `/api/shelf/search`) returns 401, `web/shelf/api.ts` throws, and `Shelf.tsx` renders the generic "Your shelf couldn't load. Refresh to try again." message. Refreshing cannot re-authenticate, so the user is stranded on a dead surface instead of being routed to sign-in.

**Approach:** Handle 401 once, centrally, in the TanStack Query layer: a global `QueryCache` `onError` recognises the status already attached to the thrown error and refetches the better-auth session. The expired cookie resolves the session to `null`, so the existing session gate in `web/App.tsx` re-renders `<Login />`. Non-401 failures are untouched and still show the shelf's generic message.

## Boundaries & Constraints

**Always:**
- Wire the 401 handling exactly once, at the query-client level — never per component or per query.
- Drive re-auth through the better-auth client (`web/auth-client.ts`) so `authClient.useSession()` in `App.tsx` is the single source of truth for the gate. No manual routing, no `window.location` navigation.
- Preserve the existing retry policy: 4xx never retries, transient errors retry up to 3 times.
- Keep the shelf's generic error message for every non-401 failure.
- Cover the hazard named here with a test that asserts a 401 response drives the app to the Login surface (red-then-green), and a companion test that a non-401 error does *not*.

**Block If:** better-auth 1.6.23 exposes no supported way to invalidate/refetch the session atom from outside a React component.

**Never:**
- Do not add a router, a new dependency, or an auth context/provider.
- Do not change the Worker-side auth or the `/api/shelf` handlers.
- Do not attempt a silent token refresh or a retry of the 401'd query.
- Do not touch `_bmad-output/implementation-artifacts/deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Authed read | Session valid, `/api/shelf` → 200 | Shelf grid renders; session untouched | No error expected |
| Expired session | Session was valid, `/api/shelf` → 401 | Session refetched, resolves `null`, `<Login />` renders | 401 not retried; no generic shelf error left on screen |
| Server failure | `/api/shelf` → 500 | Generic "Your shelf couldn't load." message; user stays signed in | Retries per policy, no session refetch |
| Network failure | `fetch` rejects (no status) | Generic shelf error; user stays signed in | Retries per policy, no session refetch |

</intent-contract>

## Code Map

- `web/main.tsx` -- currently constructs the `QueryClient` inline; will import the factory instead.
- `web/query-client.ts` -- NEW: exported `createQueryClient()` with the retry policy plus the global `QueryCache.onError` 401 hook. Extracted so it is testable without rendering `main.tsx` (which registers a service worker).
- `web/auth-client.ts` -- the better-auth React client; `authClient.$store.notify('$sessionSignal')` triggers the session atom's `fetchSession`, which sets `data: null` on a 401 from `/api/auth/get-session`.
- `web/App.tsx` -- existing session gate (`authClient.useSession()` → `<Login />` when `!session`). Unchanged.
- `web/shelf/api.ts` -- already attaches `error.status` on a non-OK response. Unchanged.
- `web/shelf/Shelf.tsx` -- generic error branch. Unchanged.
- `web/shelf/Shelf.test.tsx` -- existing pattern for stubbing `fetch` in the jsdom `web` vitest project.

## Tasks & Acceptance

**Execution:**
- [x] `web/query-client.ts` -- create `createQueryClient()` holding the existing retry predicate and a `QueryCache` `onError` that, when `error.status === 401`, calls `authClient.$store.notify('$sessionSignal')` -- one central re-auth trigger, no per-component handling.
- [x] `web/main.tsx` -- replace the inline `new QueryClient({...})` with `createQueryClient()` -- keeps the app entry thin and the behaviour under test.
- [x] `web/query-client.test.tsx` -- render `<App />` under `createQueryClient()` with a stubbed `fetch`; assert the 401 → Login transition (and that the 401 was not retried), and that a non-401 error leaves the user on the shelf error.

**Acceptance Criteria:**
- Given a signed-in user whose session cookie has expired, when the shelf query returns 401, then the app renders the Login surface (the magic-link email field) without a page reload.
- Given a signed-in user, when the shelf query fails with a non-401 error, then the generic shelf error remains and the Login surface is not rendered. (Tested with 403: a 5xx exercises the same `onError` branch but costs ~7s of retry backoff.)
- Given any query error, when the status is 4xx, then no retry is issued.

## Spec Change Log

## Design Notes

`authClient.$store.notify('$sessionSignal')` is better-auth's supported cross-component session-invalidation signal: `session-refresh.mjs` subscribes the mounted session atom to that signal and calls `fetchSession()`; `session-atom.mjs` sets `data: null` when `/api/auth/get-session` answers 401. The mounted `useSession()` in `App.tsx` therefore re-renders with `session === null` and the existing gate shows `<Login />`. No new state, no router.

```ts
queryCache: new QueryCache({
  onError: (error) => {
    if ((error as { status?: number }).status === 401) {
      authClient.$store.notify('$sessionSignal');
    }
  },
}),
```

## Review Triage Log

### 2026-07-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 1: (high 0, medium 0, low 1)
- reject: 14
- addressed_findings:
  - `[medium]` `[patch]` The non-401 test asserted only the UI (alert shown, no Login field), never the spec's actual invariant that a non-401 error triggers no session refetch. Rewrote it to hold the shelf request open, snapshot the `/api/auth/get-session` call count once the signed-in shell renders, answer 403, and assert the count is unchanged. Verified red-then-green: relaxing `onError` to fire on any status makes it fail with `expected 2 to be 1`.
  - `[low]` `[patch]` `(error as { status?: number }).status` was cast twice with no runtime guard, so a query rejecting with `null` would throw inside the cache handler. Extracted one `statusOf(error)` helper that checks the value is a non-null object; both the retry predicate and `onError` now route through it.
  - `[low]` `[patch]` The doc comment claimed the hooks fire "for every authed query", which oversells them: `QueryCache.onError` fires for every query (authed or not) and only acts on errors carrying an HTTP `status` — today just `fetchGames`. Mutations are not covered at all. Reworded to state the real surface and name the mutation gap.

## Verification

**Commands:**
- `bun run test` -- expected: all vitest projects pass, including the new `web/query-client.test.tsx`.
- `bun run typecheck` -- expected: clean.
- `bun run lint` -- expected: clean.

## Auto Run Result

Status: done

**Change:** A 401 from any authed query now routes an expired session to sign-in instead of the shelf's generic load error. The query client gained a global `QueryCache.onError` that, on `error.status === 401`, fires better-auth's `$sessionSignal`; the session atom re-fetches, resolves `null`, and `App.tsx`'s existing gate renders `<Login />`. Non-401 errors are untouched.

**Files changed:**
- `web/query-client.ts` (new) — `createQueryClient()`: the existing 4xx-no-retry policy plus the central 401 re-auth hook.
- `web/main.tsx` — uses the factory instead of an inline `QueryClient`.
- `web/query-client.test.tsx` (new) — 401 → Login (asserted red-then-green, and the 401 is not retried); a non-401 error leaves the user signed in on the generic shelf error.

**Review findings across both passes:** 0 intent_gap, 0 bad_spec, 3 patch, 1 defer, 16 reject (see triage log). The follow-up pass applied a `statusOf()` guard, corrected the doc comment's overclaim, and strengthened the non-401 test to assert the no-session-refetch invariant rather than only the UI.

**Verification:** `bun run test` (275 tests, 26 files, all pass), `bun run typecheck` clean, `bun run lint` clean. Both hazard tests verified red-then-green: disabling the 401 branch fails the Login assertion; widening it to fire on any status fails the new non-401 session-call assertion (`expected 2 to be 1`).

**Residual risks:** Mutations are not covered (`MutationCache` has no 401 hook) because the app has none yet; the first mutation-bearing story should route through the same handler. `authClient.$store.notify('$sessionSignal')` is a better-auth internal, not a documented API — a version bump could silently no-op it, though the 401 test exercises the real `authClient` and would fail if it broke. The test stubs `globalThis.fetch` before importing `./auth-client` because better-auth captures it as `customFetchImpl` at import time — that coupling is likewise version-sensitive.
