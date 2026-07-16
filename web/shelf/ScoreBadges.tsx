import { scoreGrade } from './score-grade';

/**
 * The ◎ critic / ★ user score pair (Story 10.5) — one markup home for every
 * candidate-shaped consumer (picker rows, add-preview). Absent-safe: renders
 * nothing when neither score exists, and a null slot is ABSENT, never a zero
 * (VR-5/NFR-4). Values are rounded for display and graded on the rounded
 * value; the sr-only sentence mirrors the shelf card's.
 */
export function ScoreBadges({
	critic,
	criticCount,
	user,
	userCount,
	testId,
}: {
	critic: number | null;
	criticCount: number | null;
	user: number | null;
	userCount: number | null;
	testId?: string;
}) {
	if (critic == null && user == null) return null;
	return (
		<span className="score-badges" data-testid={testId}>
			{critic != null && (
				<span className={`score-badge score-grade--${scoreGrade(critic)}`}>
					<span aria-hidden="true">◎ {Math.round(critic)}</span>
					<span className="sr-only">
						Critic score {Math.round(critic)} out of 100
						{criticCount != null
							? ` from ${criticCount} ${criticCount === 1 ? 'review' : 'reviews'}`
							: ''}
					</span>
				</span>
			)}
			{user != null && (
				<span className={`score-badge score-grade--${scoreGrade(user)}`}>
					<span aria-hidden="true">★ {Math.round(user)}</span>
					<span className="sr-only">
						User score {Math.round(user)} out of 100
						{userCount != null
							? ` from ${userCount} ${userCount === 1 ? 'rating' : 'ratings'}`
							: ''}
					</span>
				</span>
			)}
		</span>
	);
}
