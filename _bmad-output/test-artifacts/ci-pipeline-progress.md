---
stepsCompleted:
  [
    'step-01-preflight',
    'step-02-generate-pipeline',
    'step-03-configure-quality-gates',
    'step-04-validate-and-summary',
  ]
lastStep: 'step-04-validate-and-summary'
lastSaved: '2026-07-10'
---

# CI Pipeline Setup — Progress (Epic 2.5)

## Step 1: Preflight

- **Git**: repo OK, remote `git@github.com:l-filice89/press-start.git` (GitHub)
- **test_stack_type**: `fullstack` (vite.config.ts + playwright.config.ts frontend; vitest.config.ts + Worker API backend)
- **test_framework**: Vitest (`@cloudflare/vitest-pool-workers`) + Playwright (chromium-only, global-setup boots vite dev + Worker + local D1 `e2e` env, magic-link auth via console email provider)
- **Local test runs**: vitest 494/494 pass (~63s); playwright e2e 3/3 pass (~25s)
- **ci_platform**: `github-actions` — existing `.github/workflows/ci.yml` (quality gate: lint, typecheck, vitest, build) + `deploy.yml`. Decision: **update** existing ci.yml (add e2e job), not replace.
- **Environment**: Bun 1.3.14 (pinned in ci.yml), no .nvmrc; deps via `bun install --frozen-lockfile`; Playwright browsers need install step in CI; e2e secrets from committed `.dev.vars.e2e` (throwaway local-only value)

## Step 2: Generate Pipeline

- **Execution mode**: sequential (small pipeline, no parallel workers needed); pact disabled
- **Decision**: updated existing `.github/workflows/ci.yml` instead of creating `test.yml` — one workflow, existing quality-gate job untouched
- Added:
  - `concurrency` group with `cancel-in-progress: true`
  - `e2e` job — runs in parallel with quality-gate; Bun 1.3.14, frozen lockfile, Playwright browser cache (keyed on `bun.lock`), chromium install, `bun run test:e2e`; failure artifacts (playwright-report, test-results incl. traces/videos/junit), 7-day retention
  - `e2e-burn-in` job — PR-only flaky detection; diffs `playwright/e2e/**/*.spec.ts` vs base (via `env:` intermediary, `--diff-filter=d` for deletions), runs changed specs with `--repeat-each 5 --retries 0`; self-skips when no specs changed
- **Skipped** (deliberate): sharding (3 tests — revisit when suite exceeds ~5 min), scheduled weekly burn-in (personal project, PR burn-in suffices), report-merge job (single job → Playwright's own HTML report is already aggregate), always-upload of reports (failure-only keeps artifact noise down)
- CI retries: already 2 via `playwright.config.ts` `process.env.CI`; junit reporter already CI-conditional

## Step 3: Quality Gates & Notifications

- **Burn-in**: enabled (fullstack) — implemented in step 2 as `e2e-burn-in` (changed specs × 5, retries 0). No reusable-workflow extraction (single repo, no consumers) → injection-hardening for `workflow_call` inputs not applicable; the one user-influenceable value (`github.base_ref`) already goes through `env:`.
- **Pass-rate gate**: binary 100% — any vitest/playwright failure fails CI. Stricter than the P0=100%/P1≥95% ladder; no priority tagging exists in a 3-spec suite, so a percentage threshold has nothing to compute against. Revisit if the suite grows tags.
- **Deploy gate**: `deploy.yml` already re-runs lint/typecheck/vitest/build before migrating + deploying, plus post-deploy health/auth smoke. E2e not added to deploy (runs on every push via CI; duplicating it would double the pipeline for no new signal).
- **Contract gates**: n/a (`tea_use_pactjs_utils: false`).
- **Notifications**: GitHub's default failed-workflow email to the committer — sufficient for a solo project; Slack skipped. Failure artifacts linked from the run page (uploaded in step 2).
- **Manual follow-up for Luca (recommended)**: branch protection on `main` requiring the `Quality gate`, `E2E (Playwright)`, and `E2E burn-in (changed specs)` checks.

## Step 4: Validate & Summary

- **YAML syntax**: `ci.yml` lints clean (yaml-lint).
- **Burn-in command verified locally**: `bunx playwright test playwright/e2e/smoke.spec.ts --repeat-each 2 --retries 0` → 6/6 pass.
- **Security check**: no secrets in workflow files; only user-influenceable context used (`github.base_ref`) goes through `env:`; `steps.*.outputs.*` interpolation is in the safe-context list.
- **No new secrets required**: e2e uses committed throwaway `.dev.vars.e2e`; deploy secrets already configured.
- **Checklist deviations (deliberate, ponytail)**: no `test.yml` (extended existing `ci.yml`); no sharding matrix (3 specs); burn-in 5 iterations via native `--repeat-each` instead of 10× bash loop; no cron trigger; no helper scripts (`scripts/burn-in.sh` etc. — CI steps are the single source, all runnable locally verbatim); no `docs/ci.md` (workflow comments + this progress file cover it); failure-only artifacts at 7-day retention.
- **First CI run**: pending — branch `feat/epic-2.5/playwright-foundation` push/PR will trigger it.
