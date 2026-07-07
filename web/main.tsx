import { registerSW } from 'virtual:pwa-register';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Global styles — order matters: fonts + tokens define what everything else
// references, then base resets, then the shared hit-area utility.
import './fonts.css';
import './tokens.css';
import './index.css';
import './components/hit-area.css';
import App from './App.tsx';

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('Root element (#root) not found in index.html');
}

// Installable PWA (FR-46): register the generated service worker. `autoUpdate`
// so a new deploy silently takes over on next load (no offline requirement).
registerSW({ immediate: true });

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
