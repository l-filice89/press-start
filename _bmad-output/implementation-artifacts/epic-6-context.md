# Epic 6 Context: Add at the Moment of Discovery + Chores

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let Luca capture a game in the seconds a discovery moment lasts: type a name into the persistent search bar and add it from the games DB (IGDB) — or save a name-only fallback when the games DB is down or lacks the title. Round out the library's data safety and hygiene: resolve import stragglers by manual search, export the full library to CSV as a user-held second copy, and manage app settings. This epic builds the `IgdbProvider` adapter.

## Stories

- Story 6.1: Add a game by name (the wishlist moment)
- Story 6.2: Name-only fallback & straggler resolution
- Story 6.3: Chores — CSV export & settings

## Requirements & Constraints

**Add-by-name (6.1)**
- Search matches the existing library first: picking an already-tracked game opens its detail view — never create a duplicate. Search covers the whole library, ignoring active filters and hidden states.
- No library match → top result row is `＋ Add "<name>"`. Tapping opens a preview pre-filled from the games DB (cover, genres, release date); everything is editable; nothing commits until Save.
- Save CTA names the outcome ("Add to wishlist" / "Add as owned"). Defaults: not owned (= wishlisted, `wishlisted_on` recorded), status Not started.
- Saving a game with unknown genres auto-creates the genre rows.
- Successful add: toast confirms; game appears on the shelf.

**Fallback & stragglers (6.2)**
- The discovery moment never depends on a third party being up: if the games DB is unreachable or lacks the title, save a name-only entry (no cover/genres, release date unknown = not released) flagged `unenriched`; it lands in the stragglers list for later enrichment.
- Stragglers surface via the attention banner; each is resolvable by manual search from the app — no interactive import session.
- Resolving an import straggler carries its Notion payload (status, dates, owned flag) onto the matched game.
- A manual match is permanent: it stores the external-ID/title-alias link so future syncs recognize the game and never re-add it as a duplicate.
- Failures surface, never silently retry: a failed external lookup lands the game in stragglers.

**Chores (6.3)**
- CSV export covers the full library — games, statuses, milestones, lifecycle dates, genres, ownership — as a download. Rationale: the DB provider's backups must not be the only copy.
- Settings: FAB handedness (bottom-right/bottom-left), sign out, About/Help.
- Auth is better-auth magic link; sign-out is a session concern.

## Technical Decisions

- **Provider port:** every IGDB call goes through an `IgdbProvider` adapter in `providers/` — the sole external-I/O seam. IGDB auth is Twitch OAuth2 client-credentials; creds live in Wrangler secrets.
- **No external calls on render** (structural rule): IGDB is queried only from explicit user actions (add-by-name search, straggler resolution), never on page load. Stay within the 50-external-subrequests/invocation cap.
- **Straggler is a defined record with two kinds:** (a) import staging rows unmatched to a `GAME` (carry Notion payload; not yet a `GAME`), and (b) name-only add-by-name entries (real `GAME` rows flagged `unenriched`). The stragglers list is a view over both.
- **Identity & matching:** `title_normalized` (single shared normalization function) is a non-unique candidate key; external-ID is identity. `EXTERNAL_LINK` allows many rows per (game, source) — sources are `PSN|IGDB`. Resolving a straggler writes a permanent link that survives re-sync.
- **Layering:** routes → services → core (I/O-free) / repositories (D1) / providers. Duplicate-detection and match logic are pure `core/` functions; persistence only through repositories.
- **CSV export** streams from D1 in `routes/`; genres use the IGDB vocabulary.
- **Data shape:** shared `GAME` facts (title, release date, cover, genres, `unenriched` flag) vs per-user `GAME_TRACKING` state (owned, status, `wishlisted_on`, milestones). Tracking rows are user-scoped; user data is append-only through the one write-path guard.

## UX & Interaction Patterns

- **Search bar is the sole Add entry point** — persistent, pill-shaped; bottom-pinned on mobile, header-left on desktop; global focus shortcut. Combobox semantics (`role=combobox`, `aria-activedescendant`); result count and the `＋ Add` row announce via a polite live region. No Add in the FAB drawer.
- **FAB drawer = chores only:** Sync library · Check PS+ Extra · Export CSV · Settings · About/Help. Icons-only mobile / icons+text desktop; icon-only items carry accessible names. Each item opens a modal; long-running items show a spinner.
- **Attention banner:** single under-header zone, shown only when action is needed, self-clears when resolved. Stragglers = amber; expired cookie = magenta; failed refresh = steel.
- Toasts announce via polite live region; success is green.
- Legal: "PlayStation"/Sony marks never appear in app branding/chrome — descriptive text only (e.g. Settings help copy).
- Reference mockups: `add-stragglers-flow.html`, `settings-login-mock.html`, `ia-shell-wireframe.html` in the UX design folder.

## Cross-Story Dependencies

- 6.1 and 6.2 depend only on Epic 1's search bar and shelf (both shipped).
- 6.3's FAB drawer shell is shared with Epic 4, which already landed — the shell and a settings surface exist; this epic adds the "Export CSV" and "About/Help" drawer items and the handedness/sign-out settings.
- 6.2 builds on the same normalization/matching and straggler machinery used by seed import and PSN sync (Epics 3–4); resolution links must be honored by future syncs.
- Already delivered ahead of this epic (removed from 6.3's ACs): centralized 401 re-auth redirect and shelf-grid ARIA row regrouping.
