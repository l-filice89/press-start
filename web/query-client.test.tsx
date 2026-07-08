import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const EMAIL = 'player@example.com';

/**
 * better-auth captures `globalThis.fetch` into `customFetchImpl` when its client
 * module is first imported, so the stub must exist *before* `./auth-client` is
 * imported (via `./App`) — hence `vi.hoisted` + dynamic import, rather than the
 * `vi.stubGlobal` the component tests use.
 *
 * `state.shelf` is a promise so a test can hold the shelf request open, assert
 * the signed-in shell rendered, and only then answer with the 401.
 */
const { fetchMock, state } = vi.hoisted(() => {
	const state = {
		shelf: Promise.resolve(200),
		sessionExpired: false,
	};
	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/api/auth/get-session')) {
			return json(
				state.sessionExpired
					? null
					: {
							session: { id: 's1', userId: 'u1' },
							user: { id: 'u1', email: 'player@example.com' },
						},
			);
		}
		if (url.includes('/api/shelf')) {
			const status = await state.shelf;
			// The expired cookie: once the server rejects an authed read, the session
			// endpoint stops answering with a session too.
			if (status === 401) state.sessionExpired = true;
			return json(status === 200 ? { games: [] } : {}, status);
		}
		return json(null);
	});
	globalThis.fetch = fetchMock as typeof fetch;
	return { fetchMock, state };
});

const { authClient } = await import('./auth-client');
const { default: App } = await import('./App');
const { createQueryClient } = await import('./query-client');

function renderApp() {
	return render(
		<QueryClientProvider client={createQueryClient()}>
			<App />
		</QueryClientProvider>,
	);
}

const findLoginField = () =>
	screen.findByLabelText(/Sign in with a magic link/i, undefined, {
		timeout: 3000,
	});

const callCount = (path: string) =>
	fetchMock.mock.calls.filter(([input]) => String(input).includes(path)).length;

const shelfCallCount = () => callCount('/api/shelf');
const sessionCallCount = () => callCount('/api/auth/get-session');

beforeEach(() => {
	fetchMock.mockClear();
	state.sessionExpired = false;
	state.shelf = Promise.resolve(200);
	// nanostores keeps the session atom mounted for a beat after unmount, so a
	// prior test's signed-out session survives into the next one. Re-signal it.
	authClient.$store.notify('$sessionSignal');
});

describe('createQueryClient — central 401 re-auth', () => {
	it('routes a signed-in user to Login on a 401, without retrying it', async () => {
		let answerShelf!: (status: number) => void;
		state.shelf = new Promise((resolve) => {
			answerShelf = resolve;
		});

		renderApp();
		// The signed-in shell renders first; the shelf request is still in flight.
		expect(
			await screen.findByRole('button', { name: `Sign out ${EMAIL}` }),
		).toBeInTheDocument();

		answerShelf(401);

		expect(await findLoginField()).toBeInTheDocument();
		expect(shelfCallCount()).toBe(1);
	});

	// 403, not 500: a 5xx retries three times with exponential backoff (~7s), and
	// the point here is only that a non-401 error never touches the session.
	it('leaves the user signed in on a non-401 failure, without refetching the session', async () => {
		let answerShelf!: (status: number) => void;
		state.shelf = new Promise((resolve) => {
			answerShelf = resolve;
		});

		renderApp();
		expect(
			await screen.findByRole('button', { name: `Sign out ${EMAIL}` }),
		).toBeInTheDocument();
		const sessionCallsBeforeError = sessionCallCount();

		answerShelf(403);

		expect(
			await screen.findByRole('alert', undefined, { timeout: 3000 }),
		).toHaveTextContent(/shelf couldn’t load/i);
		expect(
			screen.queryByLabelText(/Sign in with a magic link/i),
		).not.toBeInTheDocument();
		// The invariant, not just the UI: a non-401 never touches the session.
		expect(sessionCallCount()).toBe(sessionCallsBeforeError);
	});
});
