# Epic 10 Context: Know Before You Play — Scores & Expiry Warnings

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Put three decision-support signals on every game so the shelf helps choose what to play or buy next, not just remember it: critic and user scores (what the world thinks), time-to-beat for the story and for 100% (how much life it costs), and a pre-departure warning for backlog games about to leave the PS+ Extra catalog. All three are stored and refreshed on a schedule — never fetched on render. Sequenced after Epic 7 (the PS+ warning diffs the catalog snapshot Epic 7 builds); the scores and time-to-beat stories carry no such dependency and are pullable ahead alone.

## Stories

- Story 10.1: Critic & user scores on every game
- Story 10.2: "Leaving PS+ Extra soon"
- Story 10.3: Time to beat — the story, and 100%
- Story 10.4: Leaving PS+ soon — the "Last Chance to Play" category (VR-6 rework)
- Story 10.5: Scores in the add-game modal, color-graded everywhere

## Requirements & Constraints

- **Nothing external on render.** Scores, hours, and catalog-membership warnings render from persisted data only; third-party APIs are hit only by ingest/refresh jobs. A fetch in a query path is an architecture violation.
- **Free tier is a hard budget.** All bulk refresh work is batched/chunked over the ~175-game library — never one subrequest per game per run. Scores and time-to-beat refresh in the same scheduled pass: one cron, one chunked walk, not two jobs competing for the same budget. The 10.4 last-chance fetch rides the existing monthly PS+ pass, with the budget ledger updated honestly.
- **Failures surface, never silently retry.** A failed scheduled refresh shows a notice on next app open; stale data must never pass as current.
- **Never fabricate data.** A game with no score or no TTB value renders no slot — never a zero, a gray placeholder, or an estimate; a 100% figure never silently stands in for the story figure. Sample/review counts and submission counts are persisted and available — a value backed by 3 data points must not read like one backed by 300.
- **Coverage checks come first.** The first task of 10.1 and 10.3 measures how many of the library's real titles actually carry the IGDB fields, and records the result (10.3's finding next to 10.1's). Fallbacks are named, not assumed: OpenCritic for scores (RAWG is out), HowLongToBeat for TTB — each only if IGDB proves thin, each as a second adapter behind the same port. HLTB's cost is known up front: unofficial endpoint that breaks on rebuilds, title-based matching (no shared id).
- **The PS+ warning never guesses.** Sony publishes no departure dates, so the warning is grounded only in observables. Story 10.2 shipped the honest post-departure outcome ("left the catalog"); Story 10.4 upgrades to a real pre-departure signal via the store's "Last Chance to Play" category. 10.4's first task probes the category id for the configured region and verifies a plausible grid; if it doesn't exist for `it-it`, HALT for a decision.
- **Ownership silences catalog warnings.** The PS+ flag and any leaving/left signal apply to tracked, non-owned games only and are hidden the moment a game is owned; a departed game's flag clears (both-directions discipline) and the game stops counting as Playable-now.
- **Epic 11 constraint:** the app makes no credentialed PSN call — Epic 10 must not reintroduce any credentialed or account-attributed data source. Its sources are IGDB (existing credentials) and the anonymous PS+ catalog endpoints.

## Technical Decisions

- **IGDB is the source, no new adapter, no new credentials.** Scores: `aggregated_rating`/`aggregated_rating_count` (critic) and `rating`/`rating_count` (user) requested on the *same* `/games` call the `IgdbProvider` already makes for covers/genres/release dates. Time-to-beat: `/game_time_to_beats` (`normally`, `completely`, `count`) joined on the `igdbId` already stored — **no fuzzy title matching**.
- **All external I/O through provider ports; persistence through repositories.** Any fallback adapter sits behind the same port as the primary. New fields follow attribute ownership: shared fetched facts (scores, hours) live with the game's catalog facts, not per-user tracking state.
- **Refresh is a Cron Trigger** aligned with the existing scheduled work, chunked within the subrequest budget.
- **PSN surface stays anonymous.** The 10.4 last-chance grid uses the same public, credential-free `categoryGridRetrieve` endpoint the catalog sync already calls (different category id) — EXTERNAL-RISK posture unchanged.
- **Catalog diff mechanics (10.2/10.4):** `ps_plus_catalog` is per-region; the monthly refresh retains the previous snapshot long enough to diff (present-before, absent-now = left). The empty-catalog wipe guard (200 with zero products = provider failure) hard-aborts before any prune or clear. Known trap DW-13: `first_seen_at` means "first seen since last prune", so a pruned-then-readded game reads as new — the diff must not treat a returning game as a new arrival.
- **Stamp disposition (10.4):** the shipped `ps_plus_left_on` post-departure stamp survives only as a quiet internal fact (cleared when a game re-enters the catalog); the LEFT-PS+ pill is replaced by the leaving-soon warning.

## UX & Interaction Patterns

- Scores and TTB show on card and detail view from stored data; TTB labelled so **story** vs **100%** is unmistakable, next to the scores, submission counts available. TTB is explicitly excluded from the add-game modal ("never a decision breaker when I add a game").
- Add-modal candidate rows — and the rematch/straggler candidate lists, which share the shape — show critic + user scores from data already in the response; no new fetch.
- Score color grading everywhere scores render (card, detail, candidate rows): ≤60 red, 61–74 yellow (warn-amber family), ≥75 green — WCAG AA contrast on the dark theme, never color-only (the number is always present; sr-only text unchanged).
- The leaving-soon warning is visually distinct from the steady-state PS+ Extra pill; reuse the existing pill/badge system rather than inventing a new one.
- No warning on owned games, ever.
- Failed-refresh notices reuse the existing attention-banner channel.

## Cross-Story Dependencies

- 10.2 and 10.4 depend on the Epic 7 `ps_plus_catalog` snapshot and monthly cron; 10.4 reworks 10.2's post-departure outcome (judged low-value) into a pre-departure warning.
- 10.3 depends on 10.1 — same fields-on-`/games` habit, same scheduled refresh job.
- 10.5 builds on 10.1's persisted scores and the shared candidate-row shape across add/rematch/straggler pickers.
- Epic 11 precedes this epic: anything touching the PSN provider must respect its anonymous-only surface.
