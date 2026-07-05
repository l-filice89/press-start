---
title: 'Product Brief: ps-game-catalog'
status: complete
created: 2026-07-04
updated: 2026-07-05
---

# Product Brief: ps-game-catalog

## Executive Summary

ps-game-catalog is a personal web app that replaces the Notion database Luca uses to track his PlayStation gaming life — what he owns, wants, is playing, and has finished. Notion works, but only as hard as Luca does: every update is manual entry, so the tracker drifts from reality and games get bought and forgotten. The core move is a library that fills itself: an append-only sync with the PlayStation library, one name-search to add anything else, and a PS+ Extra check on every non-owned title — because a game sitting in that catalog is playable today, no purchase needed.

The experience is a single cover-art-forward shelf in the spirit of Steam's Big Picture: minimal cards that flip into full editable detail, ordered by what's Playing, Paused, and Up next, narrowed by one-tap filter pills. Hosted for free behind a simple login, it's reachable from the phone at the moment a game is discovered — the moment Notion always missed. Quietly, every status change records its date, banking the history that future versions will spend on play-next suggestions and stats.

Success has exactly one metric: the Notion database gets archived and never reopened. This is deliberately Luca's own tool — built rather than adopted because no existing tracker syncs a PlayStation library or knows what's on PS+ Extra, and because owning every bell and whistle is the point. It stays personal for now, with the door consciously left open to becoming something worth sharing.

## The Problem

"Games I bought and forgot is the mantra."

Luca's gaming life lives in a Notion database — 169 tracked games with status, ratings, genres, and dates. It works, but every fact in it arrives by hand: buying a game, starting one, finishing one, spotting something interesting — each means opening Notion and editing rows. Meanwhile, the actual source of truth for what he owns (his PlayStation library, 175 games and growing monthly through PS+) drifts out of sync with what Notion claims.

The costs are concrete and recurring:

- **Bought-and-forgot games.** Titles enter the library — purchases, PS+ monthly drops — and vanish from awareness because logging them is a chore that doesn't always happen.
- **Wishlist amnesia.** Games he wanted get rediscovered months later, sometimes after the moment (a sale, a mood) has passed. Adding a game to Notion is taxing enough that updates happen in batches every few months — not at the moment of discovery, which is the only moment that counts.
- **A blind spot on PS+ Extra.** A game in the PS+ Extra catalog is practically owned — but nothing today tells him a wishlist title is sitting there, playable right now, before he pays for it.
- **An untrustworthy "what next?" moment.** After finishing a game he filters the Notion backlog by owned and genre — but a backlog that's missing games and carries stale wishlist entries can't fully answer the question it exists for.

The status quo isn't broken enough to abandon tracking, but it taxes every interaction with maintenance work — and a tracker that's only mostly right slowly stops being consulted at all.

## The Solution

A dedicated, self-hosted library app that replaces the Notion database with something that maintains itself where it can and gets out of the way where it can't.

**The library fills itself.** Syncing with the PlayStation library is the core move: new purchases and PS+ drops appear in the catalog without Luca typing anything. Sync only ever adds — status, ratings, and dates he's entered are never touched. Manual entry shrinks to the things only he knows: what he's playing, what he thought of it, what he wants next.

**One screen answers "what's my gaming life right now?"** The landing page is the full library, cover-art forward — Steam Big Picture energy, leaning hard on the covers. Each card shows only the essentials: cover, name, genres, owned status, and flag icons (PS+ Extra, release date). Clicking flips the card into the full, editable detail. Playing now sits on top, then Paused, then Up next. A row of quick-filter pills (owned, playing, released, paused, up next, not-owned) narrows the shelf in one tap, combining as OR.

**Adding a game costs one search.** Type the name; cover, genres, and release date arrive automatically from a games database. This attacks the single most taxing moment of the Notion workflow — the data entry that turned tracking into a quarterly batch job instead of a reflex at the moment of discovery.

**The wishlist becomes a buying tool.** Every game carries its release state — a date, or TBA for the unannounced — and a PS+ Extra badge when it's currently in the catalog. The badge is checked against tracked non-owned games only, and it's deliberately a separate state from owned: catalog titles are never auto-added, because catalog games leave. Before spending money, one glance answers: is it out yet, and can I already play it with the subscription I have?

**It lives where he is.** Hosted on a free tier, behind a simple login — magic link to start, Google sign-in later. The moment of discovery usually happens away from the desk; the app has to be reachable from the phone in that moment, or wishlist amnesia comes back.

**Every state change is remembered.** Moving a game between wishlist, owned, playing, completed, and Platinum quietly records the date. Nothing in v1 consumes that history yet — but the future versions that suggest what to play next and chart his gaming year will need it, and it can't be reconstructed later.

## Why Build Instead of Adopt

Backlog trackers exist — Backloggd, HowLongToBeat, and friends. None of them sync a PlayStation library, none know what's on PS+ Extra right now, and none will ever grow exactly the feature Luca wants next. But the honest core is simpler: **this is Luca's tool, with all the bells and whistles he desires, and a platform he can keep extending for as long as it stays interesting.** For a personal project, that isn't a rationalization — it's the requirement.

## Success Criteria

This is a personal tool, so there is exactly one metric that matters: **the Notion database gets archived and never reopened.** That happens when:

- The library can be trusted — every owned game is present without Luca having entered it ("bought and forgot" becomes impossible).
- Logging a status change takes seconds, not a Notion-editing session.
- The wishlist is consulted before purchases — because it's current, and because the PS+ Extra badge makes it useful.
- Filtering the backlog beats what Notion's views offered.

## Scope

**v1 — retires Notion.** The line is drawn at "kills the manual-entry problem"; everything here serves that.

- One-time import of the existing data (Notion CSV export + PlayStation library export) to seed the database
- PlayStation library sync — append-only: new games arrive automatically, user-entered data is never touched
- Landing page: full library, minimal cards (cover, name, genres, owned status, flag icons), click-to-flip full editable detail, ordered Playing → Paused → Up next, OR-combining quick-filter pills
- Add-by-name: search a games database, everything else (cover, genres, release date) auto-filled
- PS+ Extra check on tracked non-owned games — badge only, never auto-added; user-triggered refresh aligned to Sony's monthly catalog update
- Release state on every game: date or TBA, filterable
- Lifecycle dates recorded automatically on every transition (wishlisted, bought, started, story completed, Platinum) — v1 collects, later versions consume
- Two-level completion: story completed and Platinum achieved are distinct
- Cover art persisted at sync/add time, never fetched on page render
- Hosted on a free tier, stateless app, managed database; login via better-auth magic link

**v1.x — enriches a working app** (explicitly next, not now):

- Trophy sync from PSN with completion % and PSNProfiles-style letter grade
- Critic and user scores (via games-DB sources), stored and refreshed on a schedule
- "Leaving PS+ Extra soon" warnings for backlog games
- Google sign-in

**Future — earns its way in later:** tunable play-next suggestions ("same genre" / "vary genre"), stats and dashboards over the lifecycle history, possibly playtime and other platforms.

**Out for now, door open:** multi-user support and a public release. Not in scope until the app proves itself — but if it comes out looking good and useful, publishing stops being unthinkable. v1 builds nothing for it beyond not welding it shut: login exists anyway, and tracking data hangs off a user rather than assuming there will only ever be one. Still out: non-PlayStation platforms (for now), and automating anything Sony's API can't give reliably.

## Vision

If this works, in two or three years it's simply *the* record of Luca's gaming life — trusted enough that Notion is a memory. Every game carries its full arc: wanted on this date, bought on that one, started, finished, platinum'd. The app that today just shows the shelf starts answering questions: *what should I play next, given my mood? What did my gaming year look like? What's been sitting in the backlog longest?* It grows one bell and whistle at a time, in whatever direction is interesting — because being Luca's own, endlessly extensible tool was the point all along. It never needs to be published, and it never needs to be finished — but if sharing it someday stops being unthinkable, nothing in its design should stand in the way.
