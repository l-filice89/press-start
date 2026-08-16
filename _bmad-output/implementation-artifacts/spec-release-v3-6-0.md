---
title: 'Release v3.6.0'
type: 'chore'
created: '2026-08-16'
status: 'done'
route: 'one-shot'
---

# Release v3.6.0

## Intent

**Problem:** Permanent account deletion is complete, but package metadata and release history still identify v3.5.0.

**Approach:** Set the package version to 3.6.0 and document the complete account-deletion, reauthentication, cleanup, and session-security behavior since v3.5.0.

## Suggested Review Order

**Release identity**

- Package metadata establishes the version used by the release.
  [`package.json:4`](../../package.json#L4)

**Release notes**

- Changelog covers every user-visible and security-relevant change since v3.5.0.
  [`CHANGELOG.md:7`](../../CHANGELOG.md#L7)
