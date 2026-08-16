import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveRegionProvider } from './components/LiveRegion';

const { clearEtagCache } = vi.hoisted(() => ({
	clearEtagCache: vi.fn(),
}));

vi.mock('./auth-client', () => ({
	authClient: {
		useSession: () => ({ data: null, isPending: false }),
	},
}));
vi.mock('./shelf/api', () => ({ clearEtagCache }));

import App from './App';

describe('App session gate', () => {
	it('clears query and ETag caches before showing Login without a session', async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(['shelf'], { games: [{ id: 'previous-user' }] });
		render(
			<QueryClientProvider client={queryClient}>
				<LiveRegionProvider>
					<App />
				</LiveRegionProvider>
			</QueryClientProvider>,
		);

		await waitFor(() =>
			expect(queryClient.getQueryCache().getAll()).toHaveLength(0),
		);
		expect(clearEtagCache).toHaveBeenCalledTimes(1);
	});
});
