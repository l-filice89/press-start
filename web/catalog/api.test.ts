import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startGenreSweep, sweepCatalogGenres } from './api';

/**
 * The genre-sweep client loop (Story 7.1's "do it now"): re-posts cursor +
 * generation + lockToken until the cursor comes back null. The lock TOKEN is
 * the capability — dropping it between chunks would let the loop steamroll a
 * running refresh — so every continuation must carry the previous chunk's,
 * and an abandoned loop must hand its token back (release=1) or every other
 * PSN op 409s for the whole lock TTL.
 */

type FetchStub = ReturnType<typeof vi.fn<(url: string) => Promise<unknown>>>;

function stubFetch(handler: (url: string, call: number) => unknown): FetchStub {
	let call = 0;
	const fetchMock = vi.fn(async (url: string) => {
		const body = handler(url, call++);
		if (body instanceof Error) throw body;
		return { ok: true, status: 200, json: async () => body };
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

const chunk = (nextCursor: string | null, lockToken?: string) => ({
	generation: 'gen-1',
	nextCursor,
	...(lockToken ? { lockToken } : {}),
});

describe('sweepCatalogGenres', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('POSTs the cursor chain, carrying generation and lockToken, and stops at null', async () => {
		const chunks = [
			chunk('DRIVING', 'tok-1'),
			chunk('HORROR', 'tok-2'),
			chunk(null),
		];
		const fetchMock = stubFetch((_url, call) => chunks[call]);

		await sweepCatalogGenres('gen-1');

		expect(fetchMock).toHaveBeenCalledTimes(3);
		// POST, never GET — the same path answers the facet-vocabulary READ on GET.
		for (const [, init] of fetchMock.mock.calls as unknown as [
			string,
			RequestInit,
		][]) {
			expect(init.method).toBe('POST');
		}
		const urls = fetchMock.mock.calls.map(([url]) => new URL(url, 'http://x'));
		// First chunk: generation only — the lock is claimed fresh server-side.
		expect(urls[0].searchParams.get('generation')).toBe('gen-1');
		expect(urls[0].searchParams.get('cursor')).toBeNull();
		expect(urls[0].searchParams.get('lockToken')).toBeNull();
		// Continuations present the previous chunk's cursor AND token.
		expect(urls[1].searchParams.get('cursor')).toBe('DRIVING');
		expect(urls[1].searchParams.get('lockToken')).toBe('tok-1');
		expect(urls[2].searchParams.get('cursor')).toBe('HORROR');
		expect(urls[2].searchParams.get('lockToken')).toBe('tok-2');
	});

	it('adopts the generation from the first chunk when the caller has none', async () => {
		const chunks = [chunk('DRIVING', 'tok-1'), chunk(null)];
		const fetchMock = stubFetch((_url, call) => chunks[call]);

		await sweepCatalogGenres();

		const urls = fetchMock.mock.calls.map(([url]) => new URL(url, 'http://x'));
		expect(urls[0].searchParams.get('generation')).toBeNull();
		// The torn-sweep fence arms itself from the server's own answer.
		expect(urls[1].searchParams.get('generation')).toBe('gen-1');
	});

	it('releases the held lock when the loop dies mid-sweep', async () => {
		const fetchMock = stubFetch((_url, call) => {
			if (call === 0) return chunk('DRIVING', 'tok-1');
			if (call === 1) return new Error('network down');
			return { released: true };
		});

		await expect(sweepCatalogGenres('gen-1')).rejects.toThrow('network down');

		const last = new URL(
			fetchMock.mock.calls.at(-1)?.[0] as string,
			'http://x',
		);
		expect(last.searchParams.get('release')).toBe('1');
		expect(last.searchParams.get('lockToken')).toBe('tok-1');
	});

	it('gives up at the cap instead of looping forever — and hands the token back', async () => {
		const fetchMock = stubFetch((url) =>
			url.includes('release=1') ? { released: true } : chunk('STUCK', 'tok'),
		);

		await expect(sweepCatalogGenres()).rejects.toThrow(/did not terminate/);

		expect(fetchMock).toHaveBeenCalledTimes(26); // 25 chunks + the release
		const last = new URL(
			fetchMock.mock.calls.at(-1)?.[0] as string,
			'http://x',
		);
		expect(last.searchParams.get('release')).toBe('1');
	});
});

describe('startGenreSweep', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('invalidates the genre and catalog queries when the sweep lands', async () => {
		stubFetch(() => chunk(null));
		const client = new QueryClient();
		const invalidate = vi.spyOn(client, 'invalidateQueries');

		startGenreSweep(client, 'gen-1');
		await vi.waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({ queryKey: ['catalog'] }),
		);
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['catalog-genres'] });
	});

	it('swallows a sweep failure — a warning, never a throw or an invalidation', async () => {
		const fetchMock = stubFetch(() => new Error('store down'));
		const client = new QueryClient();
		const invalidate = vi.spyOn(client, 'invalidateQueries');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		startGenreSweep(client, 'gen-1');
		await vi.waitFor(() => expect(warn).toHaveBeenCalled());

		expect(fetchMock).toHaveBeenCalled();
		expect(invalidate).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
