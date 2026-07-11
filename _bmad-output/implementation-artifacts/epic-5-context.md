# Epic 5 Context: Know What's Playable — PS+ Extra Awareness

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Flag which tracked, non-owned games are currently in the user's per-region PS+ Extra catalog — via a manual button and a monthly Cloudflare Cron Trigger — so the Playable-now signal lights up before a purchase and closes the blind spot of buying a game already covered by the subscription. A "PS+ catalog as of {date}" timestamp tells the user how fresh the signal is. Builds directly on Epic 4's `PsnProvider` and `SETTING` table.

## Stories

- Story 5.1: Region setting & PS+ Extra check (button)
- Story 5.2: Scheduled monthly refresh (Cron Trigger)
- Story 5.3: "PS+ catalog as of {date}" timestamp

## Requirements & Constraints

- The check sets/clears the PS+ Extra flag on **tracked, non-owned games only**, updating flags in both directions (games leave the catalog too). Catalog games are **never auto-added** to the library — availability is not ownership.
- The flag is ignored and hidden the moment a game becomes owned.
- **Playable now** = (owned OR currently in the PS+ Extra catalog) AND released. Stored catalog membership must feed this derived state, lighting up the card flag and the filter pill.
- The catalog is **per-region**; the check runs against the user's account region.
- Triggered two ways: a button and a scheduled job aligned to Sony's predictable monthly catalog update. The scheduled job must fit the stateless Cloudflare free tier (subrequest budget: 50 external + 1,000 Cloudflare-service calls per invocation).
- A failed scheduled refresh must surface a notice on next app open — failures surface even when nobody watches the run.
- v1 assumes a PS+ Extra subscription; tier settings (Essential/Premium) are out of scope.

## Technical Decisions

- **Region storage:** account region persists in the `SETTING` table (seeded from config, or derived and persisted from PSN on first sync). Both the button path and the cron path read the same stored region — no divergence. Region is a `PsnProvider` input.
- **Provider seam:** all PSN calls go through the existing `PsnProvider` adapter; auth (the live `pdccws_p` cookie in `SETTING`, read fresh per call) stays entirely inside it.
- **Ingest-only fetches:** providers are touched only by ingest jobs (the PS+ check is one). Query/render paths read persisted data only — a `fetch` in a query path is an architecture violation.
- **Stored fact, derived state:** PS+ Extra catalog membership is a fetched fact and is **stored** (per region, `ps_plus_extra` on GAME); Playable-now is derived from it at read time, never stored.
- **Scheduling:** Cloudflare Cron Trigger (monthly) in `wrangler.toml`, handled by the same Worker; cron and button invoke the same region-scoped service.
- **Error posture:** expired PS cookie (401/403) surfaces refresh instructions and stops — no retry. Structured logs over the cron run (`wrangler tail`); failure state persists so next app open shows it.
- **Timestamp:** last successful refresh time persists in `SETTING` ("PS+ refreshed-at").

## UX & Interaction Patterns

- Entry point: FAB drawer item "Check PS+ Extra" (chores drawer, shared shell from Epic 4); shows a spinner while running.
- Governing feedback rule: the triggered check resolves into a **summary modal** (flag-change counts + needs-attention items with a jump-to-problem button); anything needing action also seeds the **persistent attention banner** so it survives dismissing the modal. Failed scheduled refresh goes straight to the banner.
- Header readout: "PS+ CATALOG AS OF {date}" — full on desktop, compact on mobile; timestamp rendered in the mono accent font like other numerals/dates.
- Card surface: PS+ Extra flag icon on non-owned games; icon-only controls carry accessible names + state.

## Cross-Story Dependencies

- Epic 4 prerequisites: `PsnProvider`, `SETTING` table, FAB drawer shell, summary modal, and attention banner already exist — reuse, don't rebuild.
- 5.1 → 5.2: cron runs the same region-scoped check service the button uses (shared implementation is an AC, not an option).
- 5.1 → 5.3: the timestamp records the refresh both trigger paths perform.
- Epic 1 hook: Playable-now derived state and its filter pill exist from Epic 1; this epic supplies the catalog-membership input that makes them true for non-owned games.
