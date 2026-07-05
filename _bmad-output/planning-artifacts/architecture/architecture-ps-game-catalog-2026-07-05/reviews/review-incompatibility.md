---
title: Adversarial Incompatibility Review — Architecture Spine (PRESS START / PS Game Catalog)
type: architecture-review
method: incompatible-pair construction
reviewer: adversarial (spine attack)
target: ARCHITECTURE-SPINE.md (2026-07-05, draft)
created: 2026-07-05
verdict: PASS-WITH-FIXES (two CRITICAL holes are blocking-until-closed for parallel work)
---

# Adversarial Incompatibility Review

## Method

For each hole I construct two units one level down — two epics/stories that independent
developers could build — that **each obey every ADOPTED AD to the letter** yet produce
artifacts that cannot be linked: clashing schema shapes, two owners of one attribute,
conflicting state-mutation side-effects, or divergent readings of an underspecified rule.
Every such pair is a gap the spine does not close; each is paired with a **new or tightened
AD** that would close it.

The spine's paradigm (layered + two ports-and-adapters seams, I/O-free core, single
effective-state function, append-only write guard) is sound and most ADs are tight. The
holes below are almost entirely in the **data model** — the one place the spine deliberately
under-specifies ("attribute-level rules are ADs, not this diagram"), but where several
attribute-level rules were never actually written as ADs. Two of them are schema-shape
decisions (a PK and a UNIQUE constraint) that two developers will decide oppositely and
irreversibly.

---

## CRITICAL-1 — `GAME_TRACKING` cardinality: the ERD says 1:1, AD-13 needs 1:many

**The clash.** The Structural Seed ERD declares:

```
USER  ||--o{ GAME_TRACKING : owns
GAME  ||--|| GAME_TRACKING : "has (per user)"
```

`GAME ||--|| GAME_TRACKING` reads as **exactly one** tracking row per game. But AD-13 ("every
tracking row is user-scoped … from row one, the multi-user seam") and FR-48 require that the
day a second user exists, one `GAME` can have **one tracking row per user** — i.e. one-to-many.
The two cardinalities are contradictory in the same document, and the label "(per user)" on a
`||--||` edge does not resolve which one binds.

**Pair built to the letter.**

- *Unit A — Seed-import epic (AD-9/10/15).* The dev reads `GAME ||--|| GAME_TRACKING` literally
  and models tracking as a 1:1 extension of game identity: `game_tracking.game_id` is the
  **primary key** (or `UNIQUE`), no `user_id` in the key. AD-13 is satisfied at the letter by
  adding a `user_id` **column** that the single seed run fills with the one user's id — a column,
  not a key component. Every query filters by it (AD-13 honored).
- *Unit B — Auth & user-seam epic (AD-13, FR-47/48).* The dev models the seam properly:
  `PRIMARY KEY (user_id, game_id)`, many tracking rows per game. AD-13 honored identically.

Both satisfy AD-13 verbatim ("every row carries `user_id`; every query filters by it"). They
produce **incompatible schemas**: A's `game_id`-unique table cannot hold B's second-user row;
B's composite key breaks A's `game_id` foreign-key assumptions and any `findTrackingByGame(gameId)`
repository method A wrote (which returns one row for A, many for B). A migration written against
one shape corrupts the other.

**Why the spine doesn't catch it.** AD-13 pins the *scoping rule* but is silent on the *key
shape*; the ERD asserts a cardinality that contradicts the rule. Nothing says "the seam is a key,
not a column."

**Close it — new AD-17 (tighten AD-13 + correct the ERD).**
> `GAME_TRACKING` is keyed `PRIMARY KEY (user_id, game_id)` — one row **per user per game**. The
> ERD edge is corrected to `GAME ||--o{ GAME_TRACKING`. `user_id` is a key component from row one,
> never a fill-column on a `game_id`-unique table. Repository read methods for tracking are
> `(user_id, game_id)`-addressed; no method assumes a single tracking row per game.

Severity **CRITICAL**: it is a primary-key decision made oppositely by two epics, irreversible
without a data migration, and it is an internal contradiction already present in the spine.

---

## CRITICAL-2 — `title_normalized` uniqueness: AD-9 implies unique, FR-34 forbids it

**The clash.** AD-9 declares the normalizer output "the **only** title-matching key, shared by
every ingest and search path." A "match key" that is "the only key" reads as a **unique,
dedupe-on** key. But FR-34 explicitly says "two distinct games can normalize to the same name"
and mandates that a title-match onto a game carrying a *different* external-ID be **flagged, not
merged** — which is only representable if two distinct `GAME` rows may share one
`title_normalized` (a **non-unique** column).

**Pair built to the letter.**

- *Unit A — Add-by-name epic (AD-9, FR-42).* "Search also matches the existing library; picking a
  tracked game opens its detail instead of creating a duplicate." The dev implements dedupe by
  looking up `GAME` on `title_normalized` and, to guarantee "never a duplicate," adds
  `UNIQUE (title_normalized)`. Fully honors AD-9 ("the only match key") and FR-42.
- *Unit B — PS-sync matching epic (AD-9/10, FR-34).* Implements "two distinct games can normalize
  to the same name → flag, don't merge." Requires `title_normalized` **non-unique** and a second
  discriminator (external-ID). Fully honors AD-9 (still the only *title* key) and FR-34.

A's `UNIQUE` constraint makes B's core scenario (insert a second game with a colliding normalized
title, then flag) throw a constraint violation at insert time — the sync cannot even represent the
state it is required to flag. Remove the constraint and A's dedupe becomes ambiguous (which of two
same-normalized games does the search open?). The two epics cannot share one schema.

**Compounding layer confusion.** `GAME` is shared/global (not user-scoped); a `UNIQUE
(title_normalized)` there is a **global** constraint, but FR-42's dedupe ("my library") is a
**per-user** notion living at `GAME_TRACKING`. A picks the wrong altitude for the constraint even
before the FR-34 conflict.

**Close it — new AD-18 (tighten AD-9).**
> `title_normalized` is a **non-unique** match *candidate* key, never a uniqueness constraint.
> Game **identity** is anchored on external-ID links (AD-20), not on the normalized title. The
> match pipeline is ordered: (1) stored external-ID/alias link (FR-29/34), then (2) normalized
> title as a *candidate*, disambiguated by external-ID; a normalized-title collision with a
> differing external-ID is a **needs-attention flag**, never a merge and never a constraint error.
> Add-by-name dedupe (FR-42) resolves against the current user's tracked games, not a global
> unique title.

Severity **CRITICAL**: a `UNIQUE` constraint decision, opposite between two epics, and directly
contradicted between AD-9 and FR-34 as written.

---

## HIGH-3 — Game-fact attributes have no assigned table: `cover_url` / `store_url` / `release_date` / PS+Extra flag

**The clash.** The ERD lists only `title_normalized` on `GAME` and the tracking columns on
`GAME_TRACKING`. It names **no home** for `cover_url`, the PS-Store `store_url`/product-id,
`release_date`, or the **PS+ Extra flag** — yet AD-6/FR-35 persist covers and store URLs, FR-12
compares `release_date`, and FR-38 sets/clears a PS+ Extra flag. AD-10's append-only guard
protects only "status, milestones, dates, genres" — **covers, store URL, and release date are
explicitly unprotected**, so their table placement decides who may overwrite them.

**Pair built to the letter.**

- *Unit A — Seed/enrich epic (AD-9/15).* Treats cover, release date, store URL as objective game
  facts → columns on the shared `GAME`. Reasonable, and untouched by AD-10 (those fields aren't in
  its protected list).
- *Unit B — PS-sync epic (FR-35).* "Cover art and the PS Store product URL are **captured at sync
  time** and persisted." Sync is a **per-user** operation (runs on the logged-in user's cookie).
  The dev persists cover + store URL on `GAME_TRACKING` (the per-user, sync-owned table).

Now the card renderer (a third unit) must read the cover from *one* place. A wrote it to `GAME`,
B to `GAME_TRACKING` — **two owners of one attribute**, render reads the wrong (empty) one.
Worse, if both land on shared `GAME`, then in multi-user user-B's sync silently overwrites the
cover user-A sees, and AD-10 does **not** forbid it (cover isn't a protected field) — a
cross-user mutation the append-only guard was assumed to cover but doesn't.

**The PS+ Extra flag is the sharpest instance.** FR-38: the flag is **per-region**, runs against
"the user's account region," and is "ignored/hidden the moment a game becomes owned" (owned is
per-user). So the flag is unavoidably **per-user → `GAME_TRACKING`**. But a dev reading "the
catalog is a property of the game" puts it on `GAME`. And it collides with AD-8: AD-8 lists
"Playable-now = owned-or-in-PS+Extra AND released" as **computed, never persisted**, while FR-38
**sets/clears** the flag — so the PS+Extra membership is a **stored input** to a derived state,
not itself derived. A dev who reads AD-8 as "PS+Extra is derived, don't store it" builds no column
at all and cannot implement FR-38's flag persistence.

**Close it — new AD-19 (attribute-ownership split) + tighten AD-8/AD-10.**
> Define the table each attribute lives on. **`GAME` (shared identity + objective enrichment):**
> `title_normalized`, `cover_url`, `release_date`, `store_url`/product-id, genre links, external
> links — global game facts, written by seed/enrich/sync as *last-writer-wins enrichment*, never
> per-user. **`GAME_TRACKING` (per-user state):** play status, milestones, lifecycle dates,
> ownership flag+type, and the **PS+ Extra flag** (per-user, region-scoped, hidden when owned).
> AD-10's append-only guard is extended to state that enrichment fields on `GAME` are *not*
> user-entered data and may be refreshed, but no ingest may move a per-user field onto `GAME`.
> AD-8 is clarified: PS+Extra **membership is a stored external fact** (input); *Playable-now* is
> the thing computed from it and is never stored.

Severity **HIGH**: two owners of `cover_url`, an omitted-but-required PS+Extra column, and an
AD-8/FR-38 stored-vs-derived contradiction.

---

## HIGH-4 — `EXTERNAL_LINK` cardinality per source: AD-9 collapse creates the exact state FR-34 flags as a conflict

**The clash.** AD-9 mandates "collapse PS4/PS5 → one PS5" game. But a PS4 edition and a PS5
edition each have a **distinct PSN identifier** (concept/product id). Collapsing them onto one
`GAME` therefore attaches **two PSN `EXTERNAL_LINK` rows** to that game. Meanwhile FR-34 treats "a
title-matched game that already carries a *different* external-ID link" as a **needs-attention
conflict**. The collapse AD-9 requires manufactures precisely the "different external-ID on the
same game" condition FR-34 is written to flag.

**Pair built to the letter.**

- *Unit A — Seed collapse epic (AD-9).* Stores both PS4 and PS5 PSN ids as two `EXTERNAL_LINK`
  rows on the single collapsed `GAME`. Models `EXTERNAL_LINK` as **many-per-(game, source)**.
- *Unit B — Sync matching epic (FR-34).* Reads FR-34 as "one external-ID per (game, source)"; when
  the PS4 id arrives and the game already carries the PS5 id, it either (a) raises a spurious
  needs-attention conflict on every collapsed game, or (b) rejects the second link because its
  repository assumes `UNIQUE (game_id, source)`.

A's data (two PSN ids/game) is unrepresentable in B's schema and mis-classified by B's conflict
logic. The permanence rule FR-29 ("a manual match is permanent … never re-add as a duplicate")
also depends on which model wins: under B, the second edition keeps re-flagging forever.

**Close it — new AD-20 (external-link cardinality + FR-34 conflict definition).**
> `EXTERNAL_LINK` is **many-per-(game, source)**: a collapsed game legitimately holds multiple PSN
> ids (PS4 + PS5). FR-34's conflict is redefined precisely: a needs-attention flag fires **only
> when one external-ID already resolves to a *different* `GAME`** (id-to-two-games), never when a
> game merely gains an additional id for the same title. External-ID is the identity anchor
> (per AD-18); matching order is external-link → normalized title.

Severity **HIGH**: AD-9's required transformation is directly at odds with FR-34's conflict rule,
and it is a `UNIQUE (game_id, source)` decision two epics will make oppositely.

---

## HIGH-5 — Milestone-logging's status side-effect is not owned by any AD; two log paths diverge

**The clash.** FR-2: "Logging a completion milestone **auto-clears the status to null**." This is
a **state mutation** (a write to `play_status`), not a computation. AD-7 governs only the
*computation* of effective state ("computed in one place"); AD-12 governs only the *invariant*
(must have status **or** milestone). **No AD owns the auto-clear side-effect** — so two units that
both log milestones can implement the side-effect differently and both pass every AD.

**Pair built to the letter.**

- *Unit A — Status-popover milestone logging (EXPERIENCE "Status pill" → confirm modal).* On
  logging `platinum_on`, sets `play_status = null` (FR-2). Effective state (via AD-7) → "Platinum."
  Consistent with AD-7/12.
- *Unit B — Detail-view milestone logging (EXPERIENCE "Detail (flip)": holds a play-status
  segmented control **and** milestone rows).* The dev, seeing an explicit status control the user
  manages, logs `platinum_on` but **leaves `play_status` = "Playing"** (a legitimate replay-looking
  state per FR-2, which says a replay *sets* Playing back). AD-12's invariant still holds (has both).
  AD-7 still computes correctly — it just yields "Playing," because status wins.

Same user action (log Platinum) → effective state "Platinum" via the pill, "Playing" via the
detail view. The two surfaces disagree on the game's state — the exact outcome AD-7 was written to
prevent — yet AD-7 is fully obeyed by both, because the divergence is in the **write side-effect**,
not the read computation. Ordering (FR-18), the "hidden by default" set (FR-17), and the shelf's
visibility all flip depending on which path the user used.

**Close it — new AD-21 (single milestone-reconciliation function in core).**
> The status side-effect of logging a milestone is a single pure `core/` reconciliation function
> (e.g. `applyMilestone(state, milestone)`) that returns the next `{play_status, milestones}` — it
> nulls `play_status` on a first completion per FR-2 — and **every** write path (status popover,
> detail view, sync-driven, replay) calls it. No route or component computes the post-log status
> inline. Symmetric to AD-7 for reads: AD-7 owns "compute effective state in one place," AD-21 owns
> "compute the milestone-write transition in one place."

Severity **HIGH**: a conflicting state-mutation path that makes two UI surfaces disagree on the
canonical state, defeating the intent of AD-7 through a seam AD-7 doesn't cover.

---

## MEDIUM-6 — The "straggler" has no defined entity shape; import and add-by-name mean different things by it

**The clash.** Two flows deposit into "stragglers," but the object each deposits is structurally
different, and nothing in the spine defines a straggler entity.

- *Import stragglers (FR-28/30).* "Unmatched or ambiguous titles" and rows the mapping can't place.
  These are **not yet any `GAME`** — they carry **pending Notion data (status, dates, owned)** that
  FR-28 says is *carried onto the matched game* only at resolution. Shape: a **staging row** holding
  unapplied source data, keyed by raw title.
- *Add-by-name stragglers (FR-41).* A **saved, real** `GAME`/`GAME_TRACKING` (FR-41: "nothing is
  committed until Save," then it saves) that merely **lacks enrichment** (no cover/genres). Shape:
  a real game flagged `needs_enrichment`.

**Pair built to the letter.**

- *Unit A — Add-by-name epic (FR-41).* Models a straggler as `GAME.enrichment_status = 'pending'`;
  the stragglers list is `SELECT games WHERE enrichment_status='pending'`; resolving = fill
  cover/genres on an existing game.
- *Unit B — Seed-import epic (FR-28/30).* Models a straggler as rows in a `import_straggler`
  staging table carrying the Notion status/dates/owned payload; resolving = *find or create* the
  game **and apply** the carried payload (FR-28) and store the permanent alias (FR-29).

Both feed the one "Stragglers" surface (EXPERIENCE IA table) and one resolution flow. A's resolver
(enrich an existing game) cannot apply B's carried Notion payload; B's resolver (create + apply)
would duplicate A's already-saved game. The single UI cannot render two entity shapes, and the
single resolution action can't do both jobs.

**Close it — new AD-22 (straggler is one defined staging entity).**
> Define a single `STRAGGLER` entity: `{ id, user_id, source (notion|ps|add-by-name), raw_title,
> pending_payload (nullable Notion status/dates/owned), resolved_game_id (nullable) }`. Add-by-name
> saves a real game **and** may leave a `STRAGGLER` with `resolved_game_id` set +
> `pending_payload = null` (enrich-only). Import creates `STRAGGLER` rows with `pending_payload`
> and `resolved_game_id = null`. Resolution is one flow: match/create the game, apply
> `pending_payload` if present (FR-28), store the permanent alias (FR-29), clear the straggler.
> Enrichment status of a game is **not** overloaded to mean "straggler."

Severity **MEDIUM**: reconcilable, but two epics will otherwise ship two incompatible straggler
models behind one UI and one resolver.

---

## Confirmed coherent (attacked, held)

- **`owned` / `ownership_type` on `GAME_TRACKING`, set by sync.** Per-user ownership set by a
  per-user sync is coherent — *provided* CRITICAL-1 lands (composite key). The placement itself is
  right; only the cardinality of the table it sits on is the problem.
- **AD-10 membership filter vs FR-38 PS+ flag.** No clash on the *rule* (skip claims at ingest;
  flag catalog availability on non-owned tracked games). The only gap is where the flag is stored
  (HIGH-3), not the two-path logic — one skips, one flags, on deliberately different data.
- **AD-11 write-once dates + `started_on` "only while no completion milestone."** Tight; the only
  adjacent risk is the milestone side-effect (HIGH-5), which is about `play_status`, not the dates.
- **AD-7 effective-state single function** and **AD-8 no stored derived flags** are internally
  clean; their only exposure is the PS+Extra stored-input ambiguity folded into HIGH-3.

---

## Verdict

**PASS-WITH-FIXES.** The paradigm and the sixteen behavioral ADs are sound; the incompatibilities
are concentrated in attribute-level data-model decisions the spine explicitly deferred but never
turned into ADs. **CRITICAL-1 (tracking PK) and CRITICAL-2 (title uniqueness) are
blocking-until-closed for parallel development** — they are a primary-key and a UNIQUE-constraint
decision that two epics will make oppositely and that are already self-contradictory in the
document (ERD vs AD-13; AD-9 vs FR-34). Close AD-17 and AD-18 before any two units touch the schema
in parallel. HIGH-3/4/5 and MEDIUM-6 should be closed with AD-19..22 before the corresponding
epics start, but do not contradict the spine internally the way the two criticals do.

Proposed new/tightened ADs: **AD-17** (tracking PK / ERD fix), **AD-18** (title non-unique +
identity anchor), **AD-19** (attribute-ownership split; extend AD-8/AD-10), **AD-20** (external-link
cardinality + FR-34 conflict definition), **AD-21** (single milestone-write reconciliation
function), **AD-22** (defined straggler staging entity).
