/** A JSON value as text to read: strings as they are, the rest pretty-printed. */
export function formatJson(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined) return "";
	return JSON.stringify(value, null, 2);
}
