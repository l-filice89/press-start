import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOAST_DURATION_MS, Toast, UNDO_TOAST_DURATION_MS } from './Toast';

// Spy on the live-region announcer so we can assert the toast announces without
// standing up a real provider.
const { announceSpy } = vi.hoisted(() => ({ announceSpy: vi.fn() }));
vi.mock('./LiveRegion', () => ({ useAnnounce: () => announceSpy }));

afterEach(() => {
	vi.useRealTimers();
	announceSpy.mockClear();
});

describe('Toast', () => {
	it('renders the message, announces it, and auto-dismisses after ~3s', () => {
		vi.useFakeTimers();
		const onDismiss = vi.fn();
		render(<Toast message="Saved" onDismiss={onDismiss} />);

		expect(screen.getByText('Saved')).toBeInTheDocument();
		expect(announceSpy).toHaveBeenCalledWith('Saved');
		expect(onDismiss).not.toHaveBeenCalled();

		act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it('UNDO calls onUndo, dismisses immediately, and cancels the auto-dismiss', () => {
		vi.useFakeTimers();
		const onUndo = vi.fn();
		const onDismiss = vi.fn();
		render(
			<Toast message="Marked Dropped" onUndo={onUndo} onDismiss={onDismiss} />,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		expect(onUndo).toHaveBeenCalledTimes(1);
		expect(onDismiss).toHaveBeenCalledTimes(1);

		// The pending 3s timer must not fire a second dismissal.
		act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it('keeps an undoable toast past 3s and dismisses it at ~6s', () => {
		vi.useFakeTimers();
		const onDismiss = vi.fn();
		render(
			<Toast message="Marked Dropped" onUndo={vi.fn()} onDismiss={onDismiss} />,
		);

		act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
		expect(onDismiss).not.toHaveBeenCalled();

		act(() =>
			vi.advanceTimersByTime(UNDO_TOAST_DURATION_MS - TOAST_DURATION_MS),
		);
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it('an explicit duration wins over the undoable default', () => {
		vi.useFakeTimers();
		const onDismiss = vi.fn();
		render(
			<Toast
				message="Marked Dropped"
				onUndo={vi.fn()}
				onDismiss={onDismiss}
				duration={1000}
			/>,
		);

		act(() => vi.advanceTimersByTime(1000));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it('renders no UNDO control when onUndo is omitted', () => {
		vi.useFakeTimers();
		render(<Toast message="Saved" />);
		expect(
			screen.queryByRole('button', { name: 'Undo' }),
		).not.toBeInTheDocument();
	});
});
