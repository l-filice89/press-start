/**
 * Rasterize the PRESS START app icons from `scripts/icon-source.svg` into the
 * PNGs the PWA manifest references (see vite.config.ts). Run out-of-band with
 * `bun run scripts/generate-icons.ts` whenever the source mark changes — the
 * generated PNGs are committed so the build never needs a rasterizer.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const source = readFileSync(join(here, 'icon-source.svg'));

const targets = [
	{ file: 'pwa-192x192.png', size: 192 },
	{ file: 'pwa-512x512.png', size: 512 },
	// The source keeps its content within the maskable safe zone, so it doubles
	// as the maskable icon (any/maskable purpose in the manifest).
	{ file: 'maskable-512x512.png', size: 512 },
	{ file: 'apple-touch-icon.png', size: 180 },
];

for (const { file, size } of targets) {
	await sharp(source, { density: 384 })
		.resize(size, size)
		.png()
		.toFile(join(publicDir, file));
	console.log(`wrote public/${file} (${size}x${size})`);
}
