---
status: done
---

# BMad Dev Auto Result

Status: done
Blocking condition: none

## Scope

Deferred-work bundle `decision-dw-6` (resolves DW-6, DW-7, DW-8). Documentation-only change per the human decision "option 1 — Remove as delivered". No code touched.

## Change

`_bmad-output/planning-artifacts/epics.md`, Story 6.3 ("Chores — CSV export & settings"):

- Removed the two trailing acceptance criteria that had no thematic fit with the story:
  - "Given a 401 from an expired session on any authed page …" (centralized re-auth redirect)
  - "Given the shelf card grid on any viewport …" (ARIA row regrouping)
- Added a one-line note under the remaining ACs recording that both concerns shipped ahead of Epic 6 via deferred-work bundles `dw-central-401-reauth-redirect` (DW-3) and `dw-shelf-grid-aria-row-regrouping` (DW-4).

Story 6.3 is now scoped to CSV export and settings. No other story was modified, and the deferred-work ledger was left untouched (the orchestrator records resolution).

## Verification

- Grep of `epics.md` confirms no residual reference to the removed ACs; the remaining `401` matches (lines 79, 240, 769) belong to FR-36 / Epic 4's PS session-cookie auth and are unrelated.
- No test or build check applies: the change touches only a planning artifact with no runtime surface.
