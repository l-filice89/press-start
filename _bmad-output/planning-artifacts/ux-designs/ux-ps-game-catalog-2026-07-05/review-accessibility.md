# Accessibility Review — PRESS START

> Reviewer: accessibility specialist. Scope: `DESIGN.md`, `EXPERIENCE.md` (Accessibility Floor), and the `mockups/` + `wireframes/` HTML. Context: solo personal PWA, dark-only, not a regulated product — findings are prioritized by what actually bites in daily use, not by compliance box-ticking. Ratios are computed with the WCAG 2.x relative-luminance formula against the token backgrounds (`bg-void #05090f`, `surface #0b1622`, `surface-raised #0a1120`).

## 1. Contrast check (computed ratios)

WCAG AA thresholds: **4.5:1** normal text, **3:1** large text (≥18.66px bold / ≥24px) and UI/graphical elements.

### Foreground tokens as text

| Foreground | on void | on surface | on surface-raised | Small-text AA (4.5) | Large/UI AA (3.0) |
|---|---|---|---|---|---|
| text-primary `#eafaff` | 18.6 | 17.0 | 17.6 | PASS | PASS |
| text-secondary `#8fb0c4` | 8.7 | 8.0 | 8.2 | PASS | PASS |
| **text-muted `#5f7d92`** | **4.59** | **4.20** | **4.34** | **FAIL on surfaces / marginal on void** | PASS |
| accent-electric `#12b3ff` | 8.5 | 7.7 | 8.0 | PASS | PASS |
| accent-glow `#35e0ff` | 12.6 | 11.5 | 11.9 | PASS | PASS |
| **brand-blue `#0070cc`** | **3.98** | **3.64** | **3.76** | **FAIL as text** | PASS |
| heat-magenta `#ff2e88` | 5.70 | 5.21 | 5.38 | PASS | PASS |
| heat-magenta-ink `#ff8bc2` | 9.24 | 8.44 | 8.73 | PASS | PASS |
| milestone-silver `#d6e6f5` | 15.7 | 14.3 | 14.8 | PASS | PASS |
| **state-dormant `#3d5566`** | **2.56** | **2.33** | **2.41** | **FAIL** | **FAIL** |
| warn-amber `#ffb254` | 11.2 | 10.2 | 10.6 | PASS | PASS |
| success-green `#8fe6a8` | 13.4 | 12.2 | 12.6 | PASS | PASS |

### Fills (label sitting *on* a colored fill)

| Pair | Ratio | Verdict |
|---|---|---|
| Active filter pill: void-ink `#04121b` on electric `#12b3ff` fill (mockup `.pill.on`) | 8.05 | PASS — correct choice (dark ink on neon) |
| Reveal pill active: `#0a1120` on silver `#d6e6f5` fill | ~15 | PASS |
| Playing pill: ink `#ff8bc2` on **translucent** magenta tint over dark (`.sp-play`) | ~8–9 effective | PASS — tint over near-black, not a solid fill |
| Hypothetical solid: magenta-ink `#ff8bc2` on **solid** magenta `#ff2e88` | **1.62** | FAIL — avoided by the tint approach; do not switch pills to solid magenta fill |
| Hypothetical: white `#eafaff` on electric `#12b3ff` solid | **2.2** | FAIL — avoided (mockups use dark ink, not white) |
| FAB `＋` ink `#04121b` on gradient — bluest stop `#0070cc` | 3.78 | PASS (large graphic, 3:1) but tight; keep icon large/bold |
| FAB `＋` ink on cyan stop `#12b3ff` | 8.05 | PASS |
| Stragglers count badge: white `#fff` on magenta `#ff2e88` | **3.5** | FAIL for the small numeral (needs 4.5) |
| White `#eafaff` on brand-blue `#0070cc` fill | 4.68 | PASS |
| Group labels `.glabel #4d7f98` (9px uppercase) on void | 4.57 | Marginal pass on void; 4.46 on panel `#070d15` — effectively at the line |

**Headline contrast risk: `text-muted #5f7d92`.** It is the app's pervasive secondary-metadata color — genres line, `.gsub`, lifecycle `.dcell` keys, `+N more`, toast timestamps. It **fails 4.5:1 on every surface tone** and only marginally clears on void (4.59). At the sizes it's actually used (9–10px) this is real small text. This is the one contrast token worth fixing globally.

## 2. Findings by severity

### HIGH

**H1 — `text-muted` fails AA for small text on surfaces.**
Ratios 4.20 (surface) / 4.34 (raised) / 4.59 (void). Used for genres, date-cell keys, counts, timestamps — all small.
*Fix:* nudge the token to **`#6b8ba0`** (5.06 on surface, 5.54 on void) — same muted register, clears AA everywhere. `#7191a6` (5.5/6.0) if you want more headroom. One token change, no layout impact.

**H2 — Dot-only status on covers is color-alone (wireframe inconsistency).**
`wireframes/ia-shell-wireframe.html` and the mini-cards in `mockups/filter-row-wireframe.html` show status as a **colored dot on the cover with no text**. That is meaning-by-color-alone and also indistinguishable for the dormant grey (`#3d5566`, 2.5:1 — invisible). The canonical `mockups/card-flip-prototype.html` does it right: a **text pill** (`PLAYING`, `UP NEXT`, dot + uppercase label) below the cover. The Floor already mandates label text.
*Fix / guardrail:* ship the **text pill on both surfaces** (the spine already says so). If an on-cover dot is *also* shown, treat it as decoration layered over the pill — never the sole status carrier. Delete the dot-only pattern from the wireframe so it isn't mistaken for the spec.

### MODERATE

**M1 — Touch targets render well below the 44×44 floor.**
The Floor states ≥44×44 and the mobile status *dot* was rejected for exactly this reason, but the mockups render: status pill ≈22px tall (`padding:4px 10px`, 9.5px font), owned toggle 26×26 (24×24 mobile), flag badges 22×22, popover rows ≈34px, filter dropdown carets/`+38 more` chips ~26px. On the phone — the "saw a game, add it" surface — these are the primary inline controls.
*Fix:* enforce a 44×44 **hit area** independent of visual size (transparent padding / `::before` hit-slop, or `min-height:44px` on the pill row and toggle). The pill can *look* small; the tap target must not be. Add this as an explicit number in the Floor ("visual size may be smaller, hit area ≥44").

**M2 — Status popover keyboard/SR model is unspecified.**
The Floor covers pills-as-buttons, the live region, dialog focus-return, and the search shortcut — good. But the **status popover** (the single most-used inline control) has no keyboard contract. In the mockup it's `div`s with `onclick`, closes on outside-click/scroll only.
*Fix — add to the Floor:* pill exposes `aria-haspopup="menu"` + `aria-expanded`; opening moves focus into the popover; **Up/Down** move between rows, **Enter/Space** select, **Escape** closes and returns focus to the pill; the milestone rows announce they open a confirm dialog. "Closes on scroll" is fine for pointer but must not be the only dismissal.

**M3 — Search-as-add lacks combobox semantics.**
Search is the hero path (find-or-add) yet the results list (`mockups`, `wireframes` phone 3) is presentational. Screen-reader users need to know results appeared and how many.
*Fix:* `role="combobox"` + `aria-expanded` + `aria-controls` on the input; results as `role="listbox"`/`option`; `aria-activedescendant` for arrow navigation; the `＋ Add "<name>"` row is a real option; announce result count / "no match — add" via the polite live region.

**M4 — Filter changes should announce the result count.**
The live plain-English summary sentence is excellent *visually* and, importantly, the OR/AND meaning rests on the **literal words "or"/"and"**, not color — so the cyan/magenta connector coloring is redundant emphasis, not a color-alone violation (good). But when a filter flips, a SR user gets no feedback that the shelf changed.
*Fix:* mirror the summary sentence + "N games" into the polite live region on each filter change (the mobile "Show N games" CTA already carries the count — reuse it).

### LOW / MINOR

**L1 — Dialog dismissal & labeling.** The flip detail closes on scrim-click only in the mockup. Add **Escape-to-close**, `role="dialog"` + `aria-modal="true"` + `aria-label` (the game title), alongside the focus-trap/return the Floor already promises. Same for confirm and summary modals.

**L2 — Stragglers count badge white-on-magenta = 3.5:1.** The tiny "3" numeral fails. Low stakes (the same info is redundantly in the attention banner + drawer label), but darkening the numeral to `#04121b` or enlarging it is a trivial win. Same applies to the magenta drawer badge.

**L3 — `state-dormant #3d5566` must never carry text.** At 2.5:1 it is a **fill-only** token (the "Not started" dot). It is currently used only as a dot beside the "NOT STARTED" label — acceptable because the label carries meaning. Add a note to the token: *decorative fill only, never text or a sole signal.*

**L4 — `brand-blue #0070cc` is fill-only.** 3.6–4.0:1 as text. The spine already scopes it to "solid fills"; keep it there. White/near-white text on brand-blue fills is fine (4.68:1).

**L5 — Group labels `.glabel #4d7f98` sit exactly on the line** (4.46–4.57 at 9px). If `text-muted` is bumped per H1, align this label to the same value for comfortable margin.

## 3. What the Accessibility Floor already covers well (no action)

- **Color-alone, status:** status is a dot **plus** an uppercase text label; milestones add a **badge shape** and silver metal. Effective-state also reads as text. Solid coverage.
- **Color-alone, filters:** active pill = fill + glow + text-color change **and** is narrated by the summary sentence. Not color-alone. The FR-22 "glow" is never the sole signal — good, and the Floor explicitly forbids glow-intensity-only focus.
- **Color-alone, summary sentence:** OR/AND ride the literal words; color is redundant. Fine even for total color-blindness.
- **Reduced motion:** the story is **complete and specific** — flip-then-grow → fast cross-fade/scale, drop glow *pulses* and skeleton shimmer (static placeholder), keep static neon. It even names the perceived-sluggishness payoff. This is the strongest part of the Floor. Minor optional additions: also neutralize the cover hover-lift (`translateY`) and toast slide-in under `prefers-reduced-motion` for consistency; the progress-bar shimmer is fine as a determinate fill.
- **Icon-only labels:** FAB, drawer items, owned toggle, flags, status pill are all named with state ("Owned, on"; "Playing — change status"). Correct.
- **Keyboard baseline:** focusable shelf grid with reading-order arrow traversal, pills/toggles as buttons, focus-trapped detail returning focus to the origin card, global search shortcut. Good spine; M2/M3/L1 just fill in the popover/combobox/dialog specifics the prose leaves implicit.
- **Pill construction:** using **translucent tints over near-black** (not solid neon fills) for status pills is what keeps `heat-magenta-ink` legible (~8–9:1). Keep it — a solid magenta fill would collapse to 1.6:1.

## 4. One-line fix list

1. `text-muted #5f7d92 → #6b8ba0` (global, clears AA on all surfaces). **[H1]**
2. Ship the **text status pill** on every card/surface; kill the dot-only cover pattern in the wireframe. **[H2]**
3. Add "visual size may shrink, **hit area ≥44×44**" to the touch-target Floor and implement hit-slop on pill/toggle/flag. **[M1]**
4. Spec the popover keyboard/ARIA (haspopup/expanded, focus-in, arrows, Enter, Escape) and search combobox semantics + result-count announcement. **[M2–M4]**
5. Minor: Escape + `aria-modal` on dialogs; darken the magenta count-badge numeral; annotate `state-dormant`/`brand-blue` as fill-only. **[L1–L4]**
