# Deferred Work

<!-- Append-only ledger of pre-existing or non-blocking issues surfaced incidentally during review. Do not modify existing entries or look for duplicates. -->

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-deployable-project-scaffold-ci-cd.md`
  summary: The I/O matrix's "SPA deep link" scenario has no automated test coverage.
  evidence: `vitest-pool-workers` has no working `ASSETS` binding without a real assets directory wired into `wrangler.jsonc` (confirmed: adding a request through `worker/index.ts`'s `ASSETS.fetch` fallback throws `TypeError: Cannot read properties of undefined (reading 'fetch')` in the test environment). Wiring a real directory in for tests risks disturbing the `@cloudflare/vite-plugin`'s own build-time assets config used by the already-verified production deploy. The scenario is confirmed working by hand (local `vite dev` + live production curl at `https://ps-game-catalog.l-filice-89.workers.dev`), just not by an automated regression test.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-deployable-project-scaffold-ci-cd.md`
  summary: GitHub Actions in `ci.yml`/`deploy.yml` are pinned to floating major-version tags (`actions/checkout@v4`, `oven-sh/setup-bun@v2`) rather than commit SHAs.
  evidence: Standard supply-chain hardening practice for public/production repos — a compromised or buggy release of a major-tag-pinned action could silently affect CI/CD. Low urgency for a private, solo-maintained repo today; worth doing before the repo goes public.
