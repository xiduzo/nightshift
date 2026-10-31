/** The words of a query, in lower case. Blank: no words. */
export function queryWords(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether every word of the query is in one of the fields. */
export function matches(
	words: readonly string[],
	fields: readonly (string | null | undefined)[],
): boolean {
	const text = fields
		.filter((field): field is string => typeof field === "string")
		.join("\n")
		.toLowerCase();
	return words.every((word) => text.includes(word));
}
