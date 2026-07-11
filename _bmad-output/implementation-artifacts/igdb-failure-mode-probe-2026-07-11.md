# IGDB failure-mode probe (2026-07-11)

Live probe of the IGDB v4 `POST /v4/games` endpoint (Twitch-authenticated) to
capture **real** failure payloads before the Epic 6 add-by-name / straggler
IGDB paths merge — Epic 4 retro action item, discharging PROBE-BEFORE-YOU-MAP
and the Epic 5 retro DEGENERATE-RESPONSE GUARD rule. Payloads here are verbatim
from the live API, not modelled from docs.

## Captured payloads (verbatim)

| Mode | Trigger | Status | Body (real) | Body type |
|------|---------|--------|-------------|-----------|
| Success | `search "Hades"; …` | `200` | `[{ id, name, first_release_date, cover.image_id, genres[].name }, …]` | **array** |
| No match | `search "zzqxwv nonexistent 99871"; …` | `200` | `[]` | array (empty) |
| Malformed query | `search "Hades" fields id name;` (missing `;`) | `400` | `[{"title":"Syntax Error","status":400}]` | **array** |
| Bad/expired token | valid query, `Bearer deadbeef…` | `401` | `{"message":"Authorization Failure. Have you tried:","Tip 1":…,"Docs":…}` | **object** |
| Rate limit | 80 requests, 50-way parallel (7–15% tripped) | `429` | `{"message":"Too Many Requests"}` | object |
| (Count endpoint, NOT used at runtime) | `POST /v4/games/count` | `200` | `{"count":31}` | object |

**Headroom notes**
- **429 carries NO `Retry-After` header** (confirmed) — a caller cannot learn the
  backoff window from the response; it must back off blindly or surface a retry
  prompt. Did not reproduce below ~40-way parallelism; the provider's 260 ms
  throttle (~3.8 req/s) keeps a single-user app well clear.
- IGDB uses **honest HTTP status codes** — success is `200`+array, every error is
  a `4xx`. This is the opposite of PSN (Epic 4: `200` + a GraphQL denial body),
  so **status-code-driven branching is verified-valid for IGDB**. The wire
  contract the seed adapter assumed by convention holds against reality here.

## Handling verdict (per branch)

Current error handling in both providers (main-tree seed `src/providers/igdb.ts`
and the Epic 6 worktree add-by-name `IgdbSearch`) is **fail-closed and correct**
for the observed modes:

- `401/403` → explicit throw with an "access token likely expired, refresh
  IGDB_ACCESS_TOKEN" message. ✅ (matches the real 401 object body)
- `400` / `429` / `5xx` → generic `IGDB request failed: <status> <text>` throw.
  ✅ fail-closed; no silent corruption. (`429` is not *distinguished* as
  retryable — acceptable for a user-triggered add; see below.)
- Empty `200 []` → `enrich`→null, `searchCandidate`→null, `searchCandidates`→[].
  ✅ This is the **expected name-only fallback** (Story 6.2), NOT a data-loss
  hazard: add-by-name writes only user-confirmed preview data, never an
  automated write off the raw IGDB response — so an empty result is a legitimate
  "no match", not degenerate emptiness clearing state (contrast the PS+ Extra
  empty-catalog flag-wipe).

### One gap found + fixed (main tree, this session)

Both providers did `(await response.json()) as IgdbGame[]` then `games.map(…)`
with **no array check**. Every real `200` is an array (confirmed), but an
API/proxy change or a mis-pointed endpoint handing back a non-array `200` (the
`/count` shape `{"count":N}` is a real example) would throw a raw `TypeError` in
`.map` → an unhandled **500**, not a clean provider error.

Applied to `src/providers/igdb.ts` (seed path, on this branch):

```ts
const parsed = await response.json();
if (!Array.isArray(parsed)) {
  throw new Error(`IGDB returned a 200 with a non-array body: …`);
}
const games = parsed as IgdbGame[];
```

Guarded by `src/providers/igdb.test.ts` (the DEGENERATE GUARD case + 401/400/empty
rows, fixtured from the payloads above).

## Auth model — client-credentials (v1.0.0, no manual token rotation)

`IgdbConfig` moved from a static `accessToken` (60-day Twitch token, manual
refresh) to `clientId` + **`clientSecret`** (both permanent). The provider mints
the short-lived app token from id+secret via
`POST https://id.twitch.tv/oauth2/token?…&grant_type=client_credentials`, caches
it **module-level keyed by client id** (per-isolate; the route builds the
provider per request, so a closure cache would never survive), and **self-heals a
401/403 by minting a fresh token and retrying once** — a second 401 is a genuine
bad-credential error. Landed on the seed path this branch
(`src/providers/igdb.ts` + `src/providers/igdb.test.ts`). Env: `IGDB_ACCESS_TOKEN`
→ `IGDB_CLIENT_SECRET` (`.env`, `.env.example`, `scripts/seed-import.ts`).

## Epic 6 worktree merge checklist

Adopt the same auth model + guard in the worktree add-by-name path:

- [ ] **Code:** worktree `IgdbConfig` uses `clientSecret` not `accessToken`;
      `igdbFromEnv` (`src/routes/games.ts:20`) reads `env.IGDB_CLIENT_ID` +
      `env.IGDB_CLIENT_SECRET` (not `IGDB_ACCESS_TOKEN`); the shared `searchGames`
      mints/caches/self-heals via the module-level token cache. Drop the stale
      "static access token, no Twitch refresh" ponytail note.
- [ ] **Config wiring** (mirrors how BETTER_AUTH_SECRET / PSN are already wired):
      - `IGDB_CLIENT_ID` → non-secret → `wrangler.jsonc` `vars` (+ the `env.e2e`
        `vars` mirror). Twitch client ids are public (sent in every header).
      - `IGDB_CLIENT_SECRET` → secret → add one line to `.github/workflows/deploy.yml`
        "Sync … secrets to the Worker" step:
        `echo "${{ secrets.IGDB_CLIENT_SECRET }}" | bunx wrangler secret put IGDB_CLIENT_SECRET`
        (GitHub Actions secret already added by Luca 2026-07-11). Also add it to
        `.dev.vars` for local Worker add-by-name; leave it out of `.dev.vars.e2e`
        so e2e degrades to name-only (no live IGDB in CI).
      - Extend the deploy smoke-test (or a COVERAGE note) so a missing IGDB secret
        degrades add-by-name to name-only rather than 500ing.
- [ ] Port the DEGENERATE-RESPONSE guard into the shared `searchGames(title)`
      helper — the single fetch site feeds `enrich`, `searchCandidate`, and
      `searchCandidates`. Array-guard the `200` body + a hazard test using the
      captured `/count` object payload.
- [ ] The add-by-name route degrades on an IGDB throw (401/400/429/timeout) to
      the name-only path (NFR-4), not a 500 — assert with the captured 401/429
      object bodies as fixtures.
- [ ] Empty `200 []` drives the name-only fallback preview, not an error toast.
- [ ] `searchCandidate` already null-guards a hit missing `id`/`name`
      (worktree igdb.ts:168) — keep; add a fixture row for a `200` array whose
      top hit lacks `id`.

## Reproduce

Credentials live in `.env` (`IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` — both
permanent). To probe by hand, first mint a token
(`curl -X POST "https://id.twitch.tv/oauth2/token?client_id=$IGDB_CLIENT_ID&client_secret=$IGDB_CLIENT_SECRET&grant_type=client_credentials"`),
then `POST https://api.igdb.com/v4/games` with `Client-ID` + `Bearer <token>`
headers and an apicalypse body (`search "<t>"; fields …; limit N;`). The app
does this mint step itself now — the manual token no longer lives in `.env`.
