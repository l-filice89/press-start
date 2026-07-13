# Roadmap

Everything still to be done, in one place. Sources are the planning artifacts
(brief, PRD, SPEC, architecture spine, UX, epics) and the implementation
ledgers; this page is the index, they keep the detail.

Tiers are the ones the planning docs already use: **v1.x** (explicitly next),
**Post-v1.0.0 epics** (scoped, waiting on demand), **Future** (earns its way
in), **Non-goals** (decided against — listed so they stop getting re-proposed).

## v1.x — enriches a working app, explicitly next

| Item | What it is | Source |
| --- | --- | --- |
| **Google sign-in** | better-auth is already the auth layer with magic link; Google OAuth was always the long-term path. **Owned by Epic 8, story 8.1 (B1a)** — added alongside magic link, with the `AUTH_ALLOWED_EMAIL` gate still applying to the callback. Single-tenant-safe and no schema change, so it ships in v1.x ahead of the rest of its epic and does not wait on the 8.0 design gate; dropping the gate is story 8.2 (B1b) and stays demand-driven. | `prd.md:152` (FR-47), `brief.md:83`, `epics.md` (Story 8.1) |
| **Trophy sync from PSN** | Completion % + PSNProfiles-style letter grade per game. **Owned by Epic 9, story 9.2**; the one-off backfill is **story 9.3** — for games with a Platinum but no dates on record, set the platinum date from PSN and **assume completion date = platinum date**, a backfill heuristic only, not the rule for games synced going forward. | `prd.md:172`, `brief.md:80`, `epics.md` (Epic 9) |
| **Sync the PS+ / PS Store wishlist** | Pull the wishlist from PSN and add those titles to the Press Start wishlist. We already store the PS Store link per game (FR-16 captures product IDs), so the join exists — the missing half is reading the wishlist from PSN. **Epic 9, story 9.4 — conditional**: gated by spike S-1 (story 9.1). Reachable over `pdccws_p` → it stays in Epic 9 alongside trophy sync; needs NPSSO → the swap becomes its prerequisite and the story is **dropped from Epic 9 to Future**. | new (2026-07-13), `epics.md` (Epic 9) |
| **Critic & user scores** | **Source decided (2026-07-13): IGDB** — `aggregated_rating` (critic) + `rating` (user) come off the `/games` endpoint `IgdbProvider` already calls, so **no second adapter**. Scored fields + a scheduled refresh. OpenCritic only if coverage proves thin on real titles; RAWG is out. **Owned by Epic 10, story 10.1** — no dependency on Epic 7, so it is pullable ahead of the rest of its epic. | `prd.md:173`, `prd.md:211`, `epics.md` (Epic 10) |
| **"Leaving PS+ Extra soon" warnings** | Flag backlog games about to exit the catalog. **Owned by Epic 10, story 10.2**, which diffs the `ps_plus_catalog` snapshot Epic 7 story 7.1 builds — so it **follows Epic 7**. Open at design time: if the PS+ ingest exposes no leave-date, it ships as *"left the catalog"* (observable) rather than *"leaving soon"* (a guess). | `prd.md:174`, `brief.md:82`, `epics.md` (Epic 10) |
| **PV-6 — shared IGDB match picker** | Extract `<IgdbMatchPicker>` from `RematchDialog`, migrate `StragglersDialog`, mount in `AddGameDialog`. Last open item of the post-launch batch. **Owned by Epic 6, story 6.6.** | `implementation-artifacts/post-v1-backlog.md`, `epics.md` (Story 6.6) |

## Post-v1.0.0 epics — scoped, not started

All four are decomposed into stories with acceptance criteria in `epics.md`
(2026-07-13). Nothing below is bullet-level any more.

**Epic 7 — Browse the PS+ catalog & add** (PRD FR-50/51/52)
Store the region catalog as a first-class dataset (7.1), browsable paged grid
with genre filter + search (7.2), add or "Claim now" deep-link (7.3). Story 7.0
is an arch/UX design gate that also decides the **cross-tree CustomEvent bus
replacement**. PS+ Premium Classics + tier filter is a later epic still.

**Epic 8 — Multi-user readiness** (demand-driven)
Story 8.0 is an auth-model + data-scoping design gate. Then the publication
blockers in dependency order: 8.2 (B1b) drop the `AUTH_ALLOWED_EMAIL` gate →
8.3 (B2+B3) global facts go per-user (`ps_plus_extra` flag, PSN region — one
story, a per-user flag is meaningless without a per-user region) → 8.4 (B4+B5)
per-user PS+/sync cron → 8.5 (B6) backfill `owned_via = NULL` legacy rows.
**Story 8.1 (B1a, Google OAuth) sits outside that ordering** — single-tenant-safe,
no schema change, ships in v1.x whenever wanted, and does not wait on 8.0.
Live detail: `implementation-artifacts/publication-blockers.md`.

**Epic 9 — The PSN Record: trophies (and maybe wishlist)** (v1.x)
9.1 spike S-1 → 9.2 trophy sync (counts persisted; % and letter grade derived in
the domain core; the sync never writes milestones) → 9.3 the one-off milestone
backfill (the only place a sync writes a milestone; fills nulls only, so it is
idempotent) → 9.4 wishlist sync, conditional on 9.1.

**Epic 10 — Know Before You Play: scores & expiry warnings** (v1.x, after Epic 7)
10.1 IGDB critic + user scores (coverage on real titles is verified as the story's
first task) → 10.2 catalog-expiry warning, which needs 7.1's stored snapshot.

## Future — earns its way in later

- **Sale detection + notifications** for wishlisted games — daily cron over PS Store pricing. No official pricing API; prerequisite is capturing PS Store product IDs, which FR-16 already started collecting. (`prd-addendum:5`)
- **PS+ subscription-tier settings** (none / Essential / Extra / Premium) — feeds the tier-aware catalog. (`prd.md:187`)
- **"Subscription cancelled" un-own flow** for `owned_via = 'membership'` rows. (`prd-addendum:32`)
- **Tunable play-next suggestions** ("same genre" / "vary genre"). (`prd.md:188`)
- **Stats and dashboards** over the lifecycle-date history. (`prd.md:189`)
- **Genre merge/rename tool** — genres are per-game editable only today. (`prd.md:102`, FR-25)
- **Playtime; non-PlayStation platforms.** (`prd.md:191`)

## Deferred technical work

- **Spike S-1 — PSN auth surface** (one afternoon, next up) — **now Epic 9, story 9.1.** Probe the **wishlist** endpoint, `getPurchasedGameList` and the **trophy** endpoints under `pdccws_p`, then under an NPSSO bearer. Output: an endpoint × auth-path table. Subsumes the old NPSSO-swap spike (PRD open-q #2) and **gates wishlist sync** (story 9.4) above. The swap stays isolated behind `PsnProvider`; revisit regardless when cookie-refresh friction bites or before any publish. (`ARCHITECTURE-SPINE.md` → Deferred)
- **Release management** — release branches, tags, Wrangler `staging` env. Deferred to the publish milestone; v1 is trunk-based. (`ARCHITECTURE-SPINE.md:288`)
- **Convex / Postgres migration** — not needed at single-user scale; a repository-layer change if ever. (`ARCHITECTURE-SPINE.md:337`)
- **Code-level debt** — see `implementation-artifacts/deferred-work.md`. Live ones worth naming: the **episodic-title regression** PV-2's category whitelist introduced (Hitman seasons, Life is Strange enrich to null); stragglers resolving to an already-linked igdbId writing **duplicate catalog rows**; DW-9 infinite-scroll Playwright flake. Accepted shortcuts with named ceilings: `/ponytail-debt`.

## UX carry-overs

- **Light theme is not a "later," it's a "don't"** — dark-only is deliberate. Listed here only so it stops being re-litigated. (`DESIGN.md:153`)
- Invalid/expired magic-link case — never specified. (`ux/review-rubric.md:76`)
- Flip-grow animation fluidity/perf — deferred to the React build, never revisited. (`ux/.memlog.md:34`)
- Promote the 1–2 actually-used filters to always-visible — flagged easy, not built. (`ux/.memlog.md:41`)
- Card titles may drop from Orbitron to Rajdhani *if* real-world testing shows strain. (`DESIGN.md:102`)

## Non-goals — decided against, do not re-propose

| Item | Why |
| --- | --- |
| **Gamification** (XP, streaks, badges) | "The field tried it; it incentivized logging games nobody played." Permanent. |
| **Personal ratings** | Dropped entirely — no field exists. External critic scores (v1.x) are a different thing. |
| **Auto-adding PS+ catalog games** | Availability is not ownership; catalog games leave. Epic 7 preserves this — catalog rows live in their own table. |
| **Direct in-app "claim"** | *Investigated & declined* — undocumented authenticated write against the real PSN account, irreversible on a mistaken tap. "Claim now" deep-link delivers the value. Revisit only if Sony ships a supported API. |
| **"Finished-but-idle" status** | Completion-as-a-status through the side door; milestones-as-dates solve replays by construction. |
| **Mobile status dot** (instead of the text pill) | Rejected as too subtle / sub-44px hit target. Early wireframes showing it are superseded. |
| **Automating what Sony's API can't give reliably** | Standing non-goal. |
