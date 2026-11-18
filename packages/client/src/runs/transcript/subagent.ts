/**
 * A subagent in an agent's transcript: a call of Claude Code's Agent tool
 * (Task in older versions) starts one. Its own events carry the call's id
 * (`parentToolCallId`). Pure, for the web and the phone.
 */

/** What the agent asked a subagent to do, from the call's input. */
export type SubagentTask = {
	/** The kind of subagent, for example "Explore". Null when the input has none. */
	agent: string | null;
	/** The short task, for example "Find the tests". */
	description: string | null;
	/** The full task the subagent got. */
	prompt: string | null;
	/** The model the call asked for, when it asked for one. */
	model: string | null;
};

const SUBAGENT_TOOLS = new Set(["agent", "task"]);

function field(input: Record<string, unknown>, name: string): string | null {
	const value = input[name];
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The task of a call that starts a subagent, or null for any other call. */
export function subagentTask(
	name: string,
	input: unknown,
): SubagentTask | null {
	if (!SUBAGENT_TOOLS.has(name.toLowerCase())) return null;
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return null;
	}
	const record = input as Record<string, unknown>;
	const task: SubagentTask = {
		agent: field(record, "subagent_type"),
		description: field(record, "description"),
		prompt: field(record, "prompt"),
		model: field(record, "model"),
	};
	// Another tool of that name: it takes no task.
	return (task.agent ?? task.prompt ?? task.description) ? task : null;
}

/**
 * The call's result says only that the subagent started in the background
 * (Claude Code's async agents). The subagent's own last message is then
 * its answer.
 */
export function isLaunchNotice(result: string): boolean {
	return /^\s*Async agent launched/i.test(result);
}
