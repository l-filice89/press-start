# Spine Pair Review — PRESS START (ps-game-catalog)

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-ps-game-catalog-2026-07-05/EXPERIENCE.md`
- **Run at:** 2026-07-05
- **Context:** single-user personal PWA — severity calibrated accordingly (no team handoff, one builder, spine-wins-on-conflict).

## Overall verdict

A strong, disciplined spine pair. DESIGN.md follows the canonical section order exactly; EXPERIENCE.md carries every required default plus the two triggered sections (Responsive, Inspiration). FR/NFR inheritance is accurate and verbatim, the state model is internally consistent, and behavioral rules are largely testable. Coverage is near-complete. The one finding with real downstream teeth: the **Card spec drops the release-state (Released/TBA) flag icon** that FR-15 mandates and Key Flow 2 depends on — and the two spines disagree on which flag icons the card even carries. Everything else is minor firming (a numeric type ramp, a couple of missing visual-spec rows) or cosmetic naming drift.

## Pass 1 — Mechanical coverage checklist

| # | Category | Result | Notes |
|---|---|---|---|
| 1 | Flow coverage (EXPERIENCE) | **strong** | 5 Key Flows, single named protagonist (Luca), numbered steps, explicit climax beat each. Failure path on Flow 1; others lack one (minor). Success metric stated. |
| 2 | Token completeness (DESIGN) | **adequate** | All 17 color tokens have hex. `rounded`/`spacing` complete and match prose. Typography = `family` + prose `note` only; **no numeric fontSize/lineHeight ramp** (see F2). |
| 3 | Component coverage (both spines) | **adequate** | Every component has real rules in both spines *except* Search bar and Popover, which lack a DESIGN.Components visual row (F3, F4). |
| 4 | State coverage (EXPERIENCE) | **strong** | Empty (NO MATCH / INSERT GAMES / search-no-match), cold-load (skeleton), error/offline (name-only fallback), failed-refresh & expired-cookie (attention banner), focus (a11y floor) all covered. Login edge states thin (F8). |
| 5 | Visual reference coverage | **strong** | All 7 mockups + 1 wireframe linked inline at the relevant section, each named for what it illustrates. No orphans; `imports/` empty. "Spine wins on conflict" stated in both files. |

## Pass 2 — Judgment

| # | Category | Verdict |
|---|---|---|
| 6 | Bloat & overspecification | **adequate** — State-model block restates PRD §2 (F5); otherwise lean. EXPERIENCE prose stays functional; editorial voice correctly confined to DESIGN + Key Flow climaxes. |
| 7 | Inheritance discipline | **strong** — `sources` resolve; FR/NFR references accurate; glossary (play statuses, effective state, milestones) identical to PRD; EXPERIENCE token refs resolve to DESIGN colors. Minor component-name drift (F6). |
| 8 | Shape fit | **strong** — DESIGN in exact canonical order (Brand→Colors→Typography→Layout→Elevation→Shapes→Components→Do's/Don'ts). EXPERIENCE has all 8 required defaults + Responsive + Inspiration, both correctly triggered. |

---

## Findings by severity

### Blocker (0)
None.

### Major (1)

**F1 — Card spec drops the release-state flag icon; the two spines also disagree on card flags** (DESIGN §Components "Card" / EXPERIENCE §Component Patterns "Card"; impacts FR-15 and Key Flow 2)
FR-15 requires the card to show "flag icons for PS+ Extra **and release state (date/TBA)**," and Key Flow 2's climax is a single glance at the card to answer "is it **Released**, and does the Playable-now flag show?" But:
- DESIGN's Card lists only `PS+ Extra / milestone badge` (top-left) + owned toggle — no release-state indicator.
- EXPERIENCE's Card row lists no flag icons at all (info strip = name, status pill, genres); it never mentions the PS+ Extra badge that DESIGN does place.
So the release-state flag has no home in either spine, and the PS+ Extra badge is in one spine but not the other. A downstream consumer building the card from EXPERIENCE would ship it with no flags; Flow 2 becomes unsupportable.
*Fix:* Add release-state (Released date / TBA) and PS+ Extra flag icons to the Card in **both** spines — DESIGN.Components (placement/color) and EXPERIENCE.Component Patterns (what each conveys, and that PS+ Extra hides once owned per FR-38). Reconcile the two card descriptions so the overlay/flag inventory matches.

### Minor (4)

**F2 — No numeric type ramp** (DESIGN frontmatter `typography` + §Typography)
Each face is `{ family, note }`; sizes/weights live only in prose ("headings 700; pills 600 uppercase"; "card titles single-line"). No `fontSize`/`lineHeight` tokens exist, so there is no type scale for downstream code to mirror. Weights are recoverable from the notes; sizes are not stated anywhere. Spec-legal (typography values may be any subset), but thin for implementation.
*Fix:* Add a minimal token ramp (e.g. `display/heading/pill/card-title/body/caption` → fontSize + lineHeight, weights already implied), or state an explicit semantic scale the builder should apply.

**F3 — Search bar has no DESIGN.Components visual row** (DESIGN §Components)
The persistent search bar is the sole Add entry point (the hero path), present in DESIGN frontmatter `components` and specified behaviorally in EXPERIENCE, but it has no visual-spec row in DESIGN's Components section (anatomy, sizing, focus/active appearance).
*Fix:* Add a Search bar row to DESIGN.Components (radius `{rounded.sm}`, focus halo, placeholder/`＋ Add` affordance styling).

**F4 — Popover has no dedicated DESIGN.Components visual row** (DESIGN §Components)
`popover` is in frontmatter and fully specified behaviorally in EXPERIENCE (anchors to pill, closes on outside tap/scroll), but its visual treatment is only implied via §Elevation and §Shapes.
*Fix:* Add a short popover row (`surface-raised`, `{rounded.lg}`, glow-ring, anchor/arrow) so its visual spec is explicit like the other overlays.

**F5 — State-model block restates PRD §2** (EXPERIENCE §State Patterns)
The play-status list, milestone rules, effective-state formula, and derived-states list closely duplicate PRD §2. Defensible as the behavioral contract a consumer reads without the PRD, but it is a second copy to keep in sync (drift risk on any state-model change).
*Fix:* Keep it, but flag it as the mirror of PRD §2 (or trim to the UI-affecting deltas) so the canonical source stays unambiguous.

### Nit (5)

**F6 — Component-name drift across files** (both spines)
`filter-pill`/"Filter pills" (DESIGN) vs "Filter row" (EXPERIENCE); "FAB" vs "FAB drawer"; "Detail panel" vs "Detail (flip)". Resolvable by a reader but not identical — the rubric wants names identical across all sections.
*Fix:* Align the canonical names (or note the aliases once).

**F7 — Typography frontmatter uses `family` (spec field is `fontFamily`) and defines no fallback stacks** (DESIGN frontmatter)
A naive resolver keyed to `fontFamily` misses the value; the four web fonts (Orbitron/Rajdhani/Inter/JetBrains Mono) have no generic fallback for load-failure/FOUT.
*Fix:* Rename to `fontFamily` and add fallback stacks.

**F8 — Login surface has no error/edge state** (EXPERIENCE §IA / §State Patterns)
Magic-link login is specified for the happy path; no state for expired/invalid link. Low priority for a single-user first-run-only screen.
*Fix:* One line on the invalid/expired-link case (or explicitly defer).

**F9 — Card "owned toggle" vs FR-15 "owned indicator"** (EXPERIENCE §Component Patterns "Card")
EXPERIENCE elevates ownership to an inline reversible toggle on the shelf card; FR-15 calls it an "indicator" (ownership editing is FR-16/detail). Intentional per `.memlog.md` (card front quick-controls) and spine-wins — noted only so downstream treats the shelf control as interactive, not display-only.
*Fix:* None required; optionally note the deliberate divergence from FR-15.

**F10 — Failure paths only on Flow 1** (EXPERIENCE §Key Flows)
Flows 2–5 have no failure branch; Flow 5 (milestone logging) could note the confirm-modal cancel. Most are read/glance flows where "where applicable" gives a pass.
*Fix:* Optionally add a cancel branch to Flow 5.

## Mechanical notes

- **Cross-refs:** Both EXPERIENCE `{path.to.token}` refs (`{colors.accent-glow}`, `{colors.heat-magenta}`) resolve to DESIGN color tokens. No broken references.
- **Frontmatter completeness:** DESIGN has name, description, colors, typography, rounded, spacing, components (+ status/updated). EXPERIENCE has name, status, updated, sources — both source paths resolve.
- **Visual refs:** 7/7 mockups + 1/1 wireframe referenced; no orphans; no dead links.
- **Minor asymmetry:** `skeleton` appears in DESIGN.Components prose but not the frontmatter `components` map; covered in EXPERIENCE under State Patterns (Loading) rather than Component Patterns — acceptable, noted for completeness.
- **No Mermaid diagrams present** — nothing to lint.
