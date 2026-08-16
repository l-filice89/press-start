---
title: 'Permanent account deletion'
type: 'feature'
created: '2026-08-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'e5d0b836a5f4ea91edfb95fa093ba7cb1c038a21'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad/custom/standing-rules-core.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Signed-in users cannot permanently delete their Press Start account or its private library/settings data. A destructive action also needs explicit confirmation and renewed proof of email control.

**Approach:** Add an Account section to Settings. Reuse better-auth's verified deletion-email flow: confirmation sends a short-lived, user-bound link; opening it with the same signed-in account consumes the token, deletes the user, cascades private data and every database session, clears the caller cookie, then returns to Login.

## Boundaries & Constraints

**Always:** Use better-auth's existing `/api/auth/delete-user` endpoint, a five-minute deletion token, and existing email provider seam. Nothing is deleted before link verification. Delete `user`, linked `account`, all `session`, `game_tracking`, and `setting` rows; retain shared `game`, genres, links, PS+ datasets, and region state. Current browser returns to Login and client query/ETag caches clear. Other-device session rows are invalidated immediately; signed cookie-cache authority retains the architecture's documented maximum five-minute revocation latency. Token must be single-use, bound to same user and valid session, and preserve all data on invalid, expired, replayed, wrong-user, email-send, or deletion failure. Confirmation follows WAI-ARIA modal-dialog pattern: underlying Settings inert, Cancel initially focused, Escape/backdrop cancel, focus trapped, pending activation single-flight, result announced without color alone.

**Ask First:** Changing the five-minute session-cache ceiling, deleting shared catalog facts, or changing approved placement/responsive behavior.

**Never:** Add password auth, typed email/`DELETE` as fake reauthentication, a parallel custom deletion endpoint/token store, undo/soft-delete, or silent failure.

**External-risk sign-off:** Deletion reuses configured Resend/console email delivery and sends only the same address already used for magic-link sign-in; no new third party, credential, undocumented endpoint, scraping, or legal exposure is introduced. Approval of this spec accepts that unchanged delivery surface.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Cancel | Delete button, then Cancel/Escape/backdrop | No request or write; focus returns | N/A |
| Request | Confirmed, valid session | One deletion email; account remains; inline “check email” status | Stay open and offer retry on failure |
| Verify | Same user/session, live unused token | Private rows and all DB sessions deleted; shared facts remain; cookie cleared; redirect to Login | N/A |
| Bypass | Missing/wrong user, invalid/expired/replayed token | No deletion and no cross-user change | Safe error; retry from Settings |

### Approved placement mock

```text
SETTINGS (phone sheet / desktop modal)
… existing sections …
DATA BACKUP
ABOUT & HELP
────────────────────────
ACCOUNT
Delete your account
Permanent private-data warning; export-first reminder
[ Delete account ]
[ Close ]

CONFIRM DIALOG (stacked)
Permanently delete your account?
Opening emailed link deletes it; cannot be undone.
[ Cancel ] [ Email deletion link ]
```

| State/class | Phone 320px | Desktop |
|-------------|-------------|---------|
| Idle | Last full-width section; no overflow; ≥44px action | Last peer section above Close |
| Confirm/pending/error | Viewport-fitting stacked dialog; Settings inert | Centered stacked dialog; Settings inert |
| Email sent | Inline status; account still present | Same |
| Verified | Redirect to focused Login | Same |

No breakpoint changes. Shelf, Catalog, Stats, header, existing Settings sections, and their order remain unchanged.

</frozen-after-approval>

## Code Map

- `src/services/auth.ts:54-157` -- enable built-in deletion; current signed cookie cache defines ≤300s other-device revocation ceiling.
- `src/providers/email.ts:10-79` -- extend existing Resend/console seam with deletion-link copy; do not create provider bypass.
- `src/schema/auth.ts:12-78`, `src/schema/catalog.ts:95-221` -- user-owned FK cascades; `verification` is transient/token-owned, while catalog tables are shared and read-only here.
- `src/routes/auth.ts:25-48` -- existing wildcard already exposes better-auth deletion; no new route.
- `web/settings/SettingsPanel.tsx:134-350`, `web/settings/settings-panel.css` -- reuse stacked-dialog/trap structure; add approved final section and state handling.
- `web/App.tsx:17-84`, `web/query-client.ts:12-56`, `web/shelf/api.ts:107-154` -- Login gate, session refresh signal, and cache hygiene after verified redirect.
- `test/integration/auth.test.ts`, `test/integration/session.ts` -- real auth/email/session harness for cleanup and bypass hazards.
- `web/settings/SettingsPanel.test.tsx`, `playwright/e2e/epic4-settings.spec.ts`, `playwright/COVERAGE.md` -- component, isolated-account browser flow, responsive evidence, AC ledger.

## Tasks & Acceptance

**Execution:**
- [x] `src/services/auth.ts`, `src/providers/email.ts` -- configure five-minute verified deletion and dedicated email copy.
- [x] `test/integration/auth.test.ts`, `test/integration/session.ts` -- prove pre-link preservation, cascade scope, all-session deletion, tenant isolation, and token bypass/replay refusal.
- [x] `web/settings/SettingsPanel.tsx`, `web/settings/settings-panel.css` -- implement approved accessible confirmation/request states with no breakpoint change.
- [x] `web/settings/SettingsPanel.test.tsx` -- pin no-write cancel, single-flight request, sent/error states, focus/inert behavior, and unchanged sections.
- [x] `playwright/e2e/account-deletion.spec.ts`, `playwright/COVERAGE.md` -- use a run-unique account, verify real email link → Login/private-data cleanup, and record phone/desktop evidence without deleting shared E2E user.

**Acceptance Criteria:**
- Given Settings on phone or desktop, when opened, then approved Account placement renders without regression, overflow, or sub-44px actions.
- Given user cancels confirmation, when any dismissal path is used, then nothing is requested or deleted and focus returns.
- Given confirmed request, when email delivery succeeds, then account remains until same user's one-use link is opened.
- Given verified deletion, when callback completes, then all private rows/database sessions are absent, shared facts and other users remain, and caller sees Login with stale client caches cleared.
- Given any reauthentication/token bypass or retry after consumption, when attempted, then deletion is refused and standing data survives.

## Spec Change Log

## Verification

**Commands:**
- `bun run test -- test/integration/auth.test.ts web/settings/SettingsPanel.test.tsx` -- targeted cleanup, security, and UI contracts pass.
- `bun run test:e2e -- playwright/e2e/account-deletion.spec.ts` -- real isolated-account confirmation/email/delete journey passes at desktop and 320px.
- `bun run lint && bun run typecheck && bun run test && bun run build` -- full project gates pass.

## Suggested Review Order

**Deletion boundary**

- Entry point enables verified deletion and makes private cleanup one atomic cascade.
  [`auth.ts:159`](../../src/services/auth.ts#L159)

- Repository statement relies on existing user-owned foreign-key cascades.
  [`users.ts:46`](../../src/repositories/users.ts#L46)

- Dedicated provider copy preserves five-minute expiry and delivery failures.
  [`email.ts:66`](../../src/providers/email.ts#L66)

**Settings experience**

- Single-flight mutation owns request, sent, failure, and focus-restoration states.
  [`SettingsPanel.tsx:139`](../../web/settings/SettingsPanel.tsx#L139)

- Approved Account section remains last, peer-level, and export-first.
  [`SettingsPanel.tsx:374`](../../web/settings/SettingsPanel.tsx#L374)

- Shared dialog exposes description, live status, inert stacking, and safe pending focus.
  [`ConfirmDialog.tsx:67`](../../web/components/ConfirmDialog.tsx#L67)

- Session loss clears previous-user query and ETag bodies.
  [`App.tsx:24`](../../web/App.tsx#L24)

**Verification**

- Real-D1 tests pin cascade scope, bypass refusal, and failure atomicity.
  [`auth.test.ts:206`](../../test/integration/auth.test.ts#L206)

- Production Resend payload and rejection behavior run through a direct unit test.
  [`email.test.ts:11`](../../src/providers/email.test.ts#L11)

- Component tests cover every dismissal path, rapid activation, pending, retry, and focus.
  [`SettingsPanel.test.tsx:260`](../../web/settings/SettingsPanel.test.tsx#L260)

- Isolated desktop and 320px journeys verify real emailed deletion end-to-end.
  [`account-deletion.spec.ts:27`](../../playwright/e2e/account-deletion.spec.ts#L27)
