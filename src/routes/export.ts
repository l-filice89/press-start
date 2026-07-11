import { Hono } from 'hono';
import { toCsv } from '../core';
import { createDb } from '../repositories/db';
import { loadLibrary } from '../services';
import { type AuthVariables, requireAuth } from './auth';

/**
 * CSV export (Story 6.3, FR-49/AR-25): the whole library as a user-held second
 * copy so the games-DB backups are never the only one. Reads through the one
 * user-scoped whole-library service (`loadLibrary`) and serializes with the
 * pure `core/toCsv`. `requireAuth`; the download carries only the signed-in
 * user's tracked games (AD-13). The library is small — build the whole string,
 * no streaming.
 */

type ExportEnv = { Bindings: Env; Variables: AuthVariables };

export const exportRoute = new Hono<ExportEnv>();

const COLUMNS = [
	'Title',
	'State',
	'Play Status',
	'Owned',
	'Ownership Type',
	'Acquired Via',
	'PS+ Extra',
	'Release Date',
	'Started On',
	'Bought On',
	'Wishlisted On',
	'Completed On',
	'Platinum On',
	'Genres',
] as const;

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

// CSV-injection guard (OWASP): a leading =, +, -, @, tab, or CR executes as a
// formula when the export is opened in Excel/Sheets — and opening it there is
// this file's whole purpose. Titles/genres arrive from IGDB/Notion, so they
// are untrusted. RFC-4180 quoting does not neutralize formulas; a leading
// apostrophe does (spreadsheets render the cell as text).
const escapeFormula = (cell: string) =>
	/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;

exportRoute.get('/export.csv', requireAuth, async (c) => {
	const db = createDb(c.env.DB);
	const games = await loadLibrary(db, c.get('userId'));
	const rows: string[][] = [
		[...COLUMNS],
		...games.map((g) => [
			g.title,
			g.effectiveState,
			g.playStatus ?? '',
			yesNo(g.owned),
			g.ownershipType ?? '',
			g.ownedVia ?? '',
			yesNo(g.psPlusExtra),
			g.releaseDate ?? '',
			g.startedOn ?? '',
			g.boughtOn ?? '',
			g.wishlistedOn ?? '',
			g.completedOn ?? '',
			g.platinumOn ?? '',
			g.genres.join('; '),
		]),
	];
	return c.body(toCsv(rows.map((row) => row.map(escapeFormula))), 200, {
		'content-type': 'text/csv; charset=utf-8',
		'content-disposition': 'attachment; filename="press-start-library.csv"',
	});
});
