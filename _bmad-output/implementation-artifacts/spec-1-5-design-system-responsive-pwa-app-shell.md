---
title: 'Design system & responsive PWA app shell'
type: 'feature'
created: '2026-07-07'
status: 'done'
baseline_revision: '08d703081b2e1c4f15a6c14cf873e1467a9b1728'
review_loop_iteration: 0
followup_review_recommended: true
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The authenticated app is still the Cloudflare Vite scaffold (`web/App.tsx` + its assets, generic light/dark CSS vars). There is no PRESS START design system, no installable/responsive app shell, and none of the shared feedback primitives (Attention-banner, Toast, Skeleton, live region) that Story 1.7's shelf and every later surface must render inside. `index.css` even ships a light theme, contradicting the dark-only mandate.

**Approach:** Replace the scaffold with the PRESS START visual system — dark-only design tokens (palette, spacing 4/8/12/16/24/32, radii 8/12/18/999, four self-hosted type faces) as reusable CSS custom properties — plus a responsive, installable (PWA) app shell (void Tron-grid + blue→magenta wash background, wordmark + tagline header) and the four reusable feedback primitives as tested React components fed by later stories. Establish a jsdom Vitest project so the new `web/` component layer has real regression coverage.

## Boundaries & Constraints

**Always:**
- Dark-only, one theme. Remove the light-mode `@media (prefers-color-scheme)` block; there is no light theme (UX-DR: "Dark-only, committed"). Tokens are the single source of every color/space/radius/font value — no hard-coded hex or px in components; components consume `var(--…)`.
- Exact token values from `DESIGN.md`: void `#05090f`, surface `#0b1622`, surface-raised `#0a1120`, border-hairline `#163043`, border-soft `#12283a`, text-primary `#eafaff`, text-secondary `#8fb0c4`, text-muted `#6b8ba0` (floored — never a dimmer grey for text), brand-blue `#0070cc`, accent-electric `#12b3ff`, accent-glow `#35e0ff`, heat-magenta `#ff2e88`, heat-magenta-ink `#ff8bc2`, milestone-silver `#d6e6f5`, state-dormant `#3d5566`, warn-amber `#ffb254`, success-green `#8fe6a8`. Spacing 4/8/12/16/24/32; radii sm 8 / md 12 / lg 18 / pill 999.
- Four faces by job (self-hosted, no external render fetch — NFR-3/free-tier): Orbitron (display: wordmark 900, headings 700, pills/labels 600 uppercase-tracked, card titles), Rajdhani (condensed UI labels/buttons), Inter (body/forms), JetBrains Mono (numerals/dates/counts/tagline/timestamps).
- Depth via glow + tone, never drop-shadow hierarchy: cards on `surface`; modals/popovers on `surface-raised` with a cyan glow-ring (`0 0 22–34px` accent-glow, low alpha); the Playing card carries a soft magenta bloom; focus/selection are neon halos.
- Accessibility floor: WCAG AA contrast (≥4.5:1 body, ≥3:1 large/UI); status pills use translucent-tint-with-light-ink or dark-ink-on-neon — never white-on-neon; a **distinct always-on focus outline** (not glow-intensity alone); every compact/interactive control carries a ≥44×44 hit area decoupled from visual size (padding or invisible expander); `prefers-reduced-motion` replaces flip/pulses/shimmer with static/cross-fade equivalents (static neon stays); icon-only controls expose accessible names + state; status/toast changes announce via a polite live region.
- PWA: installable with a home-screen icon (name PRESS START, `display: standalone`, `theme_color`/`background_color` = void `#05090f`); responsive across the phone↔desktop deltas (phone: leaner header/compact readout, single Filters affordance placeholder, icons-only FAB mount, bottom search slot; desktop: full header readout slot, header-left search slot, icons+text FAB mount).
- Legal hard rule: the wordmark/chrome carry **no** PlayStation/Sony marks — "PlayStation" may appear only as descriptive text (none required in this shell).
- Keep the existing FR-47 magic-link auth working: session gate (Login when unauthenticated) and a working sign-out control both survive the rewrite; restyle the Login screen with the new tokens + wordmark.
- All new UI lives in `web/` (AD source-tree); no changes to `core/`/`repositories/`/`routes/`/`providers/`.

**Block If:** (none — the resolved judgment calls: fonts are **self-hosted via `@fontsource*`** (aligns with nothing-external-on-render + PWA precache, not a CDN link); PWA icons are **generated PNGs** (192/512/maskable) from a source SVG, with SVG-icon fallback if rasterization is unavailable; sign-out **stays as a tokened control in the shell header** because a full FAB-drawer Settings surface is not in this story's ACs (deferred with the FAB chores, later epic); primitives are built + unit-tested but rendered with placeholder/no live data since seed (1.6) and shelf (1.7) come after.)

**Never:**
- Don't build the shelf, cards, status pill, filter row, detail flip, search results, or the FAB drawer's chore modals (Sync/PS+/Export/Settings) — those are Stories 1.7 / Epics 2–6. Build only the shell chrome + mount points + the four reusable feedback primitives.
- Don't fabricate game data or wire primitives to real sources; don't add dead CTA buttons that invoke unbuilt features (render empty-state headline/subtext with no live actions).
- Don't add a light theme, drop-shadow elevation, a second saturated accent hue, magenta on anything but the (future) Playing state, white ink on neon, or gamification/ratings chrome.
- Don't introduce Tailwind or a named UI kit (components are custom, plain CSS + CSS variables).
- Don't touch the Worker/API, D1 schema, or migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Toast auto-dismiss | `<Toast message="Saved" />` mounted, ~3s elapse (fake timers) | Renders the message; after ~3s it unmounts / calls `onDismiss`; content is announced via the polite live region | No error expected |
| Toast UNDO variant | `<Toast message="Marked Dropped" onUndo={fn} />` | Renders a labeled UNDO control (≥44px hit area); clicking calls `onUndo` and cancels auto-dismiss | No error expected |
| Attention-banner variant | `<AttentionBanner variant="stragglers|expired-cookie|failed-refresh" …>` | Renders full-width under-header with the variant tone (amber / magenta / steel), an accessible name, and an action affordance; **persistent** (no auto-dismiss) | No error expected |
| Skeleton reduced-motion | `<Skeleton />` with `matchMedia('(prefers-reduced-motion: reduce)')` = true | Renders a cover-shaped placeholder marked `aria-hidden`/busy; shimmer animation is suppressed (static), otherwise shimmer class present | No error expected |
| Live-region announce | `announce('Status changed')` | The polite (`aria-live="polite"`) region's text content updates to the message | No error expected |
| Empty-state (no actions) | `<EmptyState variant="insert-games" />` | Renders the `INSERT GAMES` headline + subtext; renders **no** action buttons when none are passed | No error expected |
| Empty-state (no-match) | `<EmptyState variant="no-match" />` | Renders `NO MATCH` headline | No error expected |

</intent-contract>

## Code Map

- `web/tokens.css` -- NEW: all design tokens as `:root` CSS custom properties (colors, spacing scale, radii, font-family stacks, motion/z-index); the single source every component references
- `web/fonts.css` -- NEW: `@fontsource*` imports for the four faces (only the used weights) — self-hosted, precacheable
- `web/index.css` -- REWRITE: global element/reset styles on tokens; remove the light-theme `@media` block and the `#root` 1126px scaffold frame; dark-only base (`background: var(--bg-void)`, `color: var(--text-primary)`), focus-visible outline, `prefers-reduced-motion` global reductions
- `web/App.tsx` -- REWRITE: session gate (`isPending` → tokened Skeleton splash; no session → `Login`; session → `AppShell`); drop all scaffold JSX/assets
- `web/App.css` -- DELETE: scaffold-only styles (counter/hero/ticks/next-steps) superseded by the shell
- `web/shell/AppShell.tsx` -- NEW: the frame — Background + Header + `<main>` shelf mount (renders `EmptyState insert-games` placeholder for now) + AttentionBanner slot + Toast host + LiveRegion; responsive layout
- `web/shell/Background.tsx` + `web/shell/background.css` -- NEW: void base with faint Tron light-grid + subtle blue→magenta radial wash (pure CSS, decorative `aria-hidden`); grid/wash suppressed-static under reduced-motion
- `web/shell/Header.tsx` + `web/shell/header.css` -- NEW: Wordmark + tagline, a search-slot placeholder (header-left desktop / bottom-pinned phone), a readout-slot placeholder (full `PS+ CATALOG AS OF …` desktop / compact phone), and the tokened sign-out control (≥44px, accessible name); responsive deltas
- `web/shell/Wordmark.tsx` + `web/shell/wordmark.css` -- NEW: "PRESS START" Orbitron 900 neon-glow + blinking cursor (blink stops under reduced-motion) + tagline "Want it! Own it! Beat it!" (JetBrains Mono, tracked)
- `web/components/AttentionBanner.tsx` -- NEW: reusable persistent banner (variant tone, accessible name, optional action) + `.test.tsx`
- `web/components/Toast.tsx` -- NEW: transient toast + `ToastHost`/`useToast` (auto-dismiss ~3s, UNDO variant, announces via live region) + `.test.tsx`
- `web/components/Skeleton.tsx` -- NEW: cover-shaped shimmer, reduced-motion static + `.test.tsx`
- `web/components/LiveRegion.tsx` -- NEW: polite `aria-live` announcer (context + `announce()` / `useAnnounce`) + `.test.tsx`
- `web/components/EmptyState.tsx` -- NEW: `INSERT GAMES` / `NO MATCH` headline+subtext, optional actions + `.test.tsx`
- `web/components/hit-area.css` (or a `.tap-target` util in `tokens.css`) -- NEW: the reusable ≥44px hit-area pattern (padding / invisible expander) applied to shell controls
- `web/Login.tsx` -- EDIT: restyle onto tokens + `Wordmark`; drop inline styles/hard-coded `#ff6b81`; keep FR-47 magic-link logic unchanged
- `web/main.tsx` -- EDIT: import `tokens.css`/`fonts.css`; register the PWA service worker (`virtual:pwa-register`)
- `index.html` -- EDIT: `<title>PRESS START</title>`, `<meta name="theme-color" content="#05090f">`, remove the scaffold `icons.svg` usage; PWA manifest link injected by the plugin
- `vite.config.ts` -- EDIT: add `VitePWA({ registerType:'autoUpdate', manifest, … })` alongside `react()` + `cloudflare()`
- `vitest.config.ts` -- EDIT: add a third `projects` entry `web` (`environment:'jsdom'`, `plugins:[react()]`, `include:['web/**/*.test.tsx']`, `setupFiles`)
- `test/setup-web.ts` -- NEW: `@testing-library/jest-dom/vitest` + `window.matchMedia` mock for the jsdom project
- `tsconfig.app.json` -- EDIT: add `@testing-library/jest-dom` (and `vitest`) to `types` so matcher/test types resolve; ensure `.test.tsx` under `web` typechecks
- `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/maskable-512x512.png`, `public/favicon.svg` -- NEW/REPLACE: PRESS START app icons (void bg + neon mark; generated from a source SVG) and a neon favicon replacing the Cloudflare one
- `web/assets/*`, `public/icons.svg` -- DELETE: scaffold-only art (hero.png, react/vite/cloudflare svg, the doc/social icon sprite) once unreferenced
- `package.json` -- EDIT: add deps `vite-plugin-pwa`, `@fontsource/orbitron`, `@fontsource/rajdhani`, `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`; devDeps `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@vite-pwa/assets-generator` (icon generation)
- `worker/index.ts` -- reference only: already serves built static assets (incl. `sw.js`/manifest) via the SPA fallback; no change expected

## Tasks & Acceptance

**Execution:**
- [x] `web/tokens.css` -- define every color/spacing/radius/font token from `DESIGN.md` as `:root` custom properties -- single source of truth for the system (UX-DR1/DR2)
- [x] `package.json` + `web/fonts.css` -- add & import the four self-hosted faces (used weights only) -- typography by job without an external render fetch (UX-DR2, NFR-3)
- [x] `web/index.css` -- rewrite global/base styles onto tokens; delete the light-theme block and scaffold `#root` frame; global `:focus-visible` outline + `@media (prefers-reduced-motion: reduce)` reductions -- dark-only committed base + a11y floor (UX-DR19/24)
- [x] `web/shell/Background.tsx` + `background.css` -- void + Tron grid + blue→magenta radial wash, decorative/aria-hidden, reduced-motion static -- signature texture (UX-DR3)
- [x] `web/shell/Wordmark.tsx` + `wordmark.css` -- Orbitron-900 neon wordmark + blinking cursor (reduced-motion: no blink) + mono tagline -- brand identity, no Sony marks (UX-DR4)
- [x] `web/shell/Header.tsx` + `header.css` -- wordmark, search-slot + readout-slot placeholders, tokened sign-out (≥44px, accessible name); responsive deltas -- shell chrome + preserved FR-47 sign-out (UX-DR26/27)
- [x] `web/shell/AppShell.tsx` -- compose Background + Header + `<main>` shelf-mount (`EmptyState`) + AttentionBanner slot + ToastHost + LiveRegion; responsive layout -- the frame later surfaces render in
- [x] `web/components/AttentionBanner.tsx` (+ test) -- variant tone (amber/magenta/steel), accessible name, optional action, persistent -- reusable needs-action channel (UX-DR11)
- [x] `web/components/Toast.tsx` (+ test) -- `ToastHost`/`useToast`, auto-dismiss ~3s, UNDO variant, announces via live region, ≥44px controls -- reusable transient confirmation (UX-DR12/17/25)
- [x] `web/components/Skeleton.tsx` (+ test) -- cover-shaped shimmer, reduced-motion static, aria-hidden/busy -- reusable first-load loader (UX-DR12/24)
- [x] `web/components/LiveRegion.tsx` (+ test) -- polite `aria-live` announcer context + `announce()` -- reusable a11y announcements (UX-DR21)
- [x] `web/components/EmptyState.tsx` (+ test) -- `INSERT GAMES`/`NO MATCH` variants, optional actions -- reusable empty states, shelf placeholder now
- [x] `web/components/hit-area.css` / `.tap-target` util -- the ≥44px hit-area pattern, applied to shell controls -- touch/hit floor (UX-DR25)
- [x] `web/App.tsx` + `web/App.css`(delete) -- session gate → Skeleton splash / Login / AppShell; remove scaffold -- wire the shell behind auth
- [x] `web/Login.tsx` -- restyle onto tokens + Wordmark; keep magic-link logic verbatim -- design system on the first-run surface (FR-47)
- [x] `vite.config.ts` + `web/main.tsx` + `index.html` -- add `vite-plugin-pwa` (manifest: name/short_name PRESS START, standalone, theme/background void, icons), register the SW, set title + theme-color meta -- installable PWA (FR-46, UX-DR: PWA)
- [x] `public/pwa-192x192.png` / `pwa-512x512.png` / `maskable-512x512.png` / `favicon.svg` -- generate PRESS START icons from a source SVG (SVG-icon fallback if no rasterizer); remove scaffold art -- home-screen icon (FR-46)
- [x] `vitest.config.ts` + `test/setup-web.ts` + `tsconfig.app.json` -- add the jsdom `web` Vitest project (react plugin, jest-dom, matchMedia mock) and make `.test.tsx` typecheck -- regression net for the new UI layer
- [x] tests -- cover every I/O & Edge-Case Matrix row in the co-located `web/components/*.test.tsx` -- behavioral + a11y regression coverage

**Acceptance Criteria:**
- Given the tokens, when the shell is built, then the dark-only palette, spacing (4/8/12/16/24/32), radii (8/12/18/999), and four faces (Orbitron/Rajdhani/Inter/JetBrains Mono) are implemented as reusable CSS-variable tokens, and no light-theme block remains (UX-DR1, UX-DR2)
- Given the app loads authenticated, when it renders, then the PRESS START wordmark + tagline appear over the void Tron-grid + blue→magenta wash, with no PlayStation/Sony marks in the chrome (UX-DR3, UX-DR4)
- Given a modern browser, when the built app is served, then it exposes a valid web manifest (name PRESS START, standalone, void theme/background, ≥192 & 512 icons) and a registered service worker so it is installable with a home-screen icon; and the layout adapts across the phone↔desktop deltas (FR-46, UX-DR26, UX-DR27)
- Given the shell, when built, then reusable `AttentionBanner`, `Toast`, `Skeleton`, and `EmptyState` components and a polite live region exist as tested primitives, rendered with placeholder/no live data (UX-DR11, UX-DR12, UX-DR17, UX-DR21)
- Given surfaces render, then elevation is expressed via glow + tone (cards on `surface`; modals/popovers on `surface-raised` with a cyan glow-ring; a magenta-bloom utility for the future Playing card) — no drop-shadow elevation tokens (UX-DR5)
- Given any text/pill, then the muted tone is floored at `#6b8ba0`, contrast meets WCAG AA, and the pill pattern uses translucent-tint-light-ink or dark-ink-on-neon — never white-on-neon (UX-DR22)
- Given keyboard focus, then a distinct always-on `:focus-visible` outline is visible (not glow-intensity alone), and interactive shell controls carry a ≥44×44 hit area decoupled from visual size (UX-DR19, UX-DR20, UX-DR25)
- Given `prefers-reduced-motion: reduce`, then blink/glow-pulse/shimmer reduce to static/cross-fade equivalents while static neon remains (UX-DR24)
- Given the existing auth, when a session is absent then the restyled Login renders, and when present then a working tokened sign-out remains available (FR-47)
- Given `bun run lint && bun run typecheck && bun run test && bun run build`, when run, then all pass — including the new jsdom `web` Vitest project and the untouched `src/core/**`, `test/integration/**`, and `purity.test.ts` suites

## Design Notes

- **Why a jsdom Vitest project:** the existing config has `unit` (node, `src/core`) and `workers` (workerd, D1) projects — neither has a DOM, so React components can't render there. This story introduces the real `web/` component layer, so it's the natural place to add a third `projects` entry (`environment: 'jsdom'`, `plugins:[react()]`, `include:['web/**/*.test.tsx']`). Establishes the pattern all later UI stories (cards, filters, detail) reuse. Keep imports explicit (`import { describe, it, expect } from 'vitest'`); `test/setup-web.ts` pulls in `@testing-library/jest-dom/vitest` and mocks `window.matchMedia` (absent in jsdom, needed by the reduced-motion paths).
- **Tokens as CSS variables, not JS:** plain CSS custom properties in `:root` (no Tailwind, no CSS-in-JS runtime) — matches the repo's existing `web/index.css` variable style and keeps components declarative. Component `.css` files reference `var(--…)` only.
- **Fonts self-hosted, not CDN:** `@fontsource*` packages so weights are bundled/precacheable — no external font fetch on render (NFR-3) and no CSP/offline surprise for the PWA. Import only used weights (Orbitron 600/700/900, Rajdhani 500/600/700, Inter + JetBrains Mono variable).
- **Primitives fed later:** built as reusable components with props and unit tests, but the live shell renders them with placeholder/no data (no game pipeline until 1.6/1.7). `AppShell`'s `<main>` renders `EmptyState insert-games` as the shelf mount; 1.7 swaps in the real shelf. No dead CTA buttons — `EmptyState` actions are optional and omitted here.
- **Sign-out stays in the shell header:** the full FAB-drawer Settings surface is out of this story's ACs; re-home sign-out into a tokened header control (accessible name, ≥44px) so FR-47 keeps working. Note in-code that it relocates to Settings when the FAB drawer lands (later epic).
- **PWA + Workers Static Assets:** `vite-plugin-pwa` emits `sw.js` + `manifest.webmanifest` into the Vite build; the Cloudflare plugin/Wrangler serve them as real files (the `single-page-application` `not_found_handling` only fallbacks *unknown* paths, so `/sw.js` and the manifest resolve directly). SW scope is root. Icons generated from a source SVG via `@vite-pwa/assets-generator`; if rasterization is unavailable, ship SVG icons (`purpose: "any maskable"`) — acceptable for modern installability.
- **Glow, not shadow:** provide reusable utilities/token vars for the cyan glow-ring (`--glow-ring: 0 0 28px …accent-glow low-alpha`) and the magenta Playing bloom, so 1.7's cards/modals compose them — but don't render a card here.

## Verification

**Commands:**
- `bun run lint` -- expected: Biome clean over `web/**` (incl. new components/tests) and the untouched `src/core/**` restricted-import override
- `bun run typecheck` -- expected: `tsc -b` clean across app/worker/node projects incl. the new `.test.tsx`
- `bun run test` -- expected: all pass — the new jsdom `web` project covers every I/O-matrix row (toast auto-dismiss + UNDO + announce, banner variants/persistence, skeleton reduced-motion, live-region announce, empty-state variants); `src/core/**`, `test/integration/**`, and `purity.test.ts` unchanged and green
- `bun run build` -- expected: `tsc -b && vite build` clean; the PWA plugin emits `dist/**/sw.js` + `manifest.webmanifest` and the 192/512/maskable icons; fonts bundled

**Manual checks (if no CLI):**
- Build output contains a service worker + web manifest with `name: "PRESS START"`, `display: "standalone"`, `theme_color`/`background_color` `#05090f`, and ≥192 & 512 icons (installability).
- Rendered authenticated shell: void background with Tron-grid + blue→magenta wash, PRESS START wordmark + tagline, no Sony marks; a visible focus outline on tab; controls hit ≥44px; `prefers-reduced-motion` stops blink/shimmer.
- `web/index.css` contains no `prefers-color-scheme: light` / light-theme variables.

## Review Triage Log

### 2026-07-07 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 1, medium 3, low 7)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` Registered service worker's `navigateFallback: '/index.html'` had no denylist, so the magic-link verify navigation (`GET /api/auth/*`) would be served cached `index.html` instead of reaching the Worker — silently breaking sign-in (regressing Story 1.3). Added `navigateFallbackDenylist: [/^\/api\//]` (`vite.config.ts`); verified `denylist:[/^\/api\//]` is bound to the NavigationRoute in the built `sw.js`.
  - `[medium]` `[patch]` Stacked toasts reset each other's dismiss timer and re-announced: `ToastHost` passed a fresh `onDismiss` closure each render, which the `Toast` effect depended on. Moved `onDismiss` to a ref and split announce/timer effects so each runs once per toast, independent of sibling re-renders (`web/components/Toast.tsx`).
  - `[medium]` `[patch]` Concurrent `announce()` calls collapsed in the single live region (each cancelled the prior frame → only the last was spoken). Reworked `LiveRegion` to queue messages and play them out sequentially with a brief hold (`web/components/LiveRegion.tsx`).
  - `[medium]` `[patch]` PWA precache force-downloaded every variable-font subset (cyrillic/greek/vietnamese/latin-ext) on install, contradicting the latin-only/NFR-3 intent. Added workbox `globIgnores` for those subsets (`vite.config.ts`); precache dropped 33→23 entries (724→515 KiB), latin subset retained.
  - `[low]` `[patch]` Toast was double-announced (visual node `role="status"` + explicit `announce()`), including a StrictMode dev double. Removed `role="status"` (LiveRegion is now the single channel) and guarded the announce to fire exactly once (`web/components/Toast.tsx`).
  - `[low]` `[patch]` Global `:focus-visible` set `border-radius: var(--radius-sm)`, deforming pill controls (sign-out, UNDO, banner/empty-state actions) on focus. Removed the radius from the shared focus rule; the offset outline already reads as distinct (`web/index.css`).
  - `[low]` `[patch]` `SkeletonGrid` keyed tiles with `crypto.randomUUID()`, which throws in non-secure contexts (e.g. testing the PWA over `http://<lan-ip>`). Replaced with a monotonic module counter — unique, non-index keys without the crypto dependency (`web/components/Skeleton.tsx`).
  - `[low]` `[patch]` `LiveRegionProvider` left a pending `requestAnimationFrame`/timeout uncancelled on unmount. Added a cleanup effect (`web/components/LiveRegion.tsx`).
  - `[low]` `[patch]` Sign-out had no in-flight guard; a double-click could fire two concurrent `signOut()` calls. Added a ref guard that ignores re-entry while a sign-out is pending (`web/App.tsx`).
  - `[low]` `[patch]` Toast auto-dismiss was not timing-adjustable — UNDO vanished after 3s before a keyboard/AT user could reach it (WCAG 2.2.1). Auto-dismiss now pauses on hover/focus and resumes on leave/blur (`web/components/Toast.tsx`).
  - `[low]` `[patch]` `scripts/generate-icons.ts` imported `sharp`, which was undeclared, while the added `@vite-pwa/assets-generator` devDep was unused. Swapped the unused dep for an explicit `sharp` devDependency and reconciled the lockfile (`package.json`, `bun.lock`).

## Auto Run Result

Status: done

**Summary:** Replaced the Cloudflare/Vite scaffold with the PRESS START design system — dark-only CSS-variable tokens (palette, spacing, radii, four self-hosted faces), a responsive installable PWA app shell (void Tron-grid + blue→magenta wash background, wordmark + tagline header, working sign-out), five reusable feedback primitives (AttentionBanner, Toast, Skeleton, EmptyState, polite LiveRegion) with co-located tests, a restyled magic-link Login, and a new jsdom Vitest project for the `web/` layer. This session resumed the run after the original dev session hit its timeout mid-`dev-verify`: it re-verified the implementation, ran the adversarial review, applied 11 patches, and finalized.

**Files changed (highlights):**
- `web/tokens.css`, `web/fonts.css`, `web/index.css` — design tokens, self-hosted latin-subset faces, dark-only tokened base + focus/reduced-motion floors
- `web/shell/*` — Background, Wordmark, Header (with sign-out), AppShell frame + styles
- `web/components/*` — AttentionBanner, Toast, Skeleton, EmptyState, LiveRegion primitives (+ hit-area util) and their tests
- `web/App.tsx`, `web/Login.tsx`, `web/main.tsx` — session gate → shell/Login, PWA SW registration, global CSS wiring, sign-out in-flight guard
- `vite.config.ts` — `vite-plugin-pwa` (manifest, SW) with `navigateFallbackDenylist` for `/api/` and font-subset `globIgnores`
- `vitest.config.ts`, `web/test-setup.ts` — jsdom `web` project (React plugin, jest-dom, matchMedia/rAF polyfills)
- `index.html`, `public/*` (PRESS START icons + favicon), `scripts/*` (icon source + generator), `package.json`/`bun.lock` — installability + tooling

**Review findings breakdown:** 11 patches applied (1 high, 3 medium, 7 low); 0 deferred; 0 rejected; 0 intent-gap; 0 bad-spec (no re-derivation loop).

**Verification performed (post-patch, in the run worktree):**
- `bun run lint` — clean (Biome, 76 files)
- `bun run typecheck` — clean (`tsc -b`)
- `bun run test` — 133 passed (13 files, incl. all 5 web primitive suites)
- `bun run build` — clean; PWA emits `sw.js` + `manifest.webmanifest` + 192/512/maskable icons; precache 23 entries / 515 KiB; verified the `/api/` denylist and non-latin-subset exclusion in the built `sw.js`

**Residual risks:** The auto-dismiss pause-on-hover/focus and the sequential LiveRegion queue are new behaviors worth an independent confirmation (hence follow-up review recommended). Toast/live-region announcement quality is covered by unit tests but not exercised against a real screen reader. PWA installability and the phone↔desktop responsive deltas are asserted structurally (manifest/SW/CSS), not via device testing.
