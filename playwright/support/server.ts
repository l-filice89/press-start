/**
 * Constants shared by global-setup/teardown. The e2e server runs on its own
 * port (dev instances usually hold 5173/5174) with CLOUDFLARE_ENV=e2e, which
 * selects the isolated D1 database and the console email provider.
 */
export const E2E_PORT = 5175;
export const BASE_URL = process.env.BASE_URL ?? `http://localhost:${E2E_PORT}`;
export const E2E_EMAIL = 'e2e@press-start.local';
export const STORAGE_STATE = 'playwright/.auth/user.json';
export const PID_FILE = 'playwright/.server.pid';
