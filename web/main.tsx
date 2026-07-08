import { registerSW } from 'virtual:pwa-register';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Global styles — order matters: fonts + tokens define what everything else
// references, then base resets, then the shared hit-area utility.
import './fonts.css';
import './tokens.css';
import './index.css';
import './components/hit-area.css';
import App from './App.tsx';

// The app's single TanStack Query client (the architecture-pinned data-fetch
// layer). Reads are cached; the shelf/search queries live under it. A 4xx
// (e.g. an expired session → 401) is a dead end — don't burn the default three
// retries on it; only transient (5xx/network) errors retry.
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: (failureCount, error) => {
				const status = (error as { status?: number }).status;
				if (status && status >= 400 && status < 500) return false;
				return failureCount < 3;
			},
		},
	},
});

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('Root element (#root) not found in index.html');
}

// Installable PWA (FR-46): register the generated service worker. `autoUpdate`
// so a new deploy silently takes over on next load (no offline requirement).
registerSW({ immediate: true });

createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<App />
		</QueryClientProvider>
	</StrictMode>,
);
