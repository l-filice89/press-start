export interface PlayNextCandidate {
	id: string;
	title: string;
	coverUrl: string | null;
	playStatus: string | null;
	owned: boolean;
	psPlusExtra: boolean;
	hasCompleted: boolean;
	hasPlatinum: boolean;
	platinumOn: string | null;
	releaseDate: string | null;
	genres: readonly string[];
	criticScore: number | null;
	criticScoreCount: number | null;
	userScore: number | null;
	userScoreCount: number | null;
	psPlusLeavingOn: string | null;
	ttbStorySeconds: number | null;
	boughtOn: string | null;
	wishlistedOn: string | null;
	wishlisted: boolean;
}

export interface PlayNextIntent {
	genre: 'Familiar' | 'Different' | null;
	time: 'Quick win' | null;
	backlogAge: 'Fresh' | 'Forgotten' | null;
	priority: 'Follow my list' | 'Last chance' | null;
	progress: 'Finish them' | null;
	includeWishlist: boolean;
}

export const EMPTY_PLAY_NEXT_INTENT: PlayNextIntent = {
	genre: null,
	time: null,
	backlogAge: null,
	priority: null,
	progress: null,
	includeWishlist: false,
};

export type PlayNextReason =
	| 'FINISH THEM'
	| 'LAST CHANCE'
	| 'UP NEXT'
	| 'QUICK WIN'
	| 'SAFE BET'
	| 'FORGOTTEN'
	| 'FAMILIAR'
	| 'AVAILABLE NOW'
	| 'WILDCARD';

export interface PlayNextFactor {
	code: string;
	points: number;
}

export interface PlayNextSuggestion {
	game: PlayNextCandidate;
	total: number;
	factors: readonly PlayNextFactor[];
	primaryReason: PlayNextReason;
	explanation: string;
	accessTag: 'OWNED' | 'PS+ EXTRA' | 'DISCOVER';
	finishThem: boolean;
	intentDistance: number;
	closestMatch: boolean;
}

const DAY_MS = 86_400_000;

function normalizedGenres(candidate: PlayNextCandidate): string[] {
	return candidate.genres
		.map((genre) => genre.trim().toLowerCase())
		.filter(Boolean);
}

function compareIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function utcDay(iso: string): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const value = Date.UTC(year, month - 1, day);
	const parsed = new Date(value);
	if (
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() !== month - 1 ||
		parsed.getUTCDate() !== day
	)
		return null;
	return Math.floor(value / DAY_MS);
}

function calendarDays(fromIso: string, toIso: string): number | null {
	const from = utcDay(fromIso);
	const to = utcDay(toIso);
	return from === null || to === null ? null : to - from;
}

function fnv1a(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function isPlayNextEligible(
	candidate: PlayNextCandidate,
	referenceIso: string,
	includeWishlist = false,
): boolean {
	if (
		!candidate.owned &&
		!candidate.psPlusExtra &&
		!(includeWishlist && candidate.wishlisted)
	)
		return false;
	if (candidate.hasPlatinum || candidate.platinumOn !== null) return false;
	if (candidate.playStatus === 'Playing' || candidate.playStatus === 'Dropped')
		return false;
	return (
		!candidate.releaseDate || candidate.releaseDate <= referenceIso.slice(0, 10)
	);
}

export function isFinishThem(candidate: PlayNextCandidate): boolean {
	return (
		candidate.playStatus === 'Paused' ||
		(candidate.hasCompleted && !candidate.hasPlatinum)
	);
}

function explain(
	reason: PlayNextReason,
	candidate: PlayNextCandidate,
	sharedGenre?: string,
): string {
	switch (reason) {
		case 'FINISH THEM':
			return 'You already made progress here. Returning now could turn it into a finish.';
		case 'LAST CHANCE':
			return `It leaves PS+ on ${candidate.psPlusLeavingOn}, so waiting could remove your current access.`;
		case 'UP NEXT':
			return 'You marked this Up next, so it is ready to move from intention to play.';
		case 'QUICK WIN':
			return `Its known story estimate is about ${Math.round((candidate.ttbStorySeconds ?? 0) / 3600)} hours.`;
		case 'SAFE BET': {
			const scores = [
				{
					label: 'critic',
					score: candidate.criticScore,
					count: candidate.criticScoreCount,
					qualified:
						validConfidencePair(
							candidate.criticScore,
							candidate.criticScoreCount,
						) &&
						(candidate.criticScore ?? 0) >= 80 &&
						(candidate.criticScoreCount ?? 0) >= 10,
					order: 0,
				},
				{
					label: 'user',
					score: candidate.userScore,
					count: candidate.userScoreCount,
					qualified:
						validConfidencePair(
							candidate.userScore,
							candidate.userScoreCount,
						) &&
						(candidate.userScore ?? 0) >= 80 &&
						(candidate.userScoreCount ?? 0) >= 20,
					order: 1,
				},
			]
				.filter((score) => score.qualified)
				.sort(
					(a, b) =>
						(b.score ?? 0) - (a.score ?? 0) ||
						(b.count ?? 0) - (a.count ?? 0) ||
						a.order - b.order,
				)[0];
			return `Its ${scores?.label} score is ${scores?.score} from ${scores?.count} ratings.`;
		}
		case 'FORGOTTEN':
			return `It has waited on your Shelf since ${candidate.boughtOn ?? candidate.wishlistedOn}.`;
		case 'FAMILIAR':
			return `Its ${sharedGenre} genre matches games already active on your Shelf.`;
		case 'AVAILABLE NOW':
			return 'It is available through your current PS+ Extra access.';
		case 'WILDCARD':
			return 'A varied eligible pick from your Shelf.';
	}
}

function scoreCandidate(
	candidate: PlayNextCandidate,
	referenceIso: string,
	preferenceGenres: ReadonlySet<string>,
	intent: PlayNextIntent,
): PlayNextSuggestion {
	const factors: PlayNextFactor[] = [];
	const add = (code: string, points: number) => factors.push({ code, points });
	const finishThem = isFinishThem(candidate);
	if (finishThem) add('finish-them', 40);
	if (candidate.playStatus === 'Up next') add('up-next', 32);

	const leavingDays = candidate.psPlusLeavingOn
		? calendarDays(referenceIso, candidate.psPlusLeavingOn)
		: null;
	if (candidate.psPlusExtra && leavingDays !== null && leavingDays >= 0) {
		if (leavingDays <= 14) add('last-chance-14', 28);
		else if (leavingDays <= 30) add('last-chance-30', 18);
	}

	const backlogDate = candidate.boughtOn ?? candidate.wishlistedOn;
	const backlogDays = backlogDate
		? calendarDays(backlogDate, referenceIso)
		: null;
	if (backlogDays !== null) {
		if (backlogDays >= 730) add('forgotten-730', 16);
		else if (backlogDays >= 365) add('forgotten-365', 10);
		else if (backlogDays >= 180) add('forgotten-180', 5);
	}

	const storyHours =
		candidate.ttbStorySeconds === null ||
		!Number.isFinite(candidate.ttbStorySeconds) ||
		candidate.ttbStorySeconds < 0
			? null
			: candidate.ttbStorySeconds / 3600;
	if (storyHours !== null) {
		if (storyHours <= 10) add('quick-win-10', 12);
		else if (storyHours <= 20) add('quick-win-20', 6);
	}
	if (
		validConfidencePair(candidate.criticScore, candidate.criticScoreCount) &&
		(candidate.criticScore ?? 0) >= 80 &&
		(candidate.criticScoreCount ?? 0) >= 10
	)
		add('critic-confidence', 8);
	if (
		validConfidencePair(candidate.userScore, candidate.userScoreCount) &&
		(candidate.userScore ?? 0) >= 80 &&
		(candidate.userScoreCount ?? 0) >= 20
	)
		add('user-confidence', 8);
	const sharedGenre = candidate.genres.find((genre) =>
		preferenceGenres.has(genre.trim().toLowerCase()),
	);
	if (sharedGenre) add('familiar-genre', 4);
	if (candidate.psPlusExtra) add('ps-plus-access', 6);
	if (candidate.owned) add('owned-access', 4);

	const intentMatches = matchesIntent(
		candidate,
		referenceIso,
		preferenceGenres,
		intent,
	);
	for (const match of intentMatches) {
		if (match.matches) add(`intent-${match.group}`, 24);
	}
	const intentDistance = intentMatches.filter(
		(match) => match.active && !match.matches,
	).length;

	const codes = new Set(factors.map((factor) => factor.code));
	const primaryReason: PlayNextReason = codes.has('finish-them')
		? 'FINISH THEM'
		: [...codes].some((code) => code.startsWith('last-chance'))
			? 'LAST CHANCE'
			: codes.has('up-next')
				? 'UP NEXT'
				: [...codes].some((code) => code.startsWith('quick-win'))
					? 'QUICK WIN'
					: codes.has('critic-confidence') || codes.has('user-confidence')
						? 'SAFE BET'
						: [...codes].some((code) => code.startsWith('forgotten'))
							? 'FORGOTTEN'
							: codes.has('familiar-genre')
								? 'FAMILIAR'
								: codes.has('ps-plus-access')
									? 'AVAILABLE NOW'
									: 'WILDCARD';
	return {
		game: candidate,
		total: factors.reduce((sum, factor) => sum + factor.points, 0),
		factors,
		primaryReason,
		explanation: explain(primaryReason, candidate, sharedGenre),
		accessTag: candidate.owned
			? 'OWNED'
			: candidate.psPlusExtra
				? 'PS+ EXTRA'
				: 'DISCOVER',
		finishThem,
		intentDistance,
		closestMatch: intentDistance > 0,
	};
}

type IntentMatch = {
	group: 'genre' | 'time' | 'backlog-age' | 'priority' | 'progress';
	active: boolean;
	matches: boolean;
};

function validConfidencePair(score: number | null, count: number | null) {
	return (
		score !== null &&
		count !== null &&
		Number.isFinite(score) &&
		Number.isFinite(count) &&
		score >= 0 &&
		score <= 100 &&
		count > 0
	);
}

function matchesIntent(
	candidate: PlayNextCandidate,
	referenceIso: string,
	preferenceGenres: ReadonlySet<string>,
	intent: PlayNextIntent,
): IntentMatch[] {
	const genres = normalizedGenres(candidate);
	const hasKnownGenre = genres.length > 0;
	const overlapsAnchor = genres.some((genre) => preferenceGenres.has(genre));
	const storyHours =
		candidate.ttbStorySeconds !== null &&
		Number.isFinite(candidate.ttbStorySeconds) &&
		candidate.ttbStorySeconds >= 0
			? candidate.ttbStorySeconds / 3600
			: null;
	const backlogDate = candidate.boughtOn ?? candidate.wishlistedOn;
	const backlogDays = backlogDate
		? calendarDays(backlogDate, referenceIso)
		: null;
	const leavingDays = candidate.psPlusLeavingOn
		? calendarDays(referenceIso, candidate.psPlusLeavingOn)
		: null;
	return [
		{
			group: 'genre',
			active: intent.genre !== null,
			matches:
				intent.genre === 'Familiar'
					? hasKnownGenre && overlapsAnchor
					: intent.genre === 'Different'
						? hasKnownGenre && !overlapsAnchor
						: false,
		},
		{
			group: 'time',
			active: intent.time !== null,
			matches:
				intent.time === 'Quick win' && storyHours !== null && storyHours <= 20,
		},
		{
			group: 'backlog-age',
			active: intent.backlogAge !== null,
			matches:
				backlogDays !== null &&
				backlogDays >= 0 &&
				(intent.backlogAge === 'Fresh'
					? backlogDays < 180
					: intent.backlogAge === 'Forgotten'
						? backlogDays >= 180
						: false),
		},
		{
			group: 'priority',
			active: intent.priority !== null,
			matches:
				intent.priority === 'Follow my list'
					? candidate.playStatus === 'Up next'
					: intent.priority === 'Last chance'
						? candidate.psPlusExtra &&
							leavingDays !== null &&
							leavingDays >= 0 &&
							leavingDays <= 30
						: false,
		},
		{
			group: 'progress',
			active: intent.progress !== null,
			matches: intent.progress === 'Finish them' && isFinishThem(candidate),
		},
	];
}

export function getPlayNextSuggestions(
	games: readonly PlayNextCandidate[],
	options: {
		referenceIso: string;
		visitSeed: string;
		limit?: number;
		intent?: PlayNextIntent;
		excludedGameIds?: ReadonlySet<string>;
	},
): PlayNextSuggestion[] {
	const intent = options.intent ?? EMPTY_PLAY_NEXT_INTENT;
	const uniqueGames = games.filter(
		(game, index) =>
			games.findIndex((candidate) => candidate.id === game.id) === index,
	);
	const anchors = new Set(
		uniqueGames
			.filter((game) =>
				['Up next', 'Playing', 'Paused'].includes(game.playStatus ?? ''),
			)
			.flatMap(normalizedGenres),
	);
	const ranked = uniqueGames
		.filter((game) => !options.excludedGameIds?.has(game.id))
		.filter((game) =>
			isPlayNextEligible(game, options.referenceIso, intent.includeWishlist),
		)
		.map((game) => scoreCandidate(game, options.referenceIso, anchors, intent))
		.sort(
			(a, b) =>
				a.intentDistance - b.intentDistance ||
				b.total - a.total ||
				fnv1a(`${options.visitSeed}:${a.game.id}`) -
					fnv1a(`${options.visitSeed}:${b.game.id}`) ||
				compareIds(a.game.id, b.game.id),
		);
	const selected: PlayNextSuggestion[] = [];
	const remaining = [...ranked];
	const requestedLimit = options.limit ?? 3;
	const limit = Number.isFinite(requestedLimit)
		? Math.max(0, Math.floor(requestedLimit))
		: 3;
	while (selected.length < limit && remaining.length > 0) {
		const uncapped = intent.progress === 'Finish them';
		const available = remaining.filter(
			(item) =>
				uncapped ||
				!item.finishThem ||
				!selected.some((chosen) => chosen.finishThem),
		);
		const nextDistance = Math.min(
			...available.map((item) => item.intentDistance),
		);
		const candidates = available.filter(
			(item) => item.intentDistance === nextDistance,
		);
		if (candidates.length === 0) break;
		const scored = candidates.map((item) => {
			const genres = normalizedGenres(item.game);
			const reasonRepeat = selected.some(
				(chosen) => chosen.primaryReason === item.primaryReason,
			);
			const genreRepeat = selected.some((chosen) =>
				normalizedGenres(chosen.game).some((genre) => genres.includes(genre)),
			);
			return {
				item,
				adjusted: item.total - (reasonRepeat ? 8 : 0) - (genreRepeat ? 4 : 0),
			};
		});
		let pool = scored;
		if (selected.length === 2) {
			const [first, second] = selected;
			const sharedReason = first.primaryReason === second.primaryReason;
			const shared = normalizedGenres(first.game).filter((genre) =>
				normalizedGenres(second.game).includes(genre),
			);
			if (sharedReason && shared.length > 0) {
				const alternatives = scored.filter(
					({ item }) =>
						item.primaryReason !== first.primaryReason ||
						!normalizedGenres(item.game).some((genre) =>
							shared.includes(genre),
						),
				);
				if (alternatives.length > 0) pool = alternatives;
			}
		}
		pool.sort(
			(a, b) =>
				b.adjusted - a.adjusted ||
				fnv1a(`${options.visitSeed}:${a.item.game.id}`) -
					fnv1a(`${options.visitSeed}:${b.item.game.id}`) ||
				compareIds(a.item.game.id, b.item.game.id),
		);
		const chosen = pool[0].item;
		selected.push(chosen);
		remaining.splice(remaining.indexOf(chosen), 1);
	}
	return selected;
}
