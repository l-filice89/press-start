# Edge-Case Review — PS Game Catalog PRD (finalize pass)

- **Method:** bmad-review-edge-case-hunter (exhaustive path enumeration over §2 state model, §3 filter semantics, §4 ingestion paths). Only unhandled or contradictory state/input combinations are reported; handled paths were walked and discarded silently.
- **Scope:** `prd.md` + `addendum.md`. Findings grounded against the actual Notion export (`Gaming list ..._all.csv`: 169 rows, columns `Title | Category | Date finished | Date started | Owned | Rating | Release date | Status`; statuses exactly the six mapped in §4.1; `Owned` = Yes on 18 rows).
- **Stakes calibration:** single user, one device. No concurrency/i18n/multi-tenant concerns raised.

**Verdict:** The state model is internally sound except for one escape hatch (detail-view milestone editing), but §4.2's blanket append-only rule contradicts §2's "sync sets Owned" for already-tracked games — which breaks the wishlist→purchase flow the product exists for — and the seed-import mapping silently drops the Notion `Owned` column that exists in the real CSV.

---

## Critical

### C1. Sync can never flip `Owned` on an already-tracked game — contradicts §2 and blocks the core wishlist flow

- **Scenario:** Luca adds a game by name (§4.4 → not owned, wishlisted). Weeks later he buys it digitally on the PS Store. He hits the sync button.
- **Why the rules fail:** §4.2 matches the game to its existing row (alias/title match) and then says *"existing rows are never modified or deleted."* So `Owned` is never set. But §2 says *"`Owned` … is set by the PS library sync (source of truth for digital)"*, §4.5 says `bought_on` is auto-recorded when *"owned flips true — via sync"*, and §1's success metric is *"'bought and forgot' becomes impossible."* As written, every game that enters the library as a wishlist item — the product's headline flow — can never become owned except by manual flag, and `bought_on` via sync is unreachable. Two sections give contradictory answers for the same event.
- **Fix direction:** append-only must be scoped to *user-entered* data (status, milestones, dates, genres, ownership *overrides*); sync must be allowed to set `Owned=true` (never false) and stamp `bought_on` on matched existing rows. Same scoping question applies to capturing cover art / PS Store URL on matched rows that lack them (see M5).
- **Severity:** critical — contradictory rules on the core flow; as literally specified, data goes permanently wrong.

## High

### H1. Detail-view milestone edit can produce status = null with no milestone — effective state has no value

- **Scenario:** Game has `completed_on` set and play status null (auto-cleared per §2). Luca opens the detail view — where milestones are explicitly *"editable"* — and clears `completed_on` (logged on the wrong game, fat-finger the confirmation modal allowed through, etc.). `platinum_on` is also null.
- **Why the rules fail:** §2's invariant is *"status may be null once a completion milestone exists (and only then)"*, and the effective-state computation has exactly three branches: status if set, else platinum, else completed. Status null + both milestones null falls through all three — no effective state exists. The game cannot be ordered on the shelf, matches no state pill, and is invisible everywhere except search. A legal edit path violates the model's central invariant, and the PRD specifies no guard (block the clear? restore a status? which one?).
- **Severity:** high — corrupts the state invariant through a documented flow.

### H2. Seed import silently drops the Notion `Owned` column (18 real rows)

- **Scenario:** The actual Notion CSV has an `Owned` column, Yes on 18 games. Some of those (physical discs, delisted titles) will not appear in the PS library export — the exact category §2 says the PS API cannot see.
- **Why the rules fail:** §4.1's mapping enumerates Status, *Date started*, *Date finished*, and Rating (explicitly excluded) — it never mentions `Owned`. Games owned-in-Notion but absent from the PS export therefore land as not-owned → derived *Wishlisted*, with a bogus `wishlisted_on` stamped (§4.5: "added while not owned"). §2's ownership section covers sync and manual flag as the only two `Owned` sources, so the import has no sanctioned way to carry it. Result: owned discs show up on the wishlist, violating §1's "the library can be trusted."
- **Severity:** high — one-time, but it corrupts real ownership data at the moment trust is being established, and the wrong `wishlisted_on` dates are permanent.

## Medium

### M1. `bought_on` / `wishlisted_on` semantics at seed import are undefined

- **Scenario:** Seed import lands ~100+ PS-library games as `Owned` and 151 Notion rows as not-owned.
- **Why the rules fail:** §4.5 says `bought_on` is recorded when *"owned flips true — via sync or manual flag"* and `wishlisted_on` when *"added while not owned."* At import, owned "flips true" for the entire library at once — recording `bought_on = import date` for games bought over a decade is wrong data; recording nothing contradicts the rule as written. Same for `wishlisted_on = import date` on 151 games wishlisted long ago. The PRD gives no rule (leave null? stamp import date? import is exempt from §4.5?). §4 even says all three doors "record lifecycle dates silently," which implies stamping — the wrong answer.
- **Severity:** medium — nothing consumes these in v1, but §4.5's whole rationale is "can't be reconstructed later," and this bakes in unmarked-as-suspect dates.

### M2. Empty state-dropdown semantics undefined; a "completed only" view may be unreachable

- **Scenario:** Luca wants to see only his finished games. He toggles the `Story completed` reveal pill with nothing selected in the State dropdown.
- **Why the rules fail:** §3 never defines what an empty State multiselect means. If empty = "all live statuses" (which the default view implies), the reveal pill *"ORs its state into the visible set"* — yielding all live states + completed, and there is no combination of controls that shows completed games alone. If empty = "none," the default view needs a different rule than the filter table gives. Either reading leaves a gap the UI can't resolve from the PRD.
- **Severity:** medium — ambiguous spec for the product's second-most-used surface; "beat Notion's views" (§1) includes a finished-games view.

### M3. PS+ Extra flag goes permanently stale once a flagged game becomes owned

- **Scenario:** Wishlisted game is in PS+ Extra (flag set). Luca buys it (owned). Months later it leaves the catalog; the monthly refresh runs.
- **Why the rules fail:** §4.3 sets/clears the flag on *"tracked, non-owned games only"* — the now-owned game's flag is never touched again, so it stays `true` after the game leaves the catalog. `Playable now` stays correct (owned short-circuits), but the card's PS+ Extra flag icon (§3, explicitly on the minimal card) shows wrong data forever — against §2's own principle that derived/synced state "is always right." No rule clears the flag on the owned transition or includes owned games in the refresh.
- **Severity:** medium — silent, permanent wrong data on the shelf face.

### M4. Add-by-name has no duplicate guard against games already in the library

- **Scenario:** Luca forgets he tracked a game (it's hidden — completed, or dropped) and adds it again via §4.4. Or he adds a wishlist game whose title the next PS sync normalizes differently.
- **Why the rules fail:** §4.4 specifies search → pick → save with no check against existing rows (by external ID or normalized title). Duplicate rows split status/milestone history and defeat search-as-lookup ("did I ever finish that?" now has two answers). Related ambiguity: the permanence guarantee ("never re-add as a duplicate") is tied to *stored external-ID/alias links* — the PRD never says an add-by-name row stores the link that sync matching consults first, so whether sync later duplicates an add-by-name game depends on title normalization luck.
- **Severity:** medium — quietly erodes the trust metric; no rule produces an answer for "picked a result that's already tracked."

### M5. Straggler resolution doesn't say what happens to the source row's data

- **Scenario:** A Notion game marked `Paused` with a *Date started*, or a PS-library game (owned), fails title reconciliation and lands in the stragglers list. Luca resolves it "by manual search from the app."
- **Why the rules fail:** §4.1 defines the alias link the resolution stores, but not whether the resolved game carries the straggler's source data (Notion status, dates, PS ownership) or gets add-by-name defaults (not owned, `Not started`, `wishlisted_on` stamped — all wrong for an owned, half-played game). Also ambiguous: "the import lands everything it can" — is a title matched between Notion and PS but *failed at games-DB enrichment* (§5: "a failed external lookup lands the game in the stragglers list") landed with its data and no cover, or held out of the library entirely until resolved? Two readings, no rule.
- **Severity:** medium — the straggler path exists precisely for the messy rows; undefined data carryover means hand-fixing the exact data the import was supposed to preserve.

### M6. Logging an already-set milestone (replay finished) is undefined

- **Scenario:** Luca replays a completed game (status `Playing`, `completed_on` set from the first run). He finishes and taps "Story completed" again.
- **Why the rules fail:** §2 makes `completed_on` *"immutable through normal flows — never … overwritten by any … status change, or replay"*, so the log must not overwrite — but the PRD doesn't say what the action does instead: rejected with explanation? no-op? And does the auto-clear side effect (status → null, i.e. the correct end-of-replay outcome) still fire when the date write is refused? The documented replay exit is the *manual* status clear, but the milestone button is still sitting there and its behavior in this state has no answer.
- **Severity:** medium — a guaranteed-to-occur interaction (every finished replay) with unspecified outcome touching an immutability guarantee.

## Low

### L1. Release date missing entirely (neither real date nor `TBA`)

§2 defines *Released* over exactly two values — real date and `TBA`. A games-DB lookup that succeeds but returns no release date (common for obscure titles) is the unhandled third member: is null treated as TBA (not released) or does the row fail validation? One sentence fixes it.

### L2. Notion importer behavior for unmapped/blank status or `Completed` with blank *Date finished*

Current CSV is clean (all six statuses mapped, 0 completed rows missing *Date finished*), so this is belt-and-braces: a `Completed` row without a date would create status null + no milestone — the same invariant break as H1 — and a blank/novel status has no mapping row. Cheap guard: unmapped → straggler.

### L3. `Playable now` includes owned-but-unreleased games

A pre-ordered or manually-flagged unreleased game is owned → `Playable now` true, though it cannot be played. The derivation (owned OR PS+ catalog) never consults *Released*. Rules produce an answer; it's just the wrong one for the pill's name. Decide: intersect with Released, or accept.

### L4. `started_on` after a no-Playing completion is claimed by the replay

A game completed without ever being set to `Playing` has `started_on` null (rules answer this: null). But if it's later replayed, that replay is the *"first transition to `Playing`"* — `started_on` gets stamped with the replay date, silently misrepresenting the original playthrough. No rule distinguishes first-ever from first-since-completion.

### L5. User unsets `Owned` then re-flags — second `bought_on` write undefined

§2 allows the user to unset `Owned`. On re-flagging (owned flips true again), §4.5 says record `bought_on` — overwrite the original, keep it, or skip? Same question for a second `wishlisted_on` while un-owned. No rule.

### L6. Sync-time title ambiguity has no straggler equivalent

§4.1 defines an "ambiguous" outcome for seed import; §4.2's matching (alias → normalized title) has only match/no-match. Two distinct games normalizing to the same title (remakes sharing a name) silently merge — the new purchase never appears, undetected. Rare in practice; the alias mechanism can't help because no link exists yet.

### L7. Scheduled PS+ refresh failure has nowhere to surface

§5's bar is "failures surface, never silently retry," and the 401 path shows refresh instructions — but the monthly *scheduled* run (§4.3) has no user present. The PRD doesn't say where its failure surfaces (banner on next open? stale-as-of timestamp?), so an expired cookie silently freezes PS+ flags — the exact "mostly right → stops being consulted" decay §1 warns about.

### L8. Manually-owned (physical) game later re-bought digitally in a sync

Addendum names "gifted discs later bought digitally" as a case the editable type survives, but the single-valued `digital/physical` field can only hold one; the sync match (append-only) won't update it, and no rule says whether the digital purchase should be reflected. User-editable field papers over it — acceptable if acknowledged, currently unstated.

---

## Walked and confirmed handled (not findings)

Auto-clear from any live status incl. `Dropped`/`Not started`; replay → `Playing` with milestones untouched; platinum-without-completed effective state; `Owned`+`Wishlisted` pills yielding a legitimately empty set; search bypassing filters/hidden states; PS4/PS5 collapse on both ingest paths; catalog games never auto-added; `Not released` → `Not started` mapping; Rating column exclusion; manual genre auto-creation on add.
