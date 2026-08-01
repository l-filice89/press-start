import type { ShelfGame } from '../shelf/api';

export const MONTH_LABELS = [
	'JAN',
	'FEB',
	'MAR',
	'APR',
	'MAY',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OCT',
	'NOV',
	'DEC',
] as const;

const LIFECYCLE_FIELDS = [
	'wishlistedOn',
	'boughtOn',
	'startedOn',
	'completedOn',
	'platinumOn',
] as const satisfies readonly (keyof ShelfGame)[];

type LifecycleField = (typeof LIFECYCLE_FIELDS)[number];

export interface MonthActivity {
	monthIndex: number;
	label: (typeof MONTH_LABELS)[number];
	started: number;
	completed: number;
	platinum: number;
}

export interface StatsSummary {
	allTime: {
		tracked: number;
		owned: number;
		completed: number;
		platinum: number;
	};
	year: Record<LifecycleField, number> & { totalDated: number };
	months: MonthActivity[];
	genres: { name: string; count: number }[];
}

function dateParts(
	value: string | null,
): { year: number; monthIndex: number } | null {
	if (!value) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [
		31,
		leapYear ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31,
	];
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1])
		return null;
	return { year, monthIndex: month - 1 };
}

export function availableStatsYears(
	games: ShelfGame[],
	currentYear: number,
): number[] {
	const years = new Set<number>([currentYear]);
	for (const game of games) {
		for (const field of LIFECYCLE_FIELDS) {
			const parts = dateParts(game[field]);
			if (parts) years.add(parts.year);
		}
	}
	return [...years].sort((a, b) => b - a);
}

export function summarizeStats(
	games: ShelfGame[],
	selectedYear: number,
): StatsSummary {
	const year = {
		wishlistedOn: 0,
		boughtOn: 0,
		startedOn: 0,
		completedOn: 0,
		platinumOn: 0,
		totalDated: 0,
	};
	const months: MonthActivity[] = MONTH_LABELS.map((label, monthIndex) => ({
		monthIndex,
		label,
		started: 0,
		completed: 0,
		platinum: 0,
	}));
	const genreCounts = new Map<string, { name: string; count: number }>();

	for (const game of games) {
		for (const field of LIFECYCLE_FIELDS) {
			const parts = dateParts(game[field]);
			if (!parts || parts.year !== selectedYear) continue;
			year[field] += 1;
			year.totalDated += 1;
			if (field === 'startedOn') months[parts.monthIndex].started += 1;
			if (field === 'completedOn') months[parts.monthIndex].completed += 1;
			if (field === 'platinumOn') months[parts.monthIndex].platinum += 1;
		}

		if (dateParts(game.completedOn)?.year !== selectedYear) continue;
		const genresForGame = new Map<string, string>();
		for (const genre of game.genres) {
			const name = genre.trim();
			const key = name.toLocaleLowerCase('en');
			if (name && !genresForGame.has(key)) genresForGame.set(key, name);
		}
		for (const [key, name] of genresForGame) {
			const current = genreCounts.get(key);
			genreCounts.set(key, {
				name: current?.name ?? name,
				count: (current?.count ?? 0) + 1,
			});
		}
	}

	return {
		allTime: {
			tracked: games.length,
			owned: games.filter((game) => game.owned).length,
			completed: games.filter((game) => game.completedOn !== null).length,
			platinum: games.filter((game) => game.platinumOn !== null).length,
		},
		year,
		months,
		genres: [...genreCounts.values()]
			.sort(
				(a, b) =>
					b.count - a.count ||
					a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
			)
			.slice(0, 5),
	};
}
