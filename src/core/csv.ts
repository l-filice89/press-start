/**
 * Pure, dependency-free RFC-4180 CSV parser for the seed import (Story 1.6).
 * The two source exports (`ps_catalog.csv`, the Notion `Gaming list …` CSV)
 * are written by Excel/Notion with quoted fields carrying embedded commas
 * (`"Warhammer 40,000: Boltgun"`, `"November 4, 2024"`), escaped quotes
 * (`""`), a utf-8-sig BOM, and CRLF line endings — a naive `split(',')` would
 * corrupt them. Kept in `core/` because parsing is I/O-free (string → rows);
 * reading the file stays in the script layer (AD-3).
 */

/** Strip a leading UTF-8 BOM (utf-8-sig) if present. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Split CSV text into rows of raw string fields. Handles quoted fields
 * (embedded commas, CRLF, and `""` escaped quotes) per RFC 4180. A trailing
 * newline does not produce a spurious empty row.
 */
function splitRows(text: string): string[][] {
	const rows: string[][] = [];
	let field = '';
	let row: string[] = [];
	let inQuotes = false;
	const source = stripBom(text);

	for (let i = 0; i < source.length; i++) {
		const char = source[i];

		if (inQuotes) {
			if (char === '"') {
				if (source[i + 1] === '"') {
					field += '"';
					i++; // consume the escaped quote
				} else {
					inQuotes = false;
				}
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"') {
			inQuotes = true;
		} else if (char === ',') {
			row.push(field);
			field = '';
		} else if (char === '\n' || char === '\r') {
			// Close the row on LF; swallow the LF of a CRLF pair.
			if (char === '\r' && source[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			field = '';
			row = [];
		} else {
			field += char;
		}
	}

	// Flush the final field/row when the file has no trailing newline.
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/**
 * Parse CSV text into records keyed by the header row. Header names are used
 * verbatim (trimmed); the seed maps them to columns explicitly. Rows shorter
 * than the header are padded with empty strings; extra cells are ignored.
 * Fully-blank rows (a single empty field) are skipped.
 */
export function parseCsv(text: string): Record<string, string>[] {
	const rows = splitRows(text);
	if (rows.length === 0) return [];

	const header = rows[0].map((name) => name.trim());
	const records: Record<string, string>[] = [];

	for (let r = 1; r < rows.length; r++) {
		const cells = rows[r];
		if (cells.length === 1 && cells[0] === '') continue; // blank line
		const record: Record<string, string> = {};
		for (let c = 0; c < header.length; c++) {
			record[header[c]] = cells[c] ?? '';
		}
		records.push(record);
	}
	return records;
}
