import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OwnershipSourceDialog } from './OwnershipSourceDialog';

/**
 * The buy-vs-claim source prompt (Story 6.4 AC1): a labelled modal with three
 * actions — Cancel writes nothing, "Purchased" and "Claimed with PS+" each fire
 * their own callback. Focus lands on Cancel; Escape dismisses.
 */

function renderDialog() {
	const onPurchased = vi.fn();
	const onClaimed = vi.fn();
	const onCancel = vi.fn();
	render(
		<OwnershipSourceDialog
			title="Did you buy Bloodborne, or claim it with PS+?"
			onPurchased={onPurchased}
			onClaimed={onClaimed}
			onCancel={onCancel}
		/>,
	);
	return { onPurchased, onClaimed, onCancel };
}

describe('OwnershipSourceDialog', () => {
	it('is a labelled modal with three actions and focus on Cancel', () => {
		renderDialog();
		const dialog = screen.getByRole('dialog', {
			name: 'Did you buy Bloodborne, or claim it with PS+?',
		});
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
		expect(
			screen.getByRole('button', { name: 'Purchased' }),
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Claimed with PS+' }),
		).toBeInTheDocument();
	});

	it('fires onPurchased for "Purchased" and nothing else', async () => {
		const user = userEvent.setup();
		const { onPurchased, onClaimed, onCancel } = renderDialog();
		await user.click(screen.getByRole('button', { name: 'Purchased' }));
		expect(onPurchased).toHaveBeenCalledTimes(1);
		expect(onClaimed).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();
	});

	it('fires onClaimed for "Claimed with PS+" and nothing else', async () => {
		const user = userEvent.setup();
		const { onPurchased, onClaimed, onCancel } = renderDialog();
		await user.click(screen.getByRole('button', { name: 'Claimed with PS+' }));
		expect(onClaimed).toHaveBeenCalledTimes(1);
		expect(onPurchased).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();
	});

	it('cancels — writes nothing — on Cancel, Escape, and a backdrop press', async () => {
		const user = userEvent.setup();
		const { onPurchased, onClaimed, onCancel } = renderDialog();

		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		await user.keyboard('{Escape}');
		await user.click(screen.getByTestId('ownership-source-backdrop'));

		expect(onCancel).toHaveBeenCalledTimes(3);
		expect(onPurchased).not.toHaveBeenCalled();
		expect(onClaimed).not.toHaveBeenCalled();
	});
});
