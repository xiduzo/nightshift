/**
 * One tool call of an agent, as a transcript keeps it: the tool's name, its
 * input once the harness has it, the tool's answer, and whether it failed.
 * Every harness names its tools its own way (`TodoWrite`, `todowrite`,
 * `todo_list`); the readers below take them all.
 */
export type AgentToolCall = {
	name: string;
	input?: unknown;
	result?: string;
	failed?: boolean;
};

/** The tool's own name, lower case, without an MCP server prefix (`mcp__x__`). */
export function toolName(name: string): string {
	const mcp = /^mcp__.+?__(.+)$/.exec(name);
	return (mcp?.[1] ?? name).toLowerCase();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first of `keys` that holds a string. */
export function stringField(
	input: unknown,
	keys: readonly string[],
): string | undefined {
	if (!isRecord(input)) return undefined;
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string") return value;
	}
	return undefined;
}

/** A tool's answer as JSON, or undefined when it is not JSON. */
export function jsonResult(result: string | undefined): unknown {
	if (result === undefined) return undefined;
	try {
		return JSON.parse(result);
	} catch {
		return undefined;
	}
}
