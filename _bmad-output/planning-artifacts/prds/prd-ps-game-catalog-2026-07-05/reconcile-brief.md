# Brief → PRD Reconciliation — ps-game-catalog

_Input: `briefs/brief-ps-game-catalog-2026-07-04/brief.md` + `addendum.md`_
_Against: `prds/prd-ps-game-catalog-2026-07-05/prd.md` + `addendum.md`_
_Date: 2026-07-05_

## Verdict at a glance

The PRD covers the brief's functional scope nearly completely — every v1 scope bullet, all five lifecycle dates, the v1.x list, the multi-user seam, the SQLite demotion, and the quality-bar spirit ("nothing external on render", failures surface) all made it across, often sharpened. The losses are concentrated in two places: **one real functional gap (user ratings)** and **the qualitative/rationale layer** (why-build-not-adopt, look-and-feel adjectives, vision narrative).

---

## A. GAPS — in the brief, not in the PRD

### A1. User ratings — MISSING ENTIRELY (functional gap, highest priority)

The brief mentions Luca's own ratings repeatedly, always as first-class user-entered data:

- Problem: "169 tracked games with **status, ratings, genres, and dates**"
- Solution: "Sync only ever adds — **status, ratings, and dates** he's entered are never touched"
- Solution: "Manual entry shrinks to the things only he knows: what he's playing, **what he thought of it**, what he wants next"

The PRD has **no user rating field anywhere**:

- Not in the detail view's editable fields (§3 Cards)
- Not in the Notion import mapping (§4.1 maps statuses and dates, silently drops the ratings column)
- Not in the CSV export list (§5: "games, statuses, milestones, lifecycle dates, genres, ownership")
- Not in the user-scoped data enumeration (§5 seam: "status, milestones, dates, ownership overrides")
- Not in sync's never-touched list (§4.2: "status, milestones, dates, and genres survive every sync")

Note: v1.x "critic and user scores from games-DB sources" is *external* scores — not Luca's personal rating. This does not cover the gap. If dropping personal ratings was a deliberate decision during coaching, it is nowhere recorded; more likely the FR restructuring silently lost it. **Either add the rating field (detail view + import mapping + export + seam list + sync-protected list) or record the drop as an explicit decision.**

### A2. "Why Build Instead of Adopt" — rationale section dropped wholesale

The brief has a named section the author clearly cared about:

- Named comparables: **Backloggd, HowLongToBeat** ("and friends")
- The differentiators: "None of them sync a PlayStation library, none know what's on PS+ Extra right now, and none will ever grow exactly the feature Luca wants next"
- The emotional core, bolded in the brief: "**this is Luca's tool, with all the bells and whistles he desires, and a platform he can keep extending for as long as it stays interesting.** For a personal project, that isn't a rationalization — it's the requirement."

None of this appears in the PRD (Backloggd survives only incidentally in the PRD addendum's ownership-type note). This is the document's answer to "why does this project exist instead of an afternoon of app-store shopping" — worth a sentence or two in §1.

### A3. Look-and-feel descriptors thinned

Brief addendum UI direction: Steam Big Picture **"Recent Games" shelf** specifically, described as "cover-art-forward, **dark, slick, modern**". The PRD keeps "Steam Big Picture energy leaning hard on the covers" and the Notion-density/refine-not-reinvent line, but drops **dark, slick, modern** and the specific "Recent Games shelf" reference. For a product whose landing page is "the product's face," these three adjectives are the only visual-tone words the author gave; UX downstream will want them.

Also thinned: the Notion card density reference enumerated "cover, genre tags, **status pill**, owned checkbox" — the PRD card front has no status indication (arguably intentional given effective-state ordering, but unrecorded).

### A4. Vision narrative compressed to near-zero

Brief Vision section content absent from the PRD:

- The two-to-three-year horizon: "simply *the* record of Luca's gaming life — trusted enough that Notion is a memory"
- "Every game carries its full arc: wanted on this date, bought on that one, started, finished, platinum'd"
- The concrete future questions: "*what should I play next, given my mood? What did my gaming year look like? **What's been sitting in the backlog longest?***" — the third question appears nowhere in the PRD (the first two survive as feature bullets, stripped of the "given my mood" framing)
- "It never needs to be published, and it never needs to be finished" — the anti-pressure framing that governs pacing decisions

### A5. PS+ Extra is a per-region flag

Brief addendum data model: "PS+ Extra availability is a per-title, **per-region** flag." The PRD never mentions region. Small, but it is a data-model fact the architecture will trip over (which region's catalog does the check query?).

### A6. Dropped action item: project-context.md still claims SQLite is decided

Brief addendum: "Action: `project-context.md` currently states SQLite-via-bun:sqlite as decided — update it when architecture lands." The PRD captures the SQLite demotion itself (§5, §7.1) but the pending correction to project-context.md is recorded nowhere downstream. Cheap to lose, annoying when the architecture inherits a stale "decided" constraint.

### A7. Minor qualitative drops (each one line)

- **The mantra quote**: "Games I bought and forgot is the mantra" — spirit kept (§1.1), exact phrase lost.
- **"Wishlist amnesia"** — the brief's name for the failure mode; PRD counter-metric describes it without naming it.
- **Concrete scale numbers**: 169 Notion games / 175 PS library games, "growing monthly through PS+" — useful for import testing and pagination decisions; absent.
- **Play-next replaced behavior**: brief addendum records what the future feature replaces ("filter owned games, sometimes by genre, then pick by gut") — rationale dropped from PRD future section.
- **andshrew's PlayStation-Trophies APIv2 docs link** — a concrete research pointer for the architecture-time NPSSO question (§7.2 poses the question without the reference).
- **"Trophies beyond Platinum"** listed as far-future in the brief; PRD future says only "playtime and other platforms" (arguably subsumed by v1.x trophy sync, but not explicitly).
- Brief addendum: "**A game leaving the catalog is a meaningful state change**" — PRD handles the mechanics (flags update in both directions) but doesn't record whether the leave event/date deserves capture the way other state changes do.

---

## B. CONTRADICTIONS — where the PRD says otherwise

Marked **[deliberate]** where this matches known PRD-coaching decisions, **[verify]** where the evolution looks intentional but was not in the known-decisions list.

1. **Genres: Notion column vs third-party vocabulary.** Brief imports Notion data including genres; PRD §3 drops Notion's genre column at import and re-tags everything from IGDB/RAWG. **[deliberate]**
2. **Completion: statuses vs dates.** Brief treats completed/Platinum as statuses a game "moves between"; PRD makes them immutable milestone dates with a derived effective state, statuses become nullable. **[deliberate]** (and better — replay-safe by construction, per PRD addendum).
3. **`Dropped` status added.** Not in the brief's vocabulary anywhere; PRD adds it plus hide-by-default behavior. **[deliberate]**
4. **Filter model.** Brief (twice): pills "combining as **OR**", one flat pill row including statuses. PRD: OR within group, **AND across groups**; state moves into a multiselect dropdown; completed/platinum/dropped become reveal pills; flags are each their own AND group. **[deliberate]** — reveal pills replacing state-dropdown entries is a known decision; the OR→AND-across-groups semantics change rides along with it.
5. **Landing page default: "unfiltered full library" vs hidden states.** Brief and brief addendum both say the landing page is the **unfiltered full library**. PRD §3 hides `Story completed`, `Platinum achieved`, and `Dropped` by default — "the default shelf is the backlog view." **[verify]** — coherent with decisions 3–4 and probably intentional ("full record is one pill away"), but it flips an explicit brief statement and is the change Luca is most likely to notice on first load.
6. **PS+ Extra refresh: user-triggered vs also scheduled.** Brief scope: "user-triggered refresh aligned to Sony's monthly catalog update." PRD §4.3: button **and** a scheduled job. **[verify]** — an addition, not a removal; also quietly strains the brief's "automating anything Sony's API can't give reliably stays out" caution and adds a free-tier constraint the PRD itself flags.
7. **Ownership source.** Brief implies owned status arrives via sync only; PRD adds manual owned-flag for physical discs plus digital/physical inference. Pure extension (physical games were invisible in the brief's model) — evolution, not conflict. **[deliberate-looking]**
8. **PWA.** Brief asks only for "reachable from the phone"; PRD commits to an installable PWA. Strengthening, not contradiction.
9. **CSV export, no-gamification, PS Store link, confirmation modals, search-as-lookup** — all PRD additions with no brief counterpart. Consistent with the brief's spirit; listed for completeness.

---

## C. Brief content confirmed fully captured (no action)

One-metric success criterion + all four sub-criteria; the counter-metric even preserves the brief's best line ("a tracker that's only mostly right slowly stops being consulted at all"). Append-only sync guarantees (except ratings — see A1). All five lifecycle dates with exact semantics. Two-level completion distinctness. PS+ Extra never-auto-add + availability-is-not-ownership. TBA release state, filterable. Card-flip interaction. Cover art persisted, never fetched on render. Free tier / stateless / managed DB / better-auth magic link / Google-in-v1.x. Multi-user seam scoped-to-user-id-but-nothing-more. Seed import of both sources. Entire v1.x list. Play-next + stats futures. Door-open-not-now publishing posture. SQLite demotion with the same candidate list (PRD adds Convex). NPSSO investigation as an open question. Trophy-grade client-side computability. Score-source options (RAWG/IGDB/OpenCritic).

---

## D. Recommended actions, in order

1. **Resolve A1 (ratings)** — the only gap that changes the data model and import. Add or explicitly decide-to-drop, in writing.
2. Fold A2's one-sentence rationale and A3's three adjectives into PRD §1/§3 — cheap, high-fidelity-per-word.
3. Add "per-region" to the PS+ Extra flag description (A5) and carry the project-context.md action item (A6) into §7 or the addendum.
4. Confirm contradictions B5 and B6 with Luca as deliberate; annotate them in the PRD addendum so the decision survives.
5. A4/A7 items are optional flavor restorations — worth a pass if the PRD's Vision section gets another edit anyway.
