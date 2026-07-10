# Epic 4 Context: Fill the Library from PlayStation (Sync)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

One button appends new purchases from the PlayStation library into the app: append-only with respect to user-entered data, membership (PS+ claim) entries skipped, cover art and PS Store URLs captured at sync time, an expired session cookie surfaced with refresh instructions, and every run ending in a visible summary. The library fills itself (success metric #1). This epic creates the `SETTING` table (session cookie) and the FAB drawer shell (Sync is its first item), both need-scoped.

## Stories

- Story 4.1: PSN provider & session-cookie settings
- Story 4.2: Sync the PlayStation library (append-only)
- Story 4.3: Sync summary & needs-attention

## Requirements & Constraints

- **Ownership semantics:** `Owned` is a flag meaning *purchased*, set by sync (digital source of truth) or manually (physical). Membership-sourced entries (PS+ claims — the export's `membership` field) never set it; most real export entries are claims, not purchases.
- **Append-only sync:** sync may create games (defaults: Owned, digital, `Not started`, `bought_on` stamped) and may flip `Owned` false→true on existing games of any origin (stamping `bought_on`, type digital). It never deletes a game, never sets `Owned` false, and never touches status, milestones, dates, or genres. Membership entries are skipped entirely — never created, never flipped — and a claim matching a tracked game leaves it untouched.
- **Matching order:** stored external-ID/alias links first, then normalized title, with PS4/PS5 collapse. A title-matched game already carrying a *different* external-ID link is flagged in the sync summary's needs-attention list, never silently merged.
- **Capture at sync:** cover art and PS Store product URL are persisted during sync — nothing is fetched on page render.
- **Auth:** the live `pdccws_p` PlayStation session cookie lives in the `SETTING` table, editable from a settings surface, read fresh per call (a Wrangler secret may seed the initial value). On 401/403 the app surfaces cookie-refresh instructions in the attention banner and does not retry.
- **Summary:** every sync ends with a visible summary — games added, `Owned` flips, membership entries skipped, and anything needing attention (failed lookups, conflicts). Needs-action items also seed the persistent attention banner and offer a jump-to-problem button.

## Technical Decisions

- **PsnProvider adapter (AD-5):** all PSN access goes through `providers/psn/`; the auth mechanism lives entirely inside the adapter (swapping to NPSSO later changes only that adapter). Uses the persisted `getPurchasedGameList` GraphQL query (sha256 hash pinned in the legacy Python script — copy verbatim; hand-written GraphQL does not work), `library.playstation.com` origin/referer headers + `apollographql-client-name: my-playstation`, page size 100, loop until `pageInfo.isLast`.
- **Append-only enforced at one write-path guard (AD-10);** failures surface, never silent-retry (AD-14).
- **Identity model:** `EXTERNAL_LINK (source, external_id)` is game identity, many rows per (game, source) — both PS4 and PS5 ids resolve to the one PS5 game (AD-20). `title_normalized` (single `core/` normalizer, AD-9) is a non-unique first-pass candidate key (AD-18). The FR-34 conflict = an external id resolving to a *different* `GAME` than the title match.
- **Attribute ownership (AD-19):** `GAME` holds shared catalog facts (title, cover_url, store_url, etc., written by ingest); `GAME_TRACKING` (PK `(user_id, game_id)`, AD-17) holds per-user state including `owned`/`ownership_type`.
- **Subrequest budget (AD-15):** free tier allows 50 external subrequests per invocation — chunk or run heavy fan-out out-of-band; PSN pagination for ~175 games fits (~2 pages) but design with the cap in mind.
- **Region (AD-23):** account region persists in `SETTING` (Epic 5 reads it; first sync may derive and persist it).
- **Stack:** one Worker (Hono API + React SPA), D1 via Drizzle repositories (AD-4), domain core I/O-free (AD-3), Vitest + pool-workers, Biome, Playwright e2e.

## UX & Interaction Patterns

- **FAB drawer (chores only):** opens upward, bottom-right default (position configurable), icons-only mobile / icons+text desktop; each item opens a modal; long-op items (Sync) show a spinner while running. Epic 4 stands up the shell need-scoped, carrying only its Sync item (later epics add their own). No Add here.
- **Feedback channels governing rule:** a triggered op runs inline with progress → resolves into a **summary modal** (counts + needs-attention + jump-to-problem button); anything needing action *also* seeds the **attention banner** under the header so it survives dismissing the modal. Transient good news → toast.
- **Empty library state** offers "Sync library" as a CTA.
- **Accessibility:** icon-only FAB/drawer items carry accessible names; long-op results announce politely.

## Cross-Story Dependencies

- 4.1 (`PsnProvider` + `SETTING` cookie + 401/403 banner) is the foundation 4.2 calls; 4.3 renders what 4.2's sync run reports.
- The FAB drawer shell is shared with Epic 6 — whichever epic builds first creates it; Epic 4 landing first means 4.2 stands it up with the Sync item only.
- Epic 5 builds on this epic's `PsnProvider` and `SETTING` table (natural order 4 → 5).
- Epic 3 (done) already hardened write-path/attention-banner surfaces for sync-driven writes (stale panels, UNDO toasts, open menus).
