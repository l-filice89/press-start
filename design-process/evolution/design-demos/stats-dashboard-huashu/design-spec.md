# Stats Dashboard — Three-Direction Design Spec

## Understanding

This is not a generic analytics dashboard. It is a reflective room inside PRESS START: a personal library that has quietly accumulated dates while the user wanted, bought, started, finished, and mastered games. The current mock proves information architecture but feels flat because cyan performs nearly every visual job and every section is expressed as a similar rounded rectangle. Improvement must preserve usability, existing navigation, and exact counts while giving the page a stronger emotional arc. User wants magenta energy already present elsewhere in the app, but the existing system deliberately reserves magenta for active play. Therefore the useful design question is not “how much pink can be added?” It is “where can magenta become a meaningful signal of motion, memory, and effort without turning every value into equal noise?”

Audience is the product owner and primary user, usually viewing on phone during everyday library use and on desktop when reviewing or maintaining the collection. Core content is fixed: four all-time facts, five selected-year lifecycle counts, twelve-month starts/completions/Platinums, and up to five completed genres. The output is a responsive, high-fidelity HTML prototype. It must remain achievable in the existing custom CSS/React stack, with no chart dependency, image dependency, backend work, or new data fields. Based on this understanding, three real directions will be produced for visual selection.

## Shared content and behavior

- Existing authenticated shell with canonical wordmark and three-destination toggle.
- Stats route contains no search field.
- All-time facts: Tracked 344, Owned 212, Story complete 73, Platinum 18.
- Selected year: 2026, switchable through labelled select.
- Year facts: Wishlisted 9, Bought 7, Started 8, Story complete 6, Platinum 2.
- Monthly activity: starts, story completions, and Platinums; exact text remains available.
- Completed genres: Action 4, Adventure 3, RPG 3, Horror 2, Platformer 1.
- Responsive phone version without page-level horizontal overflow.
- Minimum body text 14px desktop and 16px phone where reading is sustained; labels at least 12px; 44px controls.
- No chart animation required; reduced-motion users lose no information.

## Emotional and visual target

The page should feel like opening a cabinet’s score history after months of play: personal, energetic, and earned. Cyan remains infrastructure and navigation. Magenta becomes temporal energy or active-play signal. Silver remains earned milestones. Faint grid, self-hosted brand type, and monospace numerals keep identity intact. Avoid a wall of interchangeable cards, generic bento composition, purple-gradient SaaS styling, and filler stats.

## Direction A — Cabinet Scoreboard

Roulette input: web style 4, Friendly Geometric Candy, translated through PRESS START rather than copied literally. Form comes from arcade cabinet controls: chunky pressable plates, score windows, and a strong “current round” year selector. Layout is a wide scoreboard: all-time score rail above, annual activity as the central playfield, genre ranking as a side score ladder. It is the most playful direction. Magenta marks Started and the active-year rail; cyan retains navigation and category structure. Rounded geometry is allowed because pill controls and arcade hardware already belong to brand, but candy colors, mascots, and childish bounce are excluded.

## Direction B — Year in Motion

Reality reference: official PlayStation annual Wrap-Up pattern of personal annual achievements, monthly breakdown, historical context, and trophy milestones. Only information-story principles transfer; no Sony marks, proprietary shapes, or PlayStation identity enter PRESS START. Form comes from lifecycle sequence: a giant selected year, a horizontal `WANTED → OWNED → STARTED → COMPLETED → PLATINUM` path, and a month ribbon that reads like progress through one run. Lifetime numbers become quiet context instead of four equal hero cards. This direction gives the strongest narrative and makes magenta feel like momentum rather than decoration.

## Direction C — Telemetry Archive

Designer/studio lens: Territory Studio’s practice of matching game-interface motifs to narrative while retaining clear navigation. Form comes from the library’s stored lifecycle ledger: calibration lines, exact readouts, a month matrix, and one bright magenta signal moving through otherwise cool technical chrome. Layout is asymmetric—large annual telemetry left, lifetime archive stack right, genre distribution below—so it feels authored rather than card-generated. This is the boldest and densest direction, aimed at a game-HUD sensibility without sacrificing web accessibility.

## Form questions

### A
- Narrative role: welcoming data overview.
- Viewing distance: phone at 10cm; desktop at 1m.
- Temperature: playful, energetic.
- Capacity: medium density with large score windows.
- Motif: arcade score panel and cabinet controls.

### B
- Narrative role: annual retrospective story.
- Viewing distance: phone and laptop.
- Temperature: celebratory, reflective.
- Capacity: progressive sections rather than simultaneous dashboard density.
- Motif: one lifecycle run across a calendar year.

### C
- Narrative role: precise historical telemetry.
- Viewing distance: laptop-first, condensed phone adaptation.
- Temperature: intense, technical, controlled.
- Capacity: highest density; strong grid alignment.
- Motif: lifecycle ledger rendered as game HUD telemetry.

## Image gate

No images. Data visualization and typography carry the content. Decorative game art would weaken truthfulness and create irrelevant acquisition/licensing work.

## Assumptions

- Structural scope remains approved.
- User wants visual exploration, not new features.
- Three directions may alter layout but not calculations or navigation behavior.
- Sample values are labelled prototype data and will not become hard-coded production values.
