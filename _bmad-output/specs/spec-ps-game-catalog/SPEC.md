---
id: SPEC-ps-game-catalog
baseline: '3.6.0'
updated: '2026-11-07'
companions:
  - ../../planning-artifacts/architecture/architecture-ps-game-catalog-2026-07-05/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md
  - ../../project-context.md
  - ../../implementation-artifacts/spec-igdb-playstation-platform-filter.md
  - ../../implementation-artifacts/spec-permanent-account-deletion.md
sources:
  - ../../planning-artifacts/prds/prd-ps-game-catalog-2026-07-05/prd.md
  - ../../planning-artifacts/prds/prd-ps-game-catalog-2026-07-05/addendum.md
---

# PRESS START — PS Game Catalog

This SPEC and its adopted companions define the current product contract, re-derived from the append-only decision log. Historical story instructions and mocks do not override this baseline. Original capability IDs remain stable; CAP-5 is retired.

## Why

Replace Luca's Notion gaming tracker with a trusted, dark, cover-forward PlayStation library: owned, wanted, playing, and finished. Seed the existing record once, then maintain it through deliberate manual additions and edits. Phone discovery should take seconds; desktop browsing, regional PS+ awareness, Stats, and explainable Play Next help decide what to buy or play. Registration is open with private user-scoped tracking; credentialed PSN automation is excluded.

## Capabilities

- **CAP-1 — Computed state model**
  - **intent:** Track one mutable play status (`Not started`, `Up next`, `Playing`, `Paused`, `Dropped`) and completion-milestone dates; derive effective state, released, wishlisted, and playable-now from stored inputs.
  - **success:** Every edit preserves status-or-milestone validity. Effective state prefers a set play status, then platinum, then story completion. Logging platinum clears status; logging story completion leaves it unchanged. Later replay may show `Playing` while preserving milestone dates.

- **CAP-2 — Shelf & detail**
  - **intent:** Browse a dark cover grid and edit status, milestones, lifecycle dates, genres, ownership format/source, and store navigation through detail and inline controls.
  - **success:** Default Shelf orders `Playing` → `Up next` → `Paused` → `Not started`, owned first then title within each group. Completed/platinum/dropped states require reveal selection; milestone logging requires confirmation. Deliberate discard hides a game; re-add revives its record rather than duplicating it.

- **CAP-3 — Filter & search**
  - **intent:** Narrow the Shelf with State, Genre, Time, flags, and exclusive hidden-state reveals, alongside title search.
  - **success:** State/Genre/Time choices OR within their group and AND across groups; each flag is an independent AND condition. Reveals OR among themselves and replace State. Without active filters, search spans the whole library including hidden states; with active filters, search narrows within them. Visible scope text explains the rule. Completed-only takes one reveal selection.

- **CAP-4 — One-time seed import**
  - **intent:** Reconcile Notion and PS-library CSVs with the games DB, collapse PS4/PS5 pairs, preserve known tracking history, and enrich catalog facts.
  - **success:** Purchases and membership claims import as owned with acquisition source distinguished; WEBMAF companion apps are excluded and counted. Notion `Owned` and known dates survive. Unknown statuses, ambiguous/unmatched titles, or completion without a finish date remain visible for manual resolution; owned PS games without enrichment remain visible as unenriched. Resolution carries Notion data and stores a permanent match link. No history is invented.

- **CAP-5 — PS library sync [RETIRED]**
  - **intent:** Historical automated library sync, withdrawn by the approved 2026-07-15 PSN Account Safety decision; this ID must not be reused.
  - **success:** No credentialed library/trophy/backfill operation or PSN credential setting is exposed. Upkeep uses seed import, add-by-name, and manual edits.

- **CAP-6 — Regional PS+ Extra awareness**
  - **intent:** Derive membership and playability from the user's region snapshot, refreshed automatically without adding catalog games to the library.
  - **success:** Membership changes in both directions; non-owned catalog games show the PS+ indicator, hidden once owned. Show the last successful timestamp and updating state. Scheduled rotation and stale-snapshot recovery replace the manual button; failures retain stored data and stale timestamp, with passive operational reporting rather than a user-action banner.

- **CAP-7 — Add-by-name & enrichment**
  - **intent:** Find a tracked game or search external candidates, review pre-filled facts, and deliberately add a game; permit name-only capture when external search fails or has no match.
  - **success:** Existing tracked games open detail without duplication. Defaults are not owned, `Not started`, and a captured wishlist date; owned additions distinguish purchase from membership. Name-only games remain visible for later enrichment. Interactive matching follows CAP-16.

- **CAP-8 — Lifecycle dates**
  - **intent:** Capture wishlist, purchase, first-start, story-completion, and platinum dates when transitions establish them; permit deliberate correction in detail.
  - **success:** Automatic flows never overwrite a recorded date. Claims never stamp `bought_on`; replay never stamps `started_on`. Seed uses only known source dates. Stats consumes recorded history without inventing missing events.

- **CAP-9 — PWA, authentication & private libraries**
  - **intent:** Provide one installable responsive app with open registration, magic-link sign-in, and Google sign-in alongside it when configured.
  - **success:** Admission proves email control, including account linking. Tracking and settings remain user-scoped across reads and writes. Phone and desktop support quick wishlist capture; no roles or sharing are introduced. Signed-cookie-cache session revocation has a maximum five-minute delay.

- **CAP-10 — CSV export**
  - **intent:** Download a user-held copy of the current library from Settings.
  - **success:** CSV includes titles, effective/raw status, ownership format/source, lifecycle/milestone dates, genres, and release/PS+ facts for the signed-in user only. Valid quoting and formula neutralization support spreadsheet use; failed downloads report failure instead of saving an error response.

- **CAP-11 — Catalog browse & add**
  - **intent:** Browse the stored regional Extra catalog with search, store-genre filters, and tracked/owned markers.
  - **success:** Paged results use stable normalized-title/product ordering. Add opens enrichment preview and saves wishlisted before opening editable detail. `Claim now` opens the regional store and never establishes ownership. Owned cards have no add/claim actions; tracked non-owned cards retain Claim. Browsing creates no tracking rows automatically.

- **CAP-12 — Scores, time-to-beat & catalog freshness**
  - **intent:** Show persisted critic/user scores with counts and distinct story/100% estimates; refresh external facts, including release dates, in background jobs.
  - **success:** Missing facts remain absent, never fabricated as zero or substituted across metrics. Time filtering has five nonoverlapping hour bands plus Unknown and a story/100% selector. Failed or omitted provider rows preserve standing facts; valid explicit clears follow field semantics. Score-refresh failures retain their notice; rendering requires no metadata provider calls.

- **CAP-13 — PS+ departure warnings**
  - **intent:** Warn about known upcoming regional departures on eligible non-owned tracked games.
  - **success:** Stored departure dates drive card warnings and Leaving soon filtering. Valid staying/null replies clear a prior departure; failures preserve prior facts. Departure history survives snapshot pruning; no PSN credential is used.

- **CAP-14 — Stats**
  - **intent:** Summarize the user's all-time library and selected-year gaming history.
  - **success:** Show tracked/owned/completed/platinum recap, selected-year lifecycle counts, monthly activity, and genre breakdown from existing library data. Missing or invalid dates create no history. Phone order is title → recap → year selection → selected-year content.

- **CAP-15 — Play Next**
  - **intent:** Offer up to three varied, explainable suggestions from current library facts with tuning, shuffle, and direct actions.
  - **success:** Games with known future release dates and `Playing`/`Platinum`/`Dropped` candidates are excluded; unknown release dates remain eligible. Missing facts contribute no invented evidence. Exact intent matches lead; relaxed results say `Closest match`. Surprise me includes at most one Finish them candidate unless requested; wishlist discovery is optional. Draft tuning preserves picks until applied. Shuffle avoids visit repeats and explains exhaustion; detail travel preserves visit state. Play this uses the guarded lifecycle mutation and returns to Shelf on success. No external recommendation service or persisted preference state is added. Exact groups and ranking rules remain in adopted UX/architecture companions (FR-53..63, AD-34).

- **CAP-16 — PlayStation platform preferences**
  - **intent:** Limit interactive title matches to the user's selected PlayStation platforms.
  - **success:** The selected platform set must contain at least one platform and no duplicates; it defaults to PS1–PS5; PSP, PS Vita, PSVR 1, and PSVR 2 are optional. Released-on semantics apply, not backward compatibility. Save refreshes candidate caches without filtering existing rows or scheduled by-ID refreshes. Exact contract: adopted platform-filter companion.

- **CAP-17 — Permanent account deletion**
  - **intent:** Let a user deliberately remove their account and private library/settings after renewed email verification.
  - **success:** Confirmation sends a five-minute single-use user-bound link requiring a valid same-user session. Verification atomically removes private rows and database sessions, retaining shared facts and other users. Caller caches clear and Login appears; other-device signed-cookie-cache access remains bounded by five minutes. Invalid links and email/deletion failures preserve private data. Exact contract: adopted deletion companion.

## Constraints

- **Free-tier stateless hosting:** shared catalog storage and scheduled refreshes must fit the adopted budget; architecture owns runtime and resource accounting.
- **No credentialed PSN automation:** anonymous store browsing only; no NPSSO/cookie storage, account-attributed sync, trophy retrieval, or direct claim writes.
- **Stored facts on read paths:** application reads use persisted facts; images may load from persisted cover URLs. Metadata provider calls belong to discovery, ingest, or background refresh.
- **Preserve user tracking:** ingest/refresh never overwrites user-entered status, dates, milestones, or genres on existing records. Automatic dates are write-once; deliberate edits, discard/revive, membership cancellation, and verified account deletion are distinct user actions.
- **Explicit acquisition source:** purchased and membership-acquired games may be owned; format (`physical`/`digital`) differs from source (`purchase`/`membership`). Cancellation un-owns membership rows without altering purchases or recorded dates.
- **Compute derived state:** effective state, released, wishlisted, and playable-now derive from stored inputs. Regional membership derives from the shared snapshot; do not restore global per-game flags.
- **Separate genres:** library genres originate in IGDB and remain editable per game; catalog facets retain the PS-store vocabulary. Notion Category is not imported.
- **Explicit failure semantics:** preserve standing data on provider failure and surface actionable lookup/enrichment failures. PS+ failures use timestamp/log visibility; score-refresh failures retain their notice. Scheduled recovery is bounded by architecture; no blanket ban on scheduled retries applies.

## Non-goals

- Credentialed PSN library/trophy automation or automatic observation of external Claim success.
- Non-PlayStation tracking, automatic additions from catalog availability, personal ratings/playtime tracking, or a genre merge/rename tool.
- Gamification: XP, streaks, or reward badges; factual completion indicators remain milestones.
- Roles, sharing, or separate tenant infrastructure beyond user-scoped private records.
- Sale detection/notifications or selectable PS+ subscription tiers; Extra remains supported.
- An offline-data guarantee, external/LLM recommendations, or persistent Play Next preferences.

## Success signal

The Notion tracker can be archived: the seeded record is trustworthy and deliberate manual additions keep it current; status edits and phone wishlist capture take seconds; regional PS+ awareness informs purchases; filtering and explainable Play Next help choose games. No automatic detection of new purchases is promised. This remains an outcome to demonstrate, not a claim that source inspection proves it occurred.

## Known implementation gaps

Architecture AD-31 retains two approved targets not delivered in baseline 3.6.0: activity/stale-refresh triggers beyond Shelf GET (DW-15), and full-idle-cycle regional dataset cleanup (DW-16). The adopted architecture companion links their tracked work and distinguishes current behavior. This spec reconciliation does not declare those targets implemented or authorize their removal.
