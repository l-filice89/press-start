# Deferred Work

<!-- Append-only ledger of pre-existing or non-blocking issues surfaced incidentally during review. Do not modify existing entries or look for duplicates. -->

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-deployable-project-scaffold-ci-cd.md`
  summary: The I/O matrix's "SPA deep link" scenario has no automated test coverage.
  evidence: `vitest-pool-workers` has no working `ASSETS` binding without a real assets directory wired into `wrangler.jsonc` (confirmed: adding a request through `worker/index.ts`'s `ASSETS.fetch` fallback throws `TypeError: Cannot read properties of undefined (reading 'fetch')` in the test environment). Wiring a real directory in for tests risks disturbing the `@cloudflare/vite-plugin`'s own build-time assets config used by the already-verified production deploy. The scenario is confirmed working by hand (local `vite dev` + live production curl at `https://ps-game-catalog.l-filice-89.workers.dev`), just not by an automated regression test.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-deployable-project-scaffold-ci-cd.md`
  summary: GitHub Actions in `ci.yml`/`deploy.yml` are pinned to floating major-version tags (`actions/checkout@v4`, `oven-sh/setup-bun@v2`) rather than commit SHAs.
  evidence: Standard supply-chain hardening practice for public/production repos — a compromised or buggy release of a major-tag-pinned action could silently affect CI/CD. Low urgency for a private, solo-maintained repo today; worth doing before the repo goes public.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-the-read-only-shelf.md`
  summary: A 401 from an expired session on the shelf shows a generic "couldn't load" error rather than routing the user back to sign-in.
  evidence: `web/shelf/api.ts` throws on any non-OK status and `Shelf.tsx` maps every error to the same message; "Refresh" won't re-authenticate. This story stopped the pointless 3× retry (query client skips 4xx), but a proper re-auth redirect is an app-wide auth-UX concern (better-auth session lifecycle), out of scope for the read-only shelf. Should be handled once, centrally, when the authed-navigation shell is built out.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-the-read-only-shelf.md`
  summary: The card grid is a single ARIA `role="row"` holding all gridcells, while arrow-key nav moves in 2-D by measured column count — so assistive tech announces a 1×N structure that doesn't match the visual/navigational rows.
  evidence: `web/shelf/Shelf.tsx` renders every card in one `.shelf__row`; Up/Down move by `columnCount()`. Reading-order (Left/Right) traversal — the stated a11y-floor invariant — is fully satisfied, so this is a refinement, not a floor break. A faithful fix needs DOM rows that track the responsive `auto-fill` column count (which changes with viewport), a non-trivial layout/ARIA problem better solved deliberately than patched inline.
