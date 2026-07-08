---
title: 'DW-5: Dependabot config for github-actions SHA pins'
type: 'chore'
created: '2026-07-08'
status: 'done'
baseline_revision: '26425a3336ec5d92f8e9b13a0d6471159bf22ed1'
final_revision: 'd1bec9c2c036e40a6a49ee59bb958abfcfc9386b'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** `ci.yml` and `deploy.yml` pin `actions/checkout` and `oven-sh/setup-bun` to commit SHAs with trailing version comments (`# v4.3.1`). Nothing refreshes those pins, so the SHA and its version comment silently rot and drift apart with no update PRs.

**Approach:** Add `.github/dependabot.yml` enabling the `github-actions` ecosystem so Dependabot opens weekly update PRs that bump the SHA pins and keep the trailing version comments in sync.

## Boundaries & Constraints

**Always:** Config must be valid Dependabot v2 YAML. `package-ecosystem: "github-actions"` with `directory: "/"` (Dependabot resolves all workflow files under `.github/workflows/` from repo root). Include a `schedule.interval`.

**Block If:** (none — standalone infra task, no ambiguity requiring human input)

**Never:** Do not edit `ci.yml` / `deploy.yml` — the SHA pins stay as-is. Do not add other ecosystems (npm/bun) — out of scope for this DW entry. Do not use Renovate (Dependabot chosen; native to GitHub, no extra app install). Do not touch the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New action version released | `actions/checkout` publishes newer tag/SHA | Dependabot opens a PR bumping the pinned SHA and updating the `# vX.Y.Z` comment | N/A (GitHub-side) |
| No updates available | All pins current | No PR opened | N/A |
| Config parse | GitHub reads `.github/dependabot.yml` | Accepted as valid v2 config, github-actions updates enabled | Invalid YAML → GitHub surfaces a repo error banner |

</intent-contract>

## Code Map

- `.github/dependabot.yml` -- NEW; the Dependabot v2 config to create.
- `.github/workflows/ci.yml` -- reference only; contains the two SHA-pinned actions Dependabot will track. Do not edit.
- `.github/workflows/deploy.yml` -- reference only; same two SHA pins. Do not edit.

## Tasks & Acceptance

**Execution:**
- [x] `.github/dependabot.yml` -- create Dependabot v2 config with `version: 2` and one `updates` entry for `package-ecosystem: "github-actions"`, `directory: "/"`, `schedule.interval: "weekly"` -- enables automated SHA-pin refresh PRs.

**Acceptance Criteria:**
- Given the repo on GitHub, when `.github/dependabot.yml` is present, then it is a syntactically valid Dependabot v2 config (`version: 2`, `updates` list) that GitHub accepts without a config error.
- Given the github-actions ecosystem entry with `directory: "/"`, when Dependabot scans, then it discovers the SHA pins in both `ci.yml` and `deploy.yml` (Dependabot walks all files under `.github/workflows/`).

## Verification

**Commands:**
- `python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/dependabot.yml')); assert d['version']==2; assert any(u['package-ecosystem']=='github-actions' for u in d['updates']); print('ok')"` -- expected: prints `ok` (valid v2 YAML with github-actions ecosystem).

**Manual checks:**
- Confirm `directory` is `"/"` and a `schedule.interval` is set on the github-actions update entry.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - none

### 2026-07-08 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - none

Notes: Blind Hunter + Edge Case Hunter surfaced only low/info hardening or out-of-scope items — all rejected. Chief candidate, `target-branch`, is moot: `.github/workflows/{ci,deploy}.yml` already exist on `main` (verified via `git ls-tree main`), so Dependabot's default-branch scan covers the SHA pins once this config merges; hardcoding an ephemeral feature branch would be wrong. Others (`open-pull-requests-limit`/`groups`, `commit-message` prefix, `reviewers`/`labels`, `schedule.day`/`timezone`, daily-vs-weekly cadence, comment filename drift) are optional niceties where Dependabot defaults suffice. Out-of-scope: unpinned `bunx wrangler` in deploy.yml (npm/bun ecosystem excluded per spec). GitHub-side residual (comment-sync for third-party `oven-sh/setup-bun`) can only be confirmed on the first real bump PR.

## Auto Run Result

Status: done

**Summary:** Added `.github/dependabot.yml` enabling the `github-actions` ecosystem (weekly, `directory: "/"`) so Dependabot opens update PRs that refresh the SHA pins and trailing `# vX.Y.Z` comments for `actions/checkout` and `oven-sh/setup-bun` in `ci.yml`/`deploy.yml`, preventing silent pin/comment drift.

**Files changed:**
- `.github/dependabot.yml` (new) — Dependabot v2 config, github-actions ecosystem.

**Review findings:** patches applied 0, deferred 0, rejected 3 (initial pass) + 11 (follow-up pass) — all low/info hardening (PR grouping, `open-pull-requests-limit`, labels/reviewers, commit-message prefix, schedule day/timezone), out-of-scope (unpinned `bunx wrangler` — npm/bun excluded), or GitHub-side residuals. `target-branch` rejected: workflows already on `main`, so default-branch scan is correct.

**Follow-up review recommended:** false — no review-driven changes across either pass; single declarative config file.

**Verification:** `python3` yaml parse asserts `version==2`, github-actions entry with `directory=="/"` and `schedule.interval=="weekly"` → printed `ok`.

**Residual risks:** Dependabot behavior is GitHub-side and cannot be exercised locally until the branch reaches GitHub; config validity confirmed offline.
