/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from '@cloudflare/vitest-pool-workers';

declare module 'vitest' {
	export interface ProvidedContext {
		migrations: D1Migration[];
	}
}
