---
title: 'Final wishlist spike — capture the `storeRetrieveWishlist` hash and confirm its auth path'
type: 'chore'
created: '2026-07-14'
status: 'done'
baseline_revision: '449f183fe925c4066d37da5049a80917d2a0ffb8'
final_revision: '449f183fe925c4066d37da5049a80917d2a0ffb8'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** S-1 (DW-10) identified the PS Store wishlist as the Apollo persisted query `storeRetrieveWishlist` but could not get its `sha256Hash` — computed candidates 404'd (Apollo hashes the printed AST). Story 9.4 stays in this epic or drops to Future purely on whether that hash exists and the endpoint is reachable under the bearer the app now carries (post-9.1b).

**Approach:** Capture the real hash from a signed-in browser session on `library.playstation.com/wishlist`, then probe the endpoint under the NPSSO bearer and record reachability in `deferred-work.md` (extending DW-10).

## Boundaries & Constraints

**Always:** Record what is *observed* against live PSN — the hash the real client registers, and the observed status/shape of the wishlist endpoint under the bearer. Only a 2xx carrying `data{}` is "reachable"; a 200+`errors[]` denial or a `PersistedQueryNotFound` is not.

**Block If:** the wishlist read turns out never to execute client-side, so no hash is client-observable — a human DevTools capture cannot reveal a request the browser never makes. **This condition is TRUE — see Auto Run Result.**

**Never:** Do not guess the hash. Do not invent reachability from HTTP convention (PROBE-BEFORE-YOU-MAP). No production code need survive.

</intent-contract>

## Code Map

- `tmp/probe-wishlist-hash.ts` -- unauthenticated bundle scan (written by this spike): confirms no store entry-page bundle exposes the operation.
- Browser capture (Claude-in-Chrome, signed-in session, 2026-07-14) -- the actual investigation. Reconstructed the app's own Apollo hashing pipeline in-page and verified it, then probed the live persisted endpoint.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-10, extended with the wishlist verdict.

## Tasks & Acceptance

**Execution:**
- [x] Capture the wishlist gql document from the client bundle and reproduce Apollo's `sha256(print(addTypename(parse(doc))))` hashing -- validated exact against the client-executed `getCartItemCount` query (known-good hash `98136…`) -- so the recipe is proven, not assumed.
- [x] Probe `storeRetrieveWishlist` under the NPSSO-bearer session with every candidate hash -- all return `PersistedQueryNotFound`.
- [x] Determine why -- the wishlist read is server-side-rendered; `__NEXT_DATA__` carries `storeWishlistSecure` and the real wishlist titles, and no client GraphQL request fires on load or scroll.
- [x] Record the verdict in `deferred-work.md` (DW-10) and drop Story 9.4 to Future.

**Acceptance Criteria:**
- Given a signed-in wishlist session, when the real persisted request is sought, then the finding is recorded from observation — here, that the browser issues no client-side `storeRetrieveWishlist` at all.
- Given the endpoint probed under the bearer with the reconstructed hash, then its reachability is recorded (not reachable — `PersistedQueryNotFound`) and the sequencing consequence stated: 9.4 drops to Future.

## Auto Run Result

Status: done (2026-07-14, via a signed-in browser capture the user authorised)

**Verdict: the wishlist read is NOT reachable by the app, and Story 9.4 drops to Future.**

The investigation went further than DW-10's planned DevTools capture, because the capture it assumed is impossible on the current site:

1. **The wishlist page is server-side-rendered.** `__NEXT_DATA__` on `library.playstation.com/wishlist` already contains `storeWishlistSecure` and the actual wishlisted product titles. No client-side `storeRetrieveWishlist` GraphQL request fires on load or on scroll — Sony's Next.js server executes the persisted query against its own internal manifest and ships the data pre-rendered. There is no client request to capture.

2. **The client bundle's copy of the query is not in the client-reachable persisted allowlist.** The gql document was extracted from `wishlist-819ebbe0…js` and hashed with the app's *own* `parse`/`print` (pulled from its webpack modules) via `sha256(print(addTypename(parse(doc))))`. That recipe was validated **exact** against the `getCartItemCount` query — which the app *does* execute client-side — reproducing its registered hash `98136…` byte-for-byte. Applied to the wishlist document, every candidate (raw, trimmed, collapsed, print±`__typename`, ±root) returns HTTP 404 `PersistedQueryNotFound`. Freeform GraphQL stays refused (400, CSRF/persisted-only). So the wishlist operation is genuinely absent from the persisted allowlist the endpoint honours for client callers.

3. **Consequence (the story's stated branch).** The wishlist endpoint is reachable under **neither** credential from the app's server-to-server position: freeform is refused, and the only working path is Sony's server-side persisted manifest, which is not client-observable and not something the Worker can obtain. Per Story 9.1c's contract and Story 9.4's first AC — *"if 9.1c concluded the endpoint is reachable under neither credential, this story is removed from Epic 9 and filed to Future"* — **Story 9.4 is dropped to Future.**

This closes the last open thread S-1 left. Epic 9 ships with 9.1b, 9.2, and 9.3; 9.4 is filed to Future with the evidence above.
