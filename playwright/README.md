# Playwright e2e tier

Real browser against the real app: vite dev + Worker + an **isolated local D1**
(`wrangler.jsonc` → `env.e2e`, selected via `CLOUDFLARE_ENV=e2e`). No mocks of
our own backend. Epic 2.5 TR-1.

## Run

```bash
bun run test:e2e        # headless
bun run test:e2e:ui     # Playwright UI mode
bun x playwright test --headed --debug   # step through
bun x playwright show-report             # last HTML report
```

No setup beyond `bun install` (+ `bun x playwright install chromium` once).
The suite owns its server: global-setup applies migrations to the e2e D1,
spawns `vite dev` on **port 5175**, and tears it down afterwards. Your own
`bun run dev` on 5173 is untouched, as is your dev database.

## Auth (magic link, zero real emails)

`.dev.vars.e2e` deliberately has no `RESEND_API_KEY`, so the Worker uses the
console email provider. Global-setup requests a magic link for
`e2e@press-start.local`, captures the URL from the server's stdout, visits it,
and saves the session to `playwright/.auth/user.json` — every test starts
already signed in. This is why the server is spawned by global-setup instead
of Playwright's `webServer` (stdout would be unreachable).

## Architecture

```
playwright/
├── e2e/                      # specs
└── support/
    ├── merged-fixtures.ts    # THE test object — import test/expect from here, never @playwright/test
    ├── global-setup.ts       # migrations + server spawn + magic-link auth
    ├── global-teardown.ts    # kills the server tree
    ├── server.ts             # shared constants (port, e2e email, paths)
    ├── factories/game-factory.ts   # createGame(overrides) — uuid-unique, parallel-safe
    └── helpers/d1.ts         # seedGame/deleteGame via `wrangler d1 execute --env e2e`
```

Merged fixtures (from `@seontechnologies/playwright-utils`): `apiRequest`
(typed HTTP client), `interceptNetworkCall` (spy/stub), `log`, and
`networkErrorMonitor` — any HTTP 4xx/5xx during a test **fails it**, even if
the UI looks fine. Testing an error path? Opt out:

```ts
test('shows expired-cookie banner', { annotation: [{ type: 'skipNetworkMonitoring' }] }, async ({ page }) => { ... });
```

## Practices

- **Selectors**: role/accessible-name first (`getByRole('button', { name: 'Owned — Bloodborne' })`);
  `getByTestId` where names don't reach (`shelf-card`). Never CSS classes.
- **Setup via data, not UI**: `seedGame(createGame({...}))` — there's no
  create-game API until Epic 6, so seeding goes straight to the e2e D1.
- **Isolation**: factories generate unique titles; delete what you seed
  (`try/finally` or a fixture) so specs stay parallel-safe (`fullyParallel: true`).
- **Standing rule (TR-3)**: every AC with a UI flow ships with a Playwright test.

## CI

`playwright.config.ts` is CI-aware: 2 retries, JUnit + HTML reporters,
trace/screenshot/video retained on failure. The job needs Bun + `bun x
playwright install --with-deps chromium`, then `bun run test:e2e`. (CI wiring
lands with the Epic 2.5 stories / `bmad-testarch-ci`.)

## Troubleshooting

- **Global setup times out waiting for the magic link** → something sent a
  real email instead: check `.dev.vars.e2e` still has no `RESEND_API_KEY`.
  The captured server output is printed on failure.
- **Port 5175 busy** → a previous run leaked; kill it (`taskkill /pid <pid> /T /F`)
  or set `BASE_URL` to another port.
- **Stale/corrupt e2e data** → the e2e D1 lives under `.wrangler/state/v3/d1`
  (database id `00000000-e2e0-…`); delete that database's folder and rerun —
  global-setup re-applies migrations.
- **Debugging a failure** → `bun x playwright show-trace test-results/<test>/trace.zip`.

## References

TEA knowledge fragments used: `overview`, `fixtures-composition`,
`auth-session`, `data-factories`, `network-error-monitor`
(`.claude/skills/bmad-testarch-framework/resources/knowledge/`).
playwright-utils docs: <https://github.com/seontechnologies/playwright-utils>
