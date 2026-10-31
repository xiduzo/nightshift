import {
	gateParts,
	gateRun,
	type OpenGate,
	plainText,
} from "@nightshift/client";

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

/**
 * The open Gates that match: by their question, project, flow, run, step
 * and Space. Every Gate, in inbox order, for a blank query.
 */
export function searchGates<G extends OpenGate>(
	gates: readonly G[],
	query: string,
): G[] {
	const words = queryWords(query);
	if (words.length === 0) return [...gates];
	return gates.filter((gate) =>
		matches(words, [
			plainText(gateParts(gate.question).headline),
			gate.projectName,
			gateRun(gate).flow,
			gate.runTitle,
			gate.nodeId,
			gate.spaceName,
		]),
	);
}
