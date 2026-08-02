import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PlayNextIntent } from '../../src/core';
import { useModalTrap } from '../components/useModalTrap';

type ChoiceGroup = Exclude<keyof PlayNextIntent, 'includeWishlist'>;

const GROUPS: readonly {
	key: ChoiceGroup;
	label: string;
	choices: readonly string[];
}[] = [
	{
		key: 'genre',
		label: 'Genre — one or none',
		choices: ['Familiar', 'Different'],
	},
	{ key: 'time', label: 'Time — one or none', choices: ['Quick win'] },
	{
		key: 'backlogAge',
		label: 'Backlog age — one or none',
		choices: ['Fresh', 'Forgotten'],
	},
	{
		key: 'confidence',
		label: 'Confidence — one or none',
		choices: ['Safe bet', 'Wildcard'],
	},
	{
		key: 'priority',
		label: 'Priority — one or none',
		choices: ['Follow my list', 'Last chance'],
	},
	{
		key: 'progress',
		label: 'Progress — one or none',
		choices: ['Finish them'],
	},
];

export function TunePanel({
	draft,
	dirty,
	onChange,
	onApply,
	onClose,
}: {
	draft: PlayNextIntent;
	dirty: boolean;
	onChange: (next: PlayNextIntent) => void;
	onApply: () => void;
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const onKeyDown = useModalTrap(dialogRef, onClose, { restoreFocus: true });

	useEffect(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	}, []);

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop mirrors Escape and Close for pointer dismissal.
		<div
			className="tune__backdrop"
			data-testid="tune-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				id="play-next-tune-dialog"
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="tune"
				onKeyDown={onKeyDown}
			>
				<div className="tune__head">
					<h2 className="tune__title" id={titleId}>
						Tune the picks
					</h2>
					<button
						type="button"
						className="tune__close"
						aria-label="Close Tune the picks"
						onClick={onClose}
					>
						<span aria-hidden="true">×</span>
					</button>
				</div>
				<p className="tune__draft">
					{dirty ? <strong>Draft changed. </strong> : null}
					Current picks stay put until <strong>SHOW ME 3</strong>.
				</p>
				<div className="tune__groups">
					{GROUPS.map((group) => (
						<fieldset className="tune__group" key={group.key}>
							<legend>{group.label}</legend>
							{group.choices.map((choice) => {
								const pressed = draft[group.key] === choice;
								return (
									<button
										key={choice}
										type="button"
										className="tune__option"
										aria-pressed={pressed}
										onClick={() =>
											onChange({
												...draft,
												[group.key]: pressed ? null : choice,
											} as PlayNextIntent)
										}
									>
										{choice}
									</button>
								);
							})}
						</fieldset>
					))}
				</div>
				<label className="tune__wishlist">
					<input
						type="checkbox"
						checked={draft.includeWishlist}
						onChange={(event) =>
							onChange({
								...draft,
								includeWishlist: event.currentTarget.checked,
							})
						}
					/>
					<span>Include wishlist</span>
					<small>DISCOVER access</small>
				</label>
				<button type="button" className="tune__show" onClick={onApply}>
					SHOW ME 3
				</button>
			</div>
		</div>,
		document.body,
	);
}
