# Tech-Verification Review — ARCHITECTURE-SPINE (PRESS START / PS Game Catalog)

- **Reviewer role:** Adversarial tech-fact verifier (web-researched, not asserted from training data)
- **Date:** 2026-07-05
- **Target:** `../ARCHITECTURE-SPINE.md`
- **Method:** Live web search + direct doc/npm-registry fetches for every named technology in the Stack table and the ADs.
- **Verdict:** **PASS-WITH-FIXES** — the stack is overwhelmingly current and correctly scoped. Two concrete factual corrections and one imprecision to fix; none is architecture-breaking.

---

## Summary table

| # | Claim in spine | Verdict | Corrected fact / note |
| --- | --- | --- | --- |
| 1 | Workers free tier: 10ms CPU excluding I/O | CONFIRMED | Correct verbatim. |
| 2 | "50 subrequests/invocation" (AD-15) | IMPRECISE | Free plan = **50 external** subrequests **+ 1,000** to Cloudflare services. The "50" is right for external fan-out only. |
| 3 | AD-1: "D1 … reached via binding (**not a subrequest**)" | WRONG | D1 binding calls **do** count as subrequests (Cloudflare-services bucket). Low operational impact. |
| 4 | Cloudflare D1 free limits | CONFIRMED | 5M rows read/day, 100K rows written/day, 5 GB total storage. Ample for ~344 games, single user. |
| 5 | Cron Triggers on free plan (monthly PS+ Extra) | CONFIRMED | Available at no extra cost; up to **3** cron triggers per Worker on free. |
| 6 | Drizzle ORM **0.44.x** + drizzle-kit | OUT OF DATE | Current stable is **0.45.2** (npm `latest`, 2026-03-27). 1.0 is in RC (`1.0.0-rc.4`, 2026-06-27), not stable. Bump the pin to 0.45.x. |
| 7 | Hono (+ typed RPC client) on Workers | CONFIRMED | Current v4.12.x (Apr 2026); `hono/client` typed RPC is real and works on Workers/Static Assets. |
| 8 | `@cloudflare/vitest-pool-workers` + D1 | CONFIRMED | Current ~0.16.18 (Jul 2026); D1 migration/testing helpers present. |
| 9 | Biome v2 (lint + format) | CONFIRMED | v2.x current; 2026 line is v2.4. Fits role. |
| 10 | better-auth (magic link, FR-47) | CONFIRMED | Plugin current (docs Apr 2026); `expiresIn` default 300s; Drizzle/D1 adapter compatible. |
| 11 | IGDB via Twitch OAuth2 client-credentials | CONFIRMED | `POST id.twitch.tv/oauth2/token` `grant_type=client_credentials`; `api.igdb.com/v4`; rate limit 4 req/s. |
| 12 | psn-api / NPSSO flow (deferred swap) | CONFIRMED (with caveat) | NPSSO→access-code→tokens flow accurate (psn-api 2.17.0). But v1's `getPurchasedGameList` is **not** part of psn-api — it is a raw GraphQL op behind the `pdccws_p` cookie. Correctly isolated by AD-5, but note it is unofficial/fragile. |

---

## Detailed findings

### FINDING 1 — [MEDIUM] Drizzle pin "0.44.x" is one minor behind current stable
**Spine:** Stack table — "ORM / migrations: Drizzle ORM 0.44.x + drizzle-kit."
**Fact:** The npm `latest` dist-tag for `drizzle-orm` is **0.45.2**, published **2026-03-27** (confirmed directly from the npm registry `dist-tags`/`time`). The 1.0 line exists only as pre-release (`beta` = `1.0.0-beta.22`; `rc` = `1.0.0-rc.4`, 2026-06-27) — not GA.
**Impact:** Low functionally — 0.44.x still supports D1 and drizzle-kit — but the pin is stale and the "current version is right" check fails.
**Fix:** Pin **`0.45.x`** for v1 (conservative stable), and note that 1.0 is in RC and may be worth re-evaluating before any publish. Keep the D1 `drizzle-orm/d1` driver and the `d1-http` kit driver for the out-of-band seed (both still current).
**Source:** npm registry `registry.npmjs.org/drizzle-orm` (`dist-tags.latest = 0.45.2`); orm.drizzle.team latest-releases (1.0 in beta/RC).

### FINDING 2 — [MEDIUM] AD-1 claim "D1 reached via binding (not a subrequest)" is factually wrong
**Spine:** AD-1 — "Persistence is Cloudflare D1, reached via binding (not a subrequest)."
**Fact:** Cloudflare defines a subrequest as *any* request a Worker makes via `fetch()` **or to Cloudflare services like R2, KV, or D1**. D1 binding queries **do** count as subrequests. On the **free plan** they fall into the **1,000 Cloudflare-services** subrequests/invocation bucket (separate from the 50-external bucket).
**Impact:** Low operationally — the 1,000-services cap is generous, and for single-user, few-new-games steady-state sync there is no risk. But the parenthetical rationale in AD-1 is incorrect and should not be relied on as a design guarantee.
**Fix:** Reword to: "D1 is reached via a binding (not an external `fetch`, so it does not consume the 50-external-subrequest budget), though binding calls still count toward the 1,000 Cloudflare-services subrequest cap." That preserves AD-1's intent (D1 is not an external I/O hop) while being accurate.
**Source:** developers.cloudflare.com D1/Workers limits; changelog 2026-02-11 subrequests.

### FINDING 3 — [LOW/MEDIUM] "50 subrequests/invocation" (AD-15) is imprecise
**Spine:** AD-15 — "blowing the free-tier 50-subrequests/invocation cap."
**Fact:** As of the 2026-02-11 change, the **free plan** limit is **50 external** subrequests **and 1,000** subrequests to Cloudflare services per invocation (paid default 10,000, configurable to 10M). So "50" applies specifically to **external** (IGDB/PSN) calls — which is exactly the fan-out AD-15 is worried about, so the underlying reasoning holds.
**Impact:** None to the decision (moving the ~344-game seed out-of-band is still correct and necessary given the 50-external cap). Only the phrasing under-specifies which bucket.
**Fix:** Say "**50 external** subrequests/invocation" to disambiguate. The out-of-band seed and chunk-on-fan-out rule remain sound.
**Source:** developers.cloudflare.com changelog 2026-02-11; Workers platform limits.

### FINDING 4 — [LOW / INFORMATIONAL] `getPurchasedGameList` is not part of psn-api
**Spine:** Stack — "PS data: `pdccws_p` cookie via persisted GraphQL (`getPurchasedGameList`); psn-api/NPSSO = deferred swap." AD-5 / Deferred section.
**Fact:** psn-api (v2.17.0) is real and its documented surface is trophy/user/title data (`exchangeNpssoForAccessCode` → `exchangeAccessCodeForAuthTokens` → `getUserTitles`, etc.). The v1 owned-library path (FR-33) instead uses the **`pdccws_p` cookie** against the raw PlayStation GraphQL endpoint (`m.np.playstation.com/api/graphql/v1/op`) with an operation like `getPurchasedGameList` — this is an **unofficial/undocumented** op, **not** exposed by psn-api.
**Impact:** Fragility risk (undocumented op + cookie auth that expires), but the spine already (a) isolates all of it inside `PsnProvider` (AD-5), (b) surfaces cookie-expiry without retry (AD-14), and (c) lists the NPSSO/psn-api swap as an explicitly deferred spike. This is architecturally handled — flagged only so the team does not assume psn-api ships `getPurchasedGameList` out of the box.
**Fix:** None required to the spine. Optionally add a one-line note that `getPurchasedGameList` is a raw GraphQL call, not a psn-api function, so the deferred spike is understood as "adopt psn-api's official flow AND find/keep an equivalent owned-titles query."
**Source:** npmjs.com/package/psn-api; psn-api.achievements.app docs; PlayStation GraphQL endpoint references.

---

## Confirmed-good (no action)

- **Workers free tier — 10ms CPU excluding I/O:** verbatim-correct. Docs: "Waiting on network requests (fetch, KV reads, DB queries) does not count toward CPU time."
- **D1 free limits:** 5M rows read/day, 100K rows written/day, 5 GB total storage — comfortably within a single-user ~344-game catalog.
- **Cron Triggers on free plan:** available at no extra cost; up to 3 per Worker (free) — the single monthly PS+ Extra cron fits with room to spare.
- **Hono + typed RPC on Workers/Static Assets:** current (v4.12.x, Apr 2026), fits the composition-root + typed SPA↔Worker contract.
- **`@cloudflare/vitest-pool-workers`:** current (~0.16.18), first-class D1 migration/test support — matches the Testing convention.
- **Biome v2:** current (v2.x, 2026 line v2.4) — valid single lint+format toolchain.
- **better-auth magic link:** current plugin (docs Apr 2026), Drizzle/D1-compatible, default single-use 5-min link — fits FR-47 and AD-13 user scoping.
- **IGDB via Twitch OAuth2 client-credentials:** correct endpoints and flow; 4 req/s rate limit (relevant to AD-14/AD-15 pacing).
- **workerd/V8 as prod runtime, Bun as dev-only (AD-2):** consistent with current Workers reality; no Bun-only runtime API assumed.

---

## Sources

- Cloudflare Workers limits — https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare subrequests changelog (2026-02-11) — https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/
- Cloudflare D1 pricing/limits — https://developers.cloudflare.com/d1/platform/pricing/ , https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare Cron Triggers — https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Drizzle ORM releases/npm — https://orm.drizzle.team/docs/latest-releases , npm registry `drizzle-orm` (`dist-tags.latest = 0.45.2`, 2026-03-27; `rc = 1.0.0-rc.4`, 2026-06-27)
- Drizzle + D1 — https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1 , https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit
- Hono — https://hono.dev/docs/guides/rpc , https://hono.dev/docs/getting-started/cloudflare-workers
- vitest-pool-workers — https://www.npmjs.com/package/@cloudflare/vitest-pool-workers , https://developers.cloudflare.com/workers/testing/vitest-integration/
- Biome — https://biomejs.dev/ , https://github.com/biomejs/biome
- better-auth magic link — https://better-auth.com/docs/plugins/magic-link
- IGDB / Twitch OAuth2 — https://api-docs.igdb.com/ , https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/
- psn-api / NPSSO — https://www.npmjs.com/package/psn-api , https://psn-api.achievements.app/get-started
