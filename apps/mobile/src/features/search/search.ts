import {
	gateParts,
	gateRun,
	type OpenGate,
	type RunSummary,
	runStatusLabel,
} from "@nightshift/client";

/** Runs the search shows before the person types: the newest. */
export const NEWEST_RUNS = 10;

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
			gateParts(gate.question).headline,
			gate.projectName,
			gateRun(gate).flow,
			gate.runTitle,
			gate.nodeId,
			gate.spaceName,
		]),
	);
}

/**
 * The runs that match, newest first: by their title, flow, branch, id,
 * project and status word. The newest few for a blank query.
 */
export function searchRuns(
	runs: readonly RunSummary[],
	query: string,
	projectName: (projectId: string) => string | undefined,
): RunSummary[] {
	const words = queryWords(query);
	const newest = [...runs].sort((a, b) => b.createdAt - a.createdAt);
	if (words.length === 0) return newest.slice(0, NEWEST_RUNS);
	return newest.filter((run) =>
		matches(words, [
			run.title,
			run.flowName,
			run.branch,
			run.id,
			projectName(run.projectId),
			runStatusLabel(run.status),
		]),
	);
}

function count(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** The line above the results, read out when it changes. */
export function resultsText(
	query: string,
	gates: number,
	runs: number,
): string {
	const blank = queryWords(query).length === 0;
	if (!blank && gates === 0 && runs === 0) {
		return `Nothing matches "${query.trim()}"`;
	}
	const found = `${count(gates, "Gate", "Gates")} and ${count(runs, "run", "runs")}`;
	return blank ? found : `${found} match`;
}
