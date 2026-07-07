import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/**
 * better-auth React client. Defaults match the Worker: same origin, base
 * path `/api/auth` (see `src/services/auth.ts`), so no per-env config.
 */
export const authClient = createAuthClient({
	plugins: [magicLinkClient()],
});
