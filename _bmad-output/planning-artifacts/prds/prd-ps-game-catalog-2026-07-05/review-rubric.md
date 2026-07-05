# PRD Quality Review — PS Game Catalog

Reviewed: `prd.md` + `addendum.md` (2026-07-05). Calibration: personal/hobby project, single user, publish-someday optionality, deliberately lean; tech-how lives in the addendum and downstream architecture. Judged as a chain-top PRD (it feeds architecture) at hobby stakes.

## Overall verdict

This is a high-quality PRD for its stakes: it has a real thesis ("a library that fills itself"; "trust is the real deliverable"), a precise state model that most launch-grade PRDs would envy, and non-goals with earned rationale rather than furniture. What's at risk is downstream friction, not product misdirection — the prose is dense with testable behavior but carries no stable requirement IDs (the addendum even cites an "FR:" that doesn't exist), and one state-model edge (clearing the last completion milestone while status is null) is genuinely undefined. Nothing here is broken; two dimensions are merely adequate rather than strong.

## Decision-readiness — strong

Decisions read as decisions throughout. §5 states "free hosting outranks the SQLite preference" — a preference named and overruled in one clause. §6 rejects gamification with the reason ("it incentivized logging games nobody played") and distinguishes personal ratings (banned) from external scores (v1.x) precisely. The addendum records rejected alternatives ("Finished-but-idle" status rejected as "completion-as-a-status through the side door"; ownership-type inference chosen over a mandatory toggle, with the edge cases that killed pure inference). §7's Open Questions are actually open — DB, PS auth path, IGDB vs RAWG — each scoped to architecture time with the explicit claim "none block this PRD," which holds up on inspection. The one real product tension (the fragile `pdccws_p` cookie auth, §4.2) is acknowledged inline rather than smoothed over.

No findings.

## Substance over theater — strong

Nothing here is furniture. There are no personas, and none are needed — the single named user drives decisions directly ("the 'saw a game on my phone' moment," §4.4). The quality bars (§5) are product-specific invariants, not boilerplate: "Nothing external on render," "Failures surface, never silently retry," CSV export justified as "cheap insurance for data that can't be reconstructed." The Vision could not swap into another PRD: "the Notion database gets archived and never reopened" is a falsifiable, product-specific success condition, and the counter-metric ("wishlist additions regress to occasional batches") names the actual failure mode of trackers. §2's governing principle ("anything that can be computed is computed — a manually-set state can drift; a derived state is always right") is a thesis doing work, not a slogan.

No findings.

## Strategic coherence — strong

The thesis — trust through automation, because "a tracker that's only mostly right slowly stops being consulted at all" — organizes every feature: append-only sync (never clobbers user data), derived states (never drift), effective-state formula (replays can't corrupt history), immutable milestones with fat-finger modals. The four success conditions in §1 map one-to-one onto the product's four pillars (sync, status logging, wishlist/PS+ check, filtering). Counter-metric present. MVP scope is coherently problem-solving-shaped: v1 is exactly "replace Notion with something trustworthy," v1.x is enrichment, Future is earned-later — and lifecycle dates (§4.5) are the one deliberate exception, correctly argued ("these can't be reconstructed later").

No findings.

## Done-ness clarity — adequate

Being unforgiving here, per the rubric. Most of this PRD is unusually testable for prose-form requirements: the effective-state formula is literally pseudocode (§2), filter semantics are stated as a law ("OR within a group, AND across groups," §3) with the reveal-pill exception reasoned out, sync guarantees are enumerated ("existing rows are never modified or deleted; status, milestones, dates, and genres survive every sync," §4.2), and title normalization lists its exact transforms (§4.1). An engineer could write acceptance tests from most paragraphs.

But there are gaps:

- The null-status invariant has an undefined edge. §2: status "may be null once a completion milestone exists (and only then)," and milestones are "editable only in the game's detail view." If the user edits away the only milestone while status is null, the game violates the invariant and the effective-state formula returns nothing. This is the one place the otherwise-airtight state model leaks.
- The shelf's look-and-feel is bounded by analogy only ("Steam Big Picture energy... with Notion-gallery data density," §3). Acceptable as a UX brief at these stakes, but it is the PRD's only adjective-shaped requirement.
- Small underspecifications: secondary ordering within a status group (§3 gives only the status-level order); what the sync button reports on success (failures land in stragglers, but "added 3 games" vs. silence is unstated).

### Findings

- **medium** Milestone-clearing edge undefined (§2, State Model) — Clearing the last completion milestone in the detail view while play status is null leaves the game with no effective state; the invariant "null only while a completion milestone exists" has no enforcement rule for this path. *Fix:* one sentence, e.g. "clearing the last completion milestone restores play status to `Not started`" (or block the edit while status is null).
- **low** Shelf density bounded by analogy only (§3) — "Steam Big Picture energy... Notion-gallery data density" gives direction but no bound; fine for hobby stakes, but this is the sentence UX work will have to interpret. *Fix:* optionally anchor one concrete (e.g. cards-per-row range on desktop) or explicitly delegate to UX.
- **low** Sync success feedback unspecified (§4.2) — Failure paths are well-defined (stragglers, 401 instructions) but what the user sees after a successful sync (count of games added, "nothing new") is not. *Fix:* one line on the post-sync summary.
- **low** Secondary sort order unspecified (§3, Default view) — Ordering within `Playing`/`Paused`/etc. groups is undefined (name? recency?). *Fix:* name one, or mark it a UX call.

## Scope honesty — strong

Omissions are explicit and layered: §6 splits v1.x (with the framing "enriches a working app — next, not now") from Future ("earns its way in later") from Non-goals, and the non-goals carry reasons ("availability is not ownership; catalog games leave"). The PS+ Extra tier assumption is stated up front ("v1 assumes a PS+ Extra subscription") with its generalization pre-sketched. The multi-user seam is scoped with unusual honesty: "the door to publishing is left unwelded, nothing more" — that's exactly the right amount of investment named as exactly what it is. Open-items density (5 open questions, all architecture-scoped) is right for the stakes. There are no `[ASSUMPTION]` tags, but I could not find an unconfirmed inference that needed one — the PS4/PS5-collapse and rating-drop decisions read as confirmed choices, not silent guesses.

No findings.

## Downstream usability — adequate

This is a chain-top PRD (architecture is explicitly downstream, §7), so the dimension applies, moderated by the methodology's deliberate leanness. Domain vocabulary is consistent without a formal glossary: "effective state," "milestone," "straggler," "reveal pill," "the shelf" are each defined at first use and used identically thereafter. §-cross-references all resolve (§2↔§3↔§4↔§6 checked). Sections extract cleanly — §2 alone is a complete state-model spec.

The gap is addressability: there are no FR/SM IDs, so downstream story creation and any traceability will have to invent names for behaviors ("the append-only guarantee," "the straggler flow"). The addendum already trips on this: it cites "(FR: product URL when known, store-search fallback)" — a reference in FR-notation to a document that has no FRs. IDs are cheap; a traceability matrix was right-sized away, but stable handles were not the expensive part.

### Findings

- **medium** No stable requirement IDs; addendum cites a phantom FR (addendum §Sale detection; prd.md throughout) — "(FR: product URL when known...)" references FR-structure that doesn't exist, and downstream story creation has no stable handles to cite. *Fix:* either number the load-bearing behaviors (even coarse: FR-1..FR-n per subsection) or reword the addendum reference to "(v1 'View on PS Store' link, §3)".

## Shape fit — strong

Hobby/solo capability-spec shape, correctly chosen and consistently executed. No UJ scaffolding for a single-operator tool (the two moments that matter — phone-at-discovery, shelf-at-decision — are carried inline in §1/§4.4 without ceremony). The document is organized around the product's actual structure (state model → surface → ingestion → platform → scope) rather than a template's. The rigor is light where light is right (no personas, no market sizing) and heavy exactly where a hobby project can't afford drift: the state model. The addendum split works — rationale and future mechanism sketches live there without bloating the PRD narrative. Not over-formalized, not under-formalized.

No findings.

## Mechanical notes

- No glossary section; acceptable at these stakes since term usage is drift-free on inspection ("PS+ Extra" always flag-on-tracked-non-owned; "milestone" always the two dates; "wishlisted" always derived-not-owned).
- No ID scheme at all (see Downstream usability finding) — so ID continuity is trivially vacuous; the addendum's "FR:" notation is the one dangling reference found.
- All internal §-references resolve in both documents.
- Assumptions Index roundtrip: vacuously satisfied (no inline `[ASSUMPTION]` tags, no index).
- Frontmatter `status: draft` — worth flipping once validation findings are dispositioned.
