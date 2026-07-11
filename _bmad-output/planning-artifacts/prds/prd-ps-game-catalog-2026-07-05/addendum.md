# PRD Addendum — ps-game-catalog

Depth that belongs downstream (architecture, UX), or that earned a place but doesn't fit the PRD narrative.

## Sale detection & notifications (future, not v1)

User-volunteered during PRD discovery (2026-07-05): detect when a wishlisted game goes on sale on the PS Store; notify the user.

- **Mechanism sketch:** a daily scheduled job (cron) checks PS Store pricing for wishlisted titles; on a price drop, it sends a notification (channel TBD — email is the obvious free-tier fit).
- **Feasibility notes for architecture time:** Sony has no official public pricing API. Candidate paths: the same web-facing PS Store GraphQL endpoints used elsewhere in the app (persisted queries, subject to breakage), or third-party price trackers (PSPrices-style) with no stable API. Free-tier scheduled-job options exist (e.g. Cloudflare Cron Triggers) and fit the stateless-app constraint.
- **Prerequisite:** a PS Store product ID per wishlisted game — the "View on PS Store" v1 link (FR-16: product URL when known, store-search fallback) is the natural place to start capturing these.

## Membership-sourced entitlements rationale (FR-9 / FR-26 / FR-33)

Adversarial review against the real PS library export (2026-07-05) found **123 of 175 entries are `membership: PS_PLUS`** — subscription claims (monthly Essential games, Extra-catalog additions), not purchases. Treating them as `Owned` would make ~70% of the "owned" library subscription-access titles, contradict the "availability is not ownership" non-goal, and hollow out the wishlist-before-purchase check (a claimed game would silently vanish from the wishlist).

**Decision:** `Owned` means purchased. Membership-sourced entries are skipped entirely by seed import and sync — never created, never `Owned` — and reported as a count in the import/sync summaries. Games Luca actually cares about arrive through the doors that express intent: the Notion seed (curated) and add-by-name (moment of discovery). Auto-adding 123 uncurated claims would bury the backlog shelf under games claimed reflexively and never played.

**Accepted edge cases:**
- A tracked, claimed monthly (Essential) game is not in the Extra catalog, so it won't show `Playable now` even though it is playable — accepted; the Extra check is the only catalog signal v1 has.
- A tracked, claimed game remains derived-`Wishlisted` (not owned) — arguably correct: claims lapse with the subscription, so it may still be worth buying.
- If the entitlement source is ever ambiguous in the API, sync should prefer skipping over flipping `Owned` — a missed flip is one manual toggle; a wrong `Owned` silently poisons the wishlist.

## Replay mechanics rationale

Completion milestones as immutable dates (not statuses) make replays safe by construction: status returns to `Playing` while `completed_on`/`platinum_on` stand. The user never replays platinumed games today; the model supports it anyway as cheap publish-someday insurance. Rejected alternative: a "Finished-but-idle" status — that's completion-as-a-status through the side door, and it would need manual upkeep.

## Ownership-type inference rationale

Sync-sourced = digital, manual = physical (default, editable). Chosen over a mandatory toggle to keep the add flow zero-friction; over pure inference to survive edge cases (gifted discs later bought digitally, delisted digital titles). Ownership-type breakdown is also a known differentiator for future stats dashboards (see landscape scan: Backloggd's digital/physical breakdowns are praised).

### AMENDED 2026-07-11 — claims count as Owned, flagged by source

Product decision (Luca, 2026-07-11), reversing the 2026-07-05 call above: **claimed games ARE ready to play** (for as long as the subscription lasts), so membership-sourced entries count as `Owned` in both seed and sync — the seed had already shipped this way (story 1.6). The original concern (ownership purity, cancel-subscription drift) is answered structurally instead of by exclusion:

- `game_tracking.owned_via` (`purchase` | `membership`) records how ownership was acquired. Claims never stamp `bought_on`; buying a previously claimed game upgrades the source and stamps it (write-once).
- If the subscription is ever cancelled, a future flow un-owns exactly the `owned_via = 'membership'` rows — purchases untouched.
- FR-9/FR-26/FR-33/FR-37 read accordingly: sync creates/flips claims like purchases (flagged), summaries report claims with a PS+ tag instead of a skip count; only WEBMAF web-app entitlements are excluded.
- Accepted consequence: the library reflects everything claimed (~123 of 175 real export entries) — the curation concern above is superseded by "playable is what matters".
