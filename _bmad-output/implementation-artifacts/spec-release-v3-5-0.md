---
title: 'Release v3.5.0'
type: 'chore'
created: '2026-08-15'
status: 'done'
route: 'one-shot'
---

# Release v3.5.0

## Intent

**Problem:** Console selection functionality is complete but package metadata and release history still identify v3.4.0.

**Approach:** Set the package version to 3.5.0 and document user-selectable PlayStation platform filtering in the changelog.

## Suggested Review Order

**Release identity**

- Package metadata establishes the version used by the release.
  [`package.json:4`](../../package.json#L4)

**Release notes**

- Changelog captures platform selection, matching scope, and unchanged background behavior.
  [`CHANGELOG.md:7`](../../CHANGELOG.md#L7)
