/**
 * Pure Notion → domain mapping for the seed import (Story 1.6, FR-30).
 * I/O-free (AD-3). The Notion export's status vocabulary differs from the
 * app's state model; the seed maps old values onto play status + the
 * `completed_on` milestone. `Category`, `Rating`, and the Notion `Release
 * date` column are NOT imported (genres/release come exclusively from IGDB).
 */

import type { PlayStatus } from './types';

/** Exact status strings the Notion export emits (see project-context.md). */
export type NotionStatus =
	| 'Not started'
	| 'Up next!'
	| 'Playing'
	| 'Paused'
	| 'Completed'
	| 'Not released';

/**
 * Result of mapping a Notion `Status` cell. `known: false` means the value is
 * outside the recognized vocabulary — the caller records a straggler rather
 * than guessing (FR-28/30). When `completed` is true the play status is null
 * and the caller stamps `completed_on` from `Date finished`.
 */
export type MappedNotionStatus =
	| { known: true; playStatus: PlayStatus | null; completed: boolean }
	| { known: false };

const STATUS_MAP: Record<
	NotionStatus,
	{ playStatus: PlayStatus | null; completed: boolean }
> = {
	// Completed → a milestone, not a play status: play_status null + completed_on.
	Completed: { playStatus: null, completed: true },
	'Up next!': { playStatus: 'Up next', completed: false },
	// Not released has no app equivalent; it lands as the default backlog state.
	'Not released': { playStatus: 'Not started', completed: false },
	'Not started': { playStatus: 'Not started', completed: false },
	Playing: { playStatus: 'Playing', completed: false },
	Paused: { playStatus: 'Paused', completed: false },
};

/** Map a raw Notion `Status` string. Unknown values are reported, never guessed. */
export function mapNotionStatus(raw: string): MappedNotionStatus {
	const mapped = STATUS_MAP[raw.trim() as NotionStatus];
	if (!mapped) return { known: false };
	return { known: true, ...mapped };
}

const MONTHS: Record<string, string> = {
	january: '01',
	february: '02',
	march: '03',
	april: '04',
	may: '05',
	june: '06',
	july: '07',
	august: '08',
	september: '09',
	october: '10',
	november: '11',
	december: '12',
};

/**
 * Parse a Notion date cell (`"November 4, 2024"`) into an ISO `YYYY-MM-DD`
 * string — the `core/` date contract (AD-8). Empty or unrecognized input
 * returns null; the seed stamps only known dates and never fabricates one
 * (FR-31/32).
 */
export function parseNotionDate(raw: string): string | null {
	const value = raw.trim();
	if (!value) return null;
	const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(value);
	if (!match) return null;
	const month = MONTHS[match[1].toLowerCase()];
	if (!month) return null;
	const day = match[2].padStart(2, '0');
	return `${match[3]}-${month}-${day}`;
}
