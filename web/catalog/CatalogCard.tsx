import { useState } from 'react';
import { AddGameDialog } from '../shelf/AddGameDialog';
import type { CatalogGame } from './api';

/**
 * A catalog card (Story 7.2, AD-24 / DESIGN.md). It reuses the shelf card's
 * chrome and is NOT a shelf card: no status pill, no owned toggle, no flip, no
 * magenta bloom — those all describe a game you TRACK, and a catalog product is
 * not one until you add it.
 *
 * THREE states, keyed on the remaining action:
 *  a) not tracked        → `＋ Add` + `Claim now`
 *  b) tracked, NOT owned → `In library` (cyan) AND `Claim now`, still live —
 *     it is a wishlist entry on your shelf, not yet claimed on your PSN account.
 *     Dropping Claim here would strand exactly the games the catalog just added.
 *  c) owned              → `Owned` (silver), NO actions. The absence of a CTA is
 *     the message. The app never infers a claim succeeded — a sync decides.
 *
 * `＋ Add` opens the EXISTING add preview (Epic 6, with the 6.6 "Not the right
 * game?" picker): there is no catalog detail page, so the preview is the confirm
 * surface, and a successful add lands on the game's real detail (`/game/:id`).
 * Both actions are real buttons named after the GAME (never 490 bare icons), and
 * `Claim now` says it opens a new tab.
 */
/** The only origin `Claim now` will ever link to (review, L2). */
const STORE_ORIGIN = 'https://store.playstation.com/';

export function CatalogCard({ game }: { game: CatalogGame }) {
	const [coverFailed, setCoverFailed] = useState(false);
	const [adding, setAdding] = useState(false);
	const showCover = !!game.coverUrl && !coverFailed;
	// A claim is only ever a deep link to the regional PS Store (FR-52) — there
	// is no in-app claim, and no store URL means no honest link to offer. The URL
	// is checked, not trusted (review, L2): `psplus_catalog.store_url` is provider-
	// shaped data rendered as an href, and an unchecked one turns a provider change
	// (or a `javascript:` value) into a live link. Only the real store qualifies.
	const claimUrl =
		!game.owned && game.storeUrl?.startsWith(STORE_ORIGIN)
			? game.storeUrl
			: null;

	return (
		<div
			className="catalog-card"
			data-testid="catalog-card"
			data-product-id={game.productId}
		>
			<div className="catalog-card__cover">
				{showCover ? (
					<img
						className="catalog-card__cover-img"
						src={game.coverUrl ?? undefined}
						alt=""
						loading="lazy"
						decoding="async"
						onError={() => setCoverFailed(true)}
					/>
				) : (
					<div className="catalog-card__cover-fallback" aria-hidden="true">
						<span>▹</span>
					</div>
				)}
				<span className="catalog-card__flag">
					<span aria-hidden="true">◈ PS+</span>
					<span className="sr-only">In the PlayStation Plus Extra catalog</span>
				</span>
			</div>

			<div className="catalog-card__info">
				<p
					className="catalog-card__title"
					title={game.name}
					data-testid="catalog-card-title"
				>
					{game.name}
				</p>

				<div className="catalog-card__actions">
					{game.owned ? (
						<span
							className="catalog-card__marker catalog-card__marker--owned"
							data-testid="catalog-owned"
						>
							Owned
						</span>
					) : game.inLibrary ? (
						<span
							className="catalog-card__marker catalog-card__marker--library"
							data-testid="catalog-in-library"
						>
							In library
						</span>
					) : (
						<button
							type="button"
							className="catalog-card__add tap-target"
							data-testid="catalog-add"
							aria-label={`Add ${game.name} to library`}
							onClick={() => setAdding(true)}
						>
							＋ Add
						</button>
					)}

					{claimUrl && (
						<a
							className="catalog-card__claim tap-target"
							href={claimUrl}
							target="_blank"
							rel="noreferrer noopener"
							data-testid="catalog-claim"
							aria-label={`Claim ${game.name} on the PlayStation Store (opens in a new tab)`}
						>
							Claim now
						</a>
					)}
				</div>
			</div>

			{adding && (
				<AddGameDialog
					title={game.name}
					navigateToDetail
					// The preview is Epic 6's, unchanged: it takes two plain facts (a
					// cover to show before IGDB answers, a store product id to forward to
					// the add) and knows nothing about catalogs. The store URL is NOT sent
					// — the server reads it off the catalog row it resolves the product id
					// against, so a product pruned since this card rendered writes nothing.
					prefill={{
						// A cover the browser already FAILED to load is a known-dead URL
						// (review, L5) — pre-filling it stamps it onto the new game row.
						coverUrl: coverFailed ? null : game.coverUrl,
						psnProductId: game.productId,
					}}
					onClose={() => setAdding(false)}
				/>
			)}
		</div>
	);
}
