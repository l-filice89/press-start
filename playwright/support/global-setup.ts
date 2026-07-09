import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request } from '@playwright/test';
import { BASE_URL, E2E_EMAIL, E2E_PORT, PID_FILE, STORAGE_STATE } from './server';

/**
 * Boots the real app (vite dev + Worker + isolated e2e D1) and signs in once
 * via the magic-link flow (Epic 2.5 TR-1): the console email provider prints
 * the link to the dev server's stdout, we capture it there, visit it, and
 * save the session as Playwright storage state for every test.
 */

async function waitFor<T>(
	probe: () => Promise<T | undefined> | T | undefined,
	what: string,
	timeoutMs = 60_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const result = await probe();
		if (result !== undefined) return result;
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 250));
	}
}

export default async function globalSetup() {
	// The e2e D1 database is fresh state under .wrangler — migrations first.
	execFileSync(
		'bun',
		['x', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--env', 'e2e'],
		{ stdio: 'inherit' },
	);

	// Spawn the dev server ourselves (not Playwright's webServer): we must
	// read its stdout to capture the magic link.
	const child = spawn('bun', ['x', 'vite', 'dev', '--port', String(E2E_PORT), '--strictPort'], {
		env: { ...process.env, CLOUDFLARE_ENV: 'e2e' },
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: process.platform !== 'win32', // POSIX: own process group so teardown can kill the tree
	});
	let output = '';
	child.stdout.on('data', (d: Buffer) => {
		output += d.toString();
	});
	child.stderr.on('data', (d: Buffer) => {
		output += d.toString();
	});
	writeFileSync(PID_FILE, String(child.pid));

	try {
		const api = await request.newContext({ baseURL: BASE_URL });

		await waitFor(async () => {
			const ok = await api
				.get('/api/health')
				.then((r) => r.ok())
				.catch(() => false);
			return ok || undefined;
		}, `dev server on ${BASE_URL}`);

		const signIn = await api.post('/api/auth/sign-in/magic-link', {
			data: { email: E2E_EMAIL, callbackURL: '/' },
			headers: { Origin: BASE_URL },
		});
		if (!signIn.ok()) {
			throw new Error(`magic-link request failed: ${signIn.status()} ${await signIn.text()}`);
		}

		const link = await waitFor(
			() => output.match(/\[auth\] magic link for \S+: (\S+)/)?.[1],
			'magic link in server stdout (is the console email provider active?)',
			15_000,
		);

		const verify = await api.get(link); // follows the redirect, session cookie lands in the context
		if (!verify.ok()) {
			throw new Error(`magic-link verify failed: ${verify.status()}`);
		}
		const me = await api.get('/api/me');
		if (!me.ok()) {
			throw new Error(`session not established: /api/me returned ${me.status()}`);
		}

		mkdirSync('playwright/.auth', { recursive: true });
		await api.storageState({ path: STORAGE_STATE });
		await api.dispose();
	} catch (error) {
		// Don't leak the server if auth bootstrap fails.
		const { default: globalTeardown } = await import('./global-teardown');
		await globalTeardown();
		console.error('--- e2e server output ---\n', output);
		throw error;
	}
}
