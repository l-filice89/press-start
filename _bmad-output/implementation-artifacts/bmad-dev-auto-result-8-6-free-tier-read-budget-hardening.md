---
status: blocked
---

# BMad Dev Auto Result

Status: blocked
Blocking condition: AC conflict requiring human arbitration at the 8.0 sign-off. Story 8.6 is outside the 8.0 gate (single-tenant-safe), but two of its acceptance criteria collide with the reviewed 8.0 design:

1. **Diff-based snapshot upserts** — the epics AC mandates them; proposed AD-33 §5 (spec-8-0 review, 2026-07-17) REJECTS them: a diff write strands unchanged rows on an old snapshot generation, silently breaking AD-28's generation-carried genre sweep and prune (the "skipped band of games" failure), to save ~1,000 row-writes/region/month against a 100k/day budget. One of the two must yield — Luca's call.
2. **ETag/caching + paged-vs-whole FE delivery** — the AC itself says "decided by Story 8.0"; those rulings (AD-33 §2–4, §6) exist but are PROPOSED, not signed off.

The uncontested ACs (single-row `WHERE id = ?` for `GET /games/:id`, SQL `COUNT(*)` for settings, `LIMIT/OFFSET` for the catalog route) are implementable any time; a story ships whole, so the run blocks rather than shipping a partial. Re-run after the 8.0 sign-off settles points 1–2.
