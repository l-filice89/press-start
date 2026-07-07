import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AttentionBanner } from './AttentionBanner';

describe('AttentionBanner', () => {
	it('renders the message with the variant tone class and no auto-dismiss', () => {
		render(
			<AttentionBanner
				variant="stragglers"
				message="3 games couldn't be matched — resolve"
			/>,
		);
		const banner = screen.getByTestId('attention-banner');
		expect(banner).toHaveTextContent("3 games couldn't be matched");
		expect(banner).toHaveClass('attention-banner--stragglers');
		// Persistent: it is a status region, present with no timer to remove it.
		expect(banner).toHaveAttribute('role', 'status');
	});

	it.each([
		['stragglers', 'attention-banner--stragglers'],
		['expired-cookie', 'attention-banner--expired-cookie'],
		['failed-refresh', 'attention-banner--failed-refresh'],
	] as const)('maps variant %s to its tone class', (variant, cls) => {
		render(<AttentionBanner variant={variant} message="x" />);
		expect(screen.getByTestId('attention-banner')).toHaveClass(cls);
	});

	it('renders an action button that fires its handler', async () => {
		const onClick = vi.fn();
		render(
			<AttentionBanner
				variant="expired-cookie"
				message="PlayStation sync needs a new cookie"
				action={{ label: 'Open Settings', onClick }}
			/>,
		);
		await userEvent.click(
			screen.getByRole('button', { name: 'Open Settings' }),
		);
		expect(onClick).toHaveBeenCalledTimes(1);
	});
});
