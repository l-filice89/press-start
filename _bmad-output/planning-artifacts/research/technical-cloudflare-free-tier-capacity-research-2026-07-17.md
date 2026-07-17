---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
workflowType: 'research'
lastStep: 4
research_type: 'technical'
research_topic: 'Cloudflare free tier capacity for press-start (Workers, D1, cron) — max concurrent/total users + per-endpoint request budget'
research_goals: 'Estimate max concurrent and total users press-start supports on Cloudflare free tier; derive per-endpoint request budget from current routes'
user_name: 'Luca'
date: '2026-07-17'
web_research_enabled: true
source_verification: true
---

# Research Report: technical

**Date:** 2026-07-17
**Author:** Luca
**Research Type:** technical

---

## Research Overview

**TL;DR:** press-start on Cloudflare free tier supports **~550 active users/day** (up to ~3,000 light users). The binding limit is **D1 rows read (5M/day)** — not the 100k Worker request cap — because several routes scan the whole library per hit. Concurrency is not platform-capped; the daily read budget is the ceiling. Today's actual ceiling is **1 user** (allowlist + single-tenant cron). The write cliff is `ps-plus-check` (~100 runs/day max).

**Method:** free-tier limits verified against live Cloudflare docs (2026-07-17); route inventory + D1 cost per route read directly from codebase with file:line evidence; capacity derived arithmetically. Row estimates ±2× — calibrate with production `rows_read` metrics.

---

## Technical Research Scope Confirmation

**Research Topic:** Cloudflare free tier capacity for press-start (Workers, D1, cron) — max concurrent/total users + per-endpoint request budget
**Research Goals:** Estimate max concurrent and total users press-start supports on Cloudflare free tier; derive per-endpoint request budget from current routes

**Scope (tailored):** free-tier limits inventory, route inventory, per-endpoint cost model, capacity math, headroom/mitigations. Generic stack/integration boilerplate dropped as not relevant.

**Scope Confirmed:** 2026-07-17

## Free-Tier Limits Inventory (verified 2026-07-17)

### Workers Free plan

| Limit | Value |
| --- | --- |
| Requests | **100,000/day** (resets midnight UTC; excess → Error 1027) |
| CPU time | 10 ms per request; 10 ms per cron invocation |
| Memory | 128 MB per isolate |
| Subrequests | 50/request |
| Simultaneous outgoing connections | 6 per invocation |
| Cron Triggers | 5 per account |
| Worker size | 3 MB gzipped |
| Static asset files | 20,000 per version |

_Source: https://developers.cloudflare.com/workers/platform/limits/_

### D1 Free plan

| Limit | Value |
| --- | --- |
| Rows read | **5,000,000/day** |
| Rows written | **100,000/day** |
| Storage | 5 GB account / 500 MB per DB |
| Queries per Worker invocation | 50 |
| Behavior at limit | D1 API returns errors — queries refused until daily reset |

_Sources: https://developers.cloudflare.com/d1/platform/pricing/, https://developers.cloudflare.com/d1/platform/limits/_

### Static assets

Requests served from Workers Static Assets are **free and unlimited** — they do not count toward the 100k/day Worker request limit. Only requests that invoke the Worker script (the API) are billed. `run_worker_first` patterns would make matching requests billable (429 once over quota).

_Source: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/_

**Confidence: HIGH** — all numbers read directly from current Cloudflare docs.

## Route Inventory (from codebase, 2026-07-17)

Composition root `worker/index.ts:20-31`: `/api` → Hono routes (`src/routes/index.ts:21-32`), everything else → Static Assets (SPA fallback). `wrangler.jsonc:10-18`: `run_worker_first: ["/api/*"]` only — **all non-API requests are free asset serves; only `/api/*` + cron are billed Worker invocations.**

### Session tax (every authenticated request)

`requireAuth` (`src/routes/auth.ts:55-68`) calls `auth.api.getSession()` per hit; **no cookie cache configured** (`src/services/auth.ts:68-146`) → **+1–2 D1 row reads on every protected API call** before route work.

### Routes | D1 queries/hit | rows touched

Library size ~350 tracked games; PS+ catalog snapshot ~490 rows.

| Route | D1 queries (excl. auth tax) | Rows touched |
|---|---|---|
| `GET /api/health` | 0 | 0 (no auth) |
| `POST /api/auth/sign-in/magic-link` | 0 (non-allowlisted) / ~2 W | single |
| `GET /api/auth/magic-link/verify` | ~4–5 R/W | singles |
| `GET /api/auth/get-session` | 1–2 R | single |
| `GET /api/me` | auth only | single |
| `GET /api/shelf` | 2–5 R | **whole library + genre links** (no LIMIT; sort/filter in memory) |
| `GET /api/games/:id` | 2–5 R | **whole library** for one game (ponytail-flagged, `shelf.ts:158-160`) |
| `GET /api/games/preview` / `search` | 0 | 0 + 1 external IGDB |
| `POST /api/games` | ~5–15 R/W | few singles |
| `POST /api/games/:id/rematch` | ~6+2×genres | single game |
| `PATCH play-status` / `ownership` / `dates` / `discard` | 2–4 | single row |
| `POST milestones` | 2–3 | single row |
| `POST/DELETE genres` | 3–5 | single game's genres |
| `GET /api/genres` | 1 R | genre vocab (small) |
| `GET /api/stragglers` | 2 R | all staging rows + **whole library** |
| `POST /api/stragglers/resolve` | ~6–12 R/W | few rows |
| `GET /api/export.csv` | 2–5 R | **whole library** |
| `GET /api/settings` | ~9 R | **2 whole-library scans** + settings singles |
| `POST /api/settings/cancel-ps-plus` | 1 R + N updates | N membership rows |
| `PUT settings/*` | 1–4 | singles |
| `POST /api/ps-plus-check` | **~32 R/W** | **~490-row snapshot write + whole-library flag pass** + 5 external PSN pages |
| `GET /api/ps-plus-catalog` | ~6–7 R | **~490 catalog rows + whole library** (paged 60 in memory, reads all) |
| `GET /api/ps-plus-catalog/genres` | 4 R | ~490 + tag rows |
| `POST /api/ps-plus-catalog/genres` | lock + chunk | bounded chunk |
| `POST /api/e2e/sql` | gated off in prod | — |

### Cron

Schedule `"0 9,21 15-28 * *"` (`wrangler.jsonc:47`) = **~28 fires/month**, single-tenant. One rotation slot per fire (membership pass ~32 D1 + 5 external / score refresh ~7 D1 + 3 external / sweep chunk), sequential, capped under 50 subrequests.

### Cost hotspots

1. No session cookie cache → D1 session read on every API hit.
2. Whole-library reads (no SQL LIMIT) on shelf, game-by-id, export, stragglers, settings, ps-plus-catalog.
3. `POST /api/ps-plus-check` heaviest single request (~32 D1 + snapshot write).

**Confidence: HIGH** — direct code reads with file:line evidence.

## Per-Endpoint Cost Model & Request Budget

**Billing metric:** D1 counts rows **scanned**, not returned — full-table scans and joins bill every row touched; indexes reduce it; each indexed write bills 2 rows (table + index). _Source: https://developers.cloudflare.com/d1/platform/pricing/#definitions_

**Assumptions:** library ~350 tracked games (~700–1,000 scanned per full-library join incl. genre links), PS+ snapshot ~490 rows, session tax 2 rows read/auth call, no cookie cache. Estimates ±2× — verify against real `meta.rows_read` in production; MEDIUM confidence on absolute row counts, HIGH on relative ranking.

### Budget table — max hits/day per endpoint if it alone consumed the binding budget

| Endpoint | Rows R/hit | Rows W/hit | Binding limit | Max hits/day |
|---|---|---|---|---|
| `GET /api/shelf` | ~1,500 | 0 | D1 reads | **~3,300** |
| `GET /api/games/:id` | ~1,500 | 0 | D1 reads | **~3,300** |
| `GET /api/settings` | ~1,500 | 0 | D1 reads | ~3,300 |
| `GET /api/export.csv` | ~1,500 | 0 | D1 reads | ~3,300 |
| `GET /api/ps-plus-catalog` | ~1,200 | 0 | D1 reads | ~4,200 |
| `GET /api/ps-plus-catalog/genres` | ~1,000 | 0 | D1 reads | ~5,000 |
| `GET /api/stragglers` | ~700 | 0 | D1 reads | ~7,000 |
| `PATCH tracking/*` (status/dates/etc.) | ~6 | 1–2 | Worker reqs | 100,000 |
| `GET /api/auth/get-session`, `/api/me` | ~2 | 0 | Worker reqs | 100,000 |
| `POST /api/games` | ~30 | ~10 | D1 writes | ~10,000 |
| Magic-link login (full flow) | ~10 | ~7 | D1 writes | ~14,000 |
| `POST /api/ps-plus-check` | ~900 | **~1,000** (490-row snapshot ×2 w/ index + flags) | D1 writes | **~100** |

Cron: 2 fires/day max ≈ ≤2,000 writes + ≤2,000 reads/day — ~2% of write budget, negligible.

### Session cost model

| Session type | API requests | Rows read | Rows written |
|---|---|---|---|
| Light (open app, view shelf) | ~3 | ~1,600 | 0 |
| Active (shelf + 3 game details + 5 status edits + refetches) | ~15 | ~9,000 | ~10 |
| Login day (adds magic-link flow) | +3 | +10 | +7 |

## Capacity Math

**Which limit binds: D1 rows read.** Worker requests would allow ~6,600 active sessions/day (100k ÷ 15); D1 reads allow only ~550 (5M ÷ 9,000). Reads bind ~12× earlier than requests.

| Question | Answer |
|---|---|
| **Max daily active users** (1 active session each) | **~550** (active use) to ~3,000 (light use) |
| **Max concurrent users** | No hard platform cap (Workers scale out; D1 queues then errors "overloaded"). Practical bound is the daily read budget: sustained average ~58 rows/sec ≈ **~2 shelf loads/min all day**, or ~140 active users in a single peak hour before the day's budget burns. Burst of dozens of simultaneous users survives; they drain the daily budget, not the platform. |
| **Max total registered users** | Storage never binds (500 MB ≈ millions of rows; ~350-row library ≈ <1 MB/user). Write budget binds sign-ups at ~14k logins/day. Practical total: **thousands**, provided DAU stays ≤~550. |
| **Today's actual ceiling** | **1 user.** `AUTH_ALLOWED_EMAIL` allowlists a single account and the cron is single-tenant (`worker/index.ts:41-70`). Multi-user requires code change; the numbers above are the hypothetical multi-user ceiling. |

**Caveats:** `ps-plus-check` is the write cliff — ~100 runs/day account-wide; per-user daily checks cap the app at ~100 users regardless of reads. If better-auth refreshes session expiry on reads it adds writes per session (unverified — LOW confidence, check in prod metrics).

## Headroom & Mitigations

Ranked by rows saved per unit of work. Only relevant if the app ever goes multi-user — at 1 user, current usage is ~0.2% of any budget; do nothing.

| # | Fix | Cost | Effect |
|---|---|---|---|
| 1 | `GET /api/games/:id` → single-row `WHERE id = ?` instead of whole-library load (`shelf.ts:158-168`, already ponytail-flagged) | small | ~1,500 → ~10 rows/hit; active session ~9,000 → ~4,600 |
| 2 | `GET /api/settings` → SQL `COUNT(*)` instead of 2 full-library scans (`settings.ts:42-62`) | small | ~1,500 → ~20 rows/hit |
| 3 | `GET /api/ps-plus-catalog` → `LIMIT/OFFSET` in SQL instead of read-all-then-slice (`psplus-browse.ts:35`) | small | ~1,200 → ~150 rows/hit |
| 4 | `ps-plus-check` diff-based upsert (write only changed rows, not full 490-row snapshot) | medium | ~1,000 → ~50 writes/run; write cliff ~100 → ~2,000 runs/day |
| 5 | better-auth `session.cookieCache` | tiny | −2 reads/call; ~30 rows/session — cosmetic, skip unless free |
| 6 | Client cache (TanStack Query staleTime) + ETag on shelf | small | fewer shelf refetches; multiplies all of the above |

Fixes 1–3 together: active session ~9,000 → ~2,500 rows → **DAU ceiling ~550 → ~2,000**.

**Paid escape hatch:** Workers Paid ($5/mo) includes 25B D1 reads + 50M writes/mo — ~×160 read headroom; removes the cliff entirely. Cheaper than engineering time if the app ever nears limits.
_Source: https://developers.cloudflare.com/d1/platform/pricing/_

## Conclusions

1. **Free tier is grossly sufficient for current single-user reality** (~0.2% of budgets). No action needed.
2. **Hypothetical multi-user ceiling: ~550 active DAU**, bound by D1 rows read, not requests. Concurrency effectively unbounded within the daily budget.
3. **Per-user daily PS+ checks are the hidden cliff** (~100 users max on writes) — fix #4 before any multi-user plan.
4. Static assets free → SPA traffic never threatens limits; only `/api/*` counts.
5. If multi-user ever happens: apply fixes 1–3 (~2,000 DAU) or pay $5/mo and stop thinking about it.

**Research complete: 2026-07-17**
