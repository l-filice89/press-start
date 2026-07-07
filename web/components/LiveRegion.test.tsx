import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LiveRegionProvider, useAnnounce } from './LiveRegion';

function Announcer({ message }: { message: string }) {
	const announce = useAnnounce();
	return (
		<button type="button" onClick={() => announce(message)}>
			say
		</button>
	);
}

describe('LiveRegion', () => {
	it('exposes a polite region and updates its text when announce() is called', async () => {
		render(
			<LiveRegionProvider>
				<Announcer message="Status changed" />
			</LiveRegionProvider>,
		);

		const region = screen.getByTestId('live-region');
		expect(region).toHaveAttribute('aria-live', 'polite');
		expect(region).toHaveTextContent('');

		await userEvent.click(screen.getByRole('button', { name: 'say' }));

		await waitFor(() => expect(region).toHaveTextContent('Status changed'));
	});

	it('useAnnounce() is a safe no-op with no provider mounted', async () => {
		// Rendering a consumer outside a provider must not throw.
		render(<Announcer message="orphan" />);
		await userEvent.click(screen.getByRole('button', { name: 'say' }));
		expect(screen.queryByTestId('live-region')).not.toBeInTheDocument();
	});
});
