import { mergeTests } from '@playwright/test';
import { test as apiRequestFixture } from '@seontechnologies/playwright-utils/api-request/fixtures';
import { test as interceptFixture } from '@seontechnologies/playwright-utils/intercept-network-call/fixtures';
import { test as logFixture } from '@seontechnologies/playwright-utils/log/fixtures';
import { test as networkErrorMonitorFixture } from '@seontechnologies/playwright-utils/network-error-monitor/fixtures';

/**
 * The single test object for all e2e specs. network-error-monitor is
 * auto-enabled: any HTTP 4xx/5xx during a test fails it even when the UI
 * looks fine — opt out per-test with
 * `{ annotation: [{ type: 'skipNetworkMonitoring' }] }` for specs that
 * assert error behavior.
 */
export const test = mergeTests(
	apiRequestFixture,
	interceptFixture,
	logFixture,
	networkErrorMonitorFixture,
);

export { expect } from '@playwright/test';
