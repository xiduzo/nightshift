/** A JSON object of a flow file that is not yet parsed: not an array, not null. */

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
