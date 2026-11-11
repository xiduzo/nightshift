import type { JsonValue } from "@nightshift/flows";

/**
 * Why a value does not convert, in words for the person who reads the
 * step's note. A format module throws it; the Convert node ends the step
 * `fail` with its message. Any other error is a fault of Night Shift.
 */
export class ConvertProblem extends Error {
	override name = "ConvertProblem";
}

/** The list of records a table format writes, or a problem that shows the shape it needs. */
export function recordsOf(
	value: JsonValue,
	format: string,
): Record<string, JsonValue>[] {
	const isRecord = (entry: JsonValue): entry is Record<string, JsonValue> =>
		typeof entry === "object" && entry !== null && !Array.isArray(entry);
	if (!Array.isArray(value) || !value.every(isRecord)) {
		throw new ConvertProblem(
			`${format} needs a list of records, such as [{"name": "Ann", "city": "Oslo"}].`,
		);
	}
	return value;
}

/** Every key of the records, in the order they first appear: the columns of a table. */
export function columnsOf(
	records: readonly Record<string, JsonValue>[],
): string[] {
	const columns = new Set<string>();
	for (const record of records) {
		for (const key of Object.keys(record)) columns.add(key);
	}
	return [...columns];
}

/** One cell as text: text as it is, JSON for a list or a record, "" for none. */
export function cellText(value: JsonValue | undefined): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}
