import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * The dialog contract (UX-DR14): modal ARIA, focus lands on Cancel, Tab is
 * trapped inside, Escape cancels, and the two buttons fire their callbacks.
 */

function renderDialog() {
	const onConfirm = vi.fn();
	const onCancel = vi.fn();
	render(
		<ConfirmDialog
			title="Log Platinum achieved for Bloodborne? This is permanent."
			onConfirm={onConfirm}
			onCancel={onCancel}
		/>,
	);
	return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
	it('is a labelled modal dialog with focus on Cancel', () => {
		renderDialog();
		const dialog = screen.getByRole('dialog', {
			name: 'Log Platinum achieved for Bloodborne? This is permanent.',
		});
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
	});

	it('traps Tab inside the dialog in both directions', async () => {
		const user = userEvent.setup();
		renderDialog();
		const cancel = screen.getByRole('button', { name: 'Cancel' });
		const confirm = screen.getByRole('button', { name: 'Confirm' });

		await user.tab();
		expect(confirm).toHaveFocus();
		// Forward off the last button wraps to the first…
		await user.tab();
		expect(cancel).toHaveFocus();
		// …and backward off the first wraps to the last.
		await user.tab({ shift: true });
		expect(confirm).toHaveFocus();
	});

	it('cancels on Escape without confirming', async () => {
		const user = userEvent.setup();
		const { onConfirm, onCancel } = renderDialog();
		await user.keyboard('{Escape}');
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('cancels on Escape even when focus is outside the dialog', async () => {
		const user = userEvent.setup();
		const { onCancel } = renderDialog();
		(document.activeElement as HTMLElement | null)?.blur();
		await user.keyboard('{Escape}');
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it('cancels on a backdrop press without confirming', async () => {
		const user = userEvent.setup();
		const { onConfirm, onCancel } = renderDialog();
		await user.click(screen.getByTestId('confirm-backdrop'));
		expect(onCancel).toHaveBeenCalledTimes(1);
		// A press on the dialog surface itself must NOT dismiss.
		onCancel.mockClear();
		await user.click(screen.getByRole('dialog'));
		expect(onCancel).not.toHaveBeenCalled();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('wires the Cancel and Confirm buttons', async () => {
		const user = userEvent.setup();
		const { onConfirm, onCancel } = renderDialog();
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onCancel).toHaveBeenCalledTimes(1);
		await user.click(screen.getByRole('button', { name: 'Confirm' }));
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});
});
