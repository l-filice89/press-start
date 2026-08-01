import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { fetchShelf } from '../shelf/api';
import { availableStatsYears, summarizeStats } from './aggregate';
import './stats.css';

const SCORE_LABELS = [
	['tracked', 'TRACKED'],
	['owned', 'OWNED'],
	['completed', 'STORY COMPLETE'],
	['platinum', 'PLATINUM'],
] as const;

const YEAR_LABELS = [
	['wishlistedOn', 'WISHLISTED'],
	['boughtOn', 'BOUGHT'],
	['startedOn', 'STARTED'],
	['completedOn', 'COMPLETE'],
	['platinumOn', 'PLATINUM'],
] as const;

function StatsSkeleton() {
	return (
		<section
			className="stats-page stats-page--loading"
			role="status"
			aria-busy="true"
			aria-label="Loading your stats"
		>
			<Skeleton variant="text" className="stats-skeleton__title" />
			<div className="stats-scoreboards">
				{SCORE_LABELS.map(([key]) => (
					<Skeleton key={key} variant="block" />
				))}
			</div>
			<Skeleton variant="block" className="stats-skeleton__panel" />
		</section>
	);
}

export function StatsPage() {
	const currentYear = new Date().getFullYear();
	const [selectedYear, setSelectedYear] = useState(currentYear);
	const shelf = useQuery({
		queryKey: ['shelf'],
		queryFn: ({ signal }) => fetchShelf(signal),
	});
	const games = shelf.data ?? [];
	const years = useMemo(
		() => availableStatsYears(games, currentYear),
		[games, currentYear],
	);
	const summary = useMemo(
		() => summarizeStats(games, selectedYear),
		[games, selectedYear],
	);

	if (shelf.isPending) return <StatsSkeleton />;
	if (shelf.isError) {
		return (
			<section className="stats-page stats-message" role="alert">
				<p className="stats-message__code">SCORE LOAD FAILED</p>
				<p>Player record unavailable. Your library was not changed.</p>
				<button
					type="button"
					className="stats-retry tap-target"
					onClick={() => void shelf.refetch()}
				>
					Retry
				</button>
			</section>
		);
	}
	if (games.length === 0) return <EmptyState variant="stats-empty" />;

	const maxActivity = Math.max(
		1,
		...summary.months.flatMap((month) => [
			month.started,
			month.completed,
			month.platinum,
		]),
	);
	const activeMonths = summary.months.filter(
		(month) => month.started + month.completed + month.platinum > 0,
	);
	const maxGenre = Math.max(1, ...summary.genres.map((genre) => genre.count));

	return (
		<section className="stats-page" aria-labelledby="stats-title">
			<div className="stats-overview">
				<header className="stats-hero">
					<p className="stats-eyebrow">PLAYER RECORD / ALL TIME</p>
					<h1 id="stats-title">CABINET SCORE</h1>
				</header>

				<section className="stats-scoreboards" aria-label="All-time scores">
					{SCORE_LABELS.map(([key, label]) => (
						<article
							className={`stats-scoreboard stats-scoreboard--${key}`}
							key={key}
						>
							<p>{label}</p>
							<strong>{summary.allTime[key].toLocaleString()}</strong>
						</article>
					))}
				</section>

				<label className="stats-year">
					<span>CURRENT ROUND</span>
					<select
						value={selectedYear}
						onChange={(event) => setSelectedYear(Number(event.target.value))}
					>
						{years.map((year) => (
							<option key={year} value={year}>
								{year}
							</option>
						))}
					</select>
				</label>
			</div>

			<section className="stats-round" aria-labelledby="round-title">
				<div className="stats-section-heading">
					<p>ROUND LOG</p>
					<h2 id="round-title">{selectedYear}</h2>
				</div>
				<div className="stats-year-scores">
					{YEAR_LABELS.map(([key, label]) => (
						<div
							className={`stats-year-score stats-year-score--${key}`}
							key={key}
						>
							<span>{label}</span>
							<strong>{summary.year[key]}</strong>
						</div>
					))}
				</div>
			</section>

			{summary.year.totalDated === 0 ? (
				<section
					className="stats-no-activity"
					aria-labelledby="no-activity-title"
				>
					<p id="no-activity-title">NO DATED ACTIVITY</p>
					<span>
						No lifecycle dates land in {selectedYear}. Pick another round or
						edit game dates.
					</span>
				</section>
			) : (
				<div className="stats-panels">
					<section
						className="stats-panel stats-activity"
						aria-labelledby="activity-title"
					>
						<div className="stats-section-heading stats-section-heading--inline">
							<div>
								<p>ACTIVITY</p>
								<h2 id="activity-title">MONTHLY RUN</h2>
							</div>
							<ul className="stats-legend" aria-label="Activity legend">
								<li className="stats-legend--started">Started</li>
								<li className="stats-legend--completed">Complete</li>
								<li className="stats-legend--platinum">Platinum</li>
							</ul>
						</div>
						{activeMonths.length === 0 ? (
							<p className="stats-panel__empty">
								NO STARTS OR MILESTONES IN THIS ROUND
							</p>
						) : (
							<>
								<div className="stats-chart" aria-hidden="true">
									{summary.months.map((month) => (
										<div className="stats-chart__month" key={month.label}>
											<div className="stats-chart__bars">
												{month.started > 0 && (
													<span
														className="stats-chart__bar stats-chart__bar--started"
														style={
															{
																'--bar-size': month.started / maxActivity,
															} as CSSProperties
														}
													/>
												)}
												{month.completed > 0 && (
													<span
														className="stats-chart__bar stats-chart__bar--completed"
														style={
															{
																'--bar-size': month.completed / maxActivity,
															} as CSSProperties
														}
													/>
												)}
												{month.platinum > 0 && (
													<span
														className="stats-chart__bar stats-chart__bar--platinum"
														style={
															{
																'--bar-size': month.platinum / maxActivity,
															} as CSSProperties
														}
													/>
												)}
											</div>
											<span>{month.label}</span>
										</div>
									))}
								</div>
								<div className="stats-activity-mobile">
									{activeMonths.map((month) => (
										<div className="stats-month-row" key={month.label}>
											<strong>{month.label}</strong>
											<span>{month.started} started</span>
											<span>{month.completed} complete</span>
											<span>{month.platinum} platinum</span>
										</div>
									))}
								</div>
								<details className="stats-table-details">
									<summary>Exact monthly totals</summary>
									<table>
										<thead>
											<tr>
												<th>Month</th>
												<th>Started</th>
												<th>Complete</th>
												<th>Platinum</th>
											</tr>
										</thead>
										<tbody>
											{summary.months.map((month) => (
												<tr key={month.label}>
													<th>{month.label}</th>
													<td>{month.started}</td>
													<td>{month.completed}</td>
													<td>{month.platinum}</td>
												</tr>
											))}
										</tbody>
									</table>
								</details>
							</>
						)}
					</section>

					<section
						className="stats-panel stats-genres"
						aria-labelledby="genres-title"
					>
						<div className="stats-section-heading">
							<p>COMPLETED LOADOUT</p>
							<h2 id="genres-title">TOP GENRES</h2>
						</div>
						{summary.genres.length === 0 ? (
							<p className="stats-panel__empty">
								NO COMPLETED GENRES IN THIS ROUND
							</p>
						) : (
							<ol>
								{summary.genres.map((genre, index) => (
									<li key={genre.name}>
										<span className="stats-genre__rank">
											{String(index + 1).padStart(2, '0')}
										</span>
										<div>
											<span className="stats-genre__name">{genre.name}</span>
											<span className="stats-genre__track" aria-hidden="true">
												<span
													style={
														{
															'--bar-size': genre.count / maxGenre,
														} as CSSProperties
													}
												/>
											</span>
										</div>
										<strong>{genre.count}</strong>
									</li>
								))}
							</ol>
						)}
					</section>
				</div>
			)}
		</section>
	);
}
