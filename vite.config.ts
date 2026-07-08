import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		cloudflare(),
		/**
		 * Installable PWA (FR-46). The plugin emits `sw.js` + `manifest.webmanifest`
		 * into the Vite build; Workers Static Assets serve them as real files, so
		 * the SPA `not_found_handling` fallback never shadows them. No offline
		 * requirement — a small app-shell precache + `autoUpdate` is enough for
		 * installability + a fresh worker on each deploy.
		 */
		VitePWA({
			registerType: 'autoUpdate',
			includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
			manifest: {
				name: 'PRESS START',
				short_name: 'PRESS START',
				description: 'A personal, installable game shelf.',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				background_color: '#05090f',
				theme_color: '#05090f',
				icons: [
					{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
					{
						src: '/maskable-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable',
					},
				],
			},
			workbox: {
				// App-shell precache; SPA navigations fall back to index.html —
				// but NEVER for the Worker's API surface. Better-auth's magic-link
				// verify (`GET /api/auth/magic-link/verify`) is a top-level navigation
				// clicked from an email; without this denylist the registered SW would
				// serve cached index.html instead of letting it reach the Worker, and
				// sign-in would silently fail (regressing Story 1.3).
				navigateFallback: '/index.html',
				navigateFallbackDenylist: [/^\/api\//],
				globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
				// English-only: keep the non-latin variable-font subsets OUT of the
				// install-time precache. They stay on the server and remain lazily
				// fetchable via `unicode-range`, but the SW no longer force-downloads
				// cyrillic/greek/vietnamese/latin-ext woff2 nobody renders (NFR-3).
				globIgnores: [
					'**/*-cyrillic-*.woff2',
					'**/*-greek-*.woff2',
					'**/*-vietnamese-*.woff2',
					'**/*-latin-ext-*.woff2',
				],
			},
		}),
	],
});
