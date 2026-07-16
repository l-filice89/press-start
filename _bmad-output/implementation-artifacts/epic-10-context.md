# Epic 10 Context: Know Before You Play — Scores & Expiry Warnings

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Add three decision-support signals so the shelf helps pick what to play (or buy) next, not just remember it: critic and user scores, time-to-beat (story and 100%), and a warning when a backlog game leaves the PS+ Extra catalog. All three are stored facts refreshed on a schedule — never fetched at render time. Sequencing: Story 10.2 diffs the PS+ catalog snapshot Epic 7 builds, so it follows Epic 7; Stories 10.1 and 10.3 have no Epic 7 dependency and are pullable ahead alone (10.3 follows 10.1, whose refresh job it extends).

## Stories

- Story 10.1: Critic & user scores on every game
- Story 10.2: "Leaving PS+ Extra soon"
- Story 10.3: Time to beat — the story, and 100%

## Requirements & Constraints

- **Nothing external on render.** Scores, hours, and catalog-membership warnings render from persisted data only; third-party APIs are hit only by ingest/refresh jobs. A fetch in a query path is an architecture violation.
- **Free tier is a hard constraint.** One Worker invocation has a 50-external-subrequest budget; any all-library refresh must be batched/chunked (resumable-cursor pattern), never one subrequest per game per run, and must share one cron — scores and time-to-beat refresh in the same scheduled pass, not two competing jobs.
- **Failures surface, never silently retry.** A failed scheduled refresh shows a notice on next app open (the same posture as the existing "PS+ catalog as of {date}" timestamp + attention banner); stale data must never silently pass as current.
- **Never fabricate data.** Missing score or time-to-beat values are absent — no zeros, no estimates, no completionist figure standing in for the story figure. Sample/submission counts are persisted and available, so a value backed by 3 data points doesn't read like one backed by 300.
- **Coverage checks come first.** The first task of 10.1 and of 10.3 measures how many of the library's ~175 real titles actually carry the IGDB fields, and records the result (10.3's finding next to 10.1's). Fallbacks are named, not assumed: OpenCritic for scores, HowLongToBeat for time-to-beat — each only if IGDB proves thin, each as a second adapter behind the same provider port. RAWG is out. HLTB's cost is known up front: unofficial endpoint that breaks on rebuilds, title-based matching (no shared id).
- **The 10.2 warning never guesses.** Sony publishes no departure dates; the warning is grounded in observables — a game that *left* the catalog while still in the backlog. A predictive "leaving soon" is claimed only if the ingest genuinely exposes an end date; shipping as "left the catalog" is the correct outcome, not a degraded one (non-goal: automating anything Sony's API can't give reliably).
- **Epic 11 constraint (data sources):** the app makes no credentialed PSN call — the PSN provider is anonymous store-browse only. Epic 10 must not reintroduce any credentialed or account-attributed data source; its sources are IGDB (existing Twitch OAuth2 client credentials) and the anonymous PS+ catalog snapshot.

## Technical Decisions

- **IGDB is the source for both new signals — no new adapter, no new credentials.** Scores: `aggregated_rating`/`aggregated_rating_count` (critic) and `rating`/`rating_count` (user) requested on the *same* `/games` call the existing IGDB provider already makes for covers/genres/release dates. Time-to-beat: `/game_time_to_beats` returns `normally`/`completely`/`count` keyed by `game_id`, joined on the `igdbId` already stored on every enriched game — **no fuzzy title matching**.
- **All external I/O through provider ports; all persistence through repositories** (Drizzle/D1). New fields follow attribute ownership: shared fetched facts (scores, hours) belong with the game's catalog facts, not per-user tracking state.
- **Refresh is a Cron Trigger** aligned with the existing scheduled work; chunked walk of the library within the subrequest budget.
- **10.2 diff mechanics:** the `ps_plus_catalog` table holds the region's current snapshot, populated and pruned by the monthly refresh (single fetch feeds both snapshot and flag pass; empty-catalog wipe guard aborts before any prune). The previous snapshot must be retained long enough to diff — present-before, absent-now = left the catalog. The catalog is per-region.
- **Known trap (DW-13):** `ps_plus_catalog.first_seen_at` currently means "first seen since the last prune" — a pruned-then-readded game reads as new. Story 10.2 must first decide and document what `first_seen_at` means for the warning (fix or rename the column if needed); the diff must not treat a returning game as a new arrival.
- **Flag discipline already exists:** a game leaving the catalog clears its PS+ pill (both-directions refresh) and stops counting as Playable-now; the 10.2 warning is the human-facing half of that existing flag change. Membership reads go through the single core membership function, never a hand-rolled join.

## UX & Interaction Patterns

- Scores and time-to-beat show on both the card and the detail view, from stored data. Time-to-beat is labelled so **story** vs **100%** is unmistakable, shown next to the scores, with submission counts available.
- The "leaving soon"/"left" warning must be visually distinct from the steady-state PS+ Extra pill (reuse the existing pill/badge system rather than inventing a new one).
- No warning on owned games — ownership makes catalog membership irrelevant; the PS+ flag is hidden the moment a game is owned.
- Failed-refresh notices reuse the existing attention-banner channel (persistent under-header zone, self-clears when resolved).

## Cross-Story Dependencies

- 10.3 depends on 10.1: it extends the same fields-on-`/games` habit and rides 10.1's scheduled refresh job (one cron, one chunked walk).
- 10.2 depends on Epic 7 Story 7.1's `ps_plus_catalog` snapshot and its monthly refresh; 10.1 and 10.3 do not.
- 10.2 inherits the both-directions PS+ flag behavior (Epic 5) and the ownership-hides-flag rule.
- Epic 11 (shipped) removed all credentialed PSN paths; Epic 10 builds only on IGDB and the anonymous catalog.
