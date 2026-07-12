/**
 * HAZARD-TEST invariant (garbage-title filter): a straggler is only worth
 * recording if its source title is something a human could ever match to a
 * game. A blank/whitespace-only title carries no signal, and a bare URL (an
 * IGN/store link scraped into the Title column) is not a title at all — both
 * would otherwise become un-resolvable stragglers that clutter the resolve
 * dialog forever. Pure so the importer and its test share one definition.
 */
export function isRecordableStragglerTitle(title: string): boolean {
	const trimmed = title.trim();
	if (trimmed === '') return false;
	if (/^https?:\/\//i.test(trimmed)) return false;
	return true;
}
