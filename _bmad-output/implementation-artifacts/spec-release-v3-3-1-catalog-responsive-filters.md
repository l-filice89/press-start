---
title: 'Release v3.3.1 — Catalog responsive filters'
type: 'chore'
created: '2026-08-01'
status: 'done'
route: 'one-shot'
---

# Release v3.3.1 — Catalog responsive filters

## Intent

**Problem:** The completed Catalog responsive-filter fix needs a SemVer version, release notes, protected-branch merge, and production release.

**Approach:** Cut patch version `3.3.1`, document the backward-compatible UI fix, merge through CI, then publish GitHub Release `v3.3.1` to trigger deployment.

## Suggested Review Order

**Release identity**

- Patch version matches backward-compatible responsive bugfix scope.
  [`package.json:4`](../../package.json#L4)

**Release notes**

- Changelog names responsive layout, focus, and honest loading outcomes.
  [`CHANGELOG.md:7`](../../CHANGELOG.md#L7)
