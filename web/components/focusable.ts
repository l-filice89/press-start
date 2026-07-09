/**
 * The one focus-trap selector both dialogs use (Story 2.4 — closes the
 * per-dialog drift hole before form controls land in the detail panel).
 * Roving-tabindex widgets (`tabindex="-1"`) and `disabled` controls are
 * excluded: neither is reachable by Tab, and counting them would put the
 * trap's boundaries on elements `focus()` can't land on.
 */
export const FOCUSABLE_SELECTOR =
	'button:not([tabindex="-1"]):not(:disabled), a[href]:not([tabindex="-1"]), input:not([tabindex="-1"]):not(:disabled), select:not([tabindex="-1"]):not(:disabled)';
