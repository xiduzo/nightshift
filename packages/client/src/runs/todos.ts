import {
	type AgentToolCall,
	isRecord,
	jsonResult,
	stringField,
	toolName,
} from "./tool-input";

/** Where one item of an agent's to-do list stands. */
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

/** One item of an agent's to-do list. */
export type Todo = {
	content: string;
	status: TodoStatus;
	/** What the agent says while it works on the item: "Running the tests". */
	activeForm?: string;
};

const STATUSES: ReadonlySet<string> = new Set([
	"pending",
	"in_progress",
	"completed",
	"cancelled",
]);

/** Claude Code's `TodoWrite` and OpenCode's `todowrite`: `{todos: [{content, status, activeForm?}]}`. */
const TODO_WRITE = new Set(["todowrite", "todo_write"]);
/**
 * A list the harness keeps itself: Codex's to-do list (`{items: [{text,
 * completed}]}`) and an ACP agent's plan (`{items: [{content, status}]}`).
 * The input has the list while the agent works, the result once it is done.
 */
const TODO_LIST = "todo_list";

function todoOf(value: unknown): Todo | undefined {
	if (!isRecord(value)) return undefined;
	const content = stringField(value, ["content", "text", "step"])?.trim();
	if (!content) return undefined;
	const raw = value.status;
	const status: TodoStatus =
		typeof raw === "string" && STATUSES.has(raw)
			? (raw as TodoStatus)
			: value.completed === true
				? "completed"
				: "pending";
	const activeForm = stringField(value, ["activeForm"])?.trim();
	return activeForm ? { content, status, activeForm } : { content, status };
}

function todosOf(list: unknown): Todo[] | undefined {
	if (!Array.isArray(list)) return undefined;
	return list.flatMap((value) => {
		const todo = todoOf(value);
		return todo ? [todo] : [];
	});
}

/** The list one call wrote, or undefined for a call that writes none. */
function listOf(call: AgentToolCall): Todo[] | undefined {
	const name = toolName(call.name);
	if (TODO_WRITE.has(name)) {
		return isRecord(call.input) ? todosOf(call.input.todos) : undefined;
	}
	if (name === TODO_LIST) {
		const answer = jsonResult(call.result);
		if (isRecord(answer) && Array.isArray(answer.items)) {
			return todosOf(answer.items);
		}
		return isRecord(call.input) ? todosOf(call.input.items) : undefined;
	}
	return undefined;
}

/**
 * The agent's to-do list as it stands now: the list of its newest to-do
 * call, in call order. Undefined when the step never wrote one, or when the
 * newest list is empty.
 */
export function stepTodos(calls: readonly AgentToolCall[]): Todo[] | undefined {
	let latest: Todo[] | undefined;
	for (const call of calls) {
		latest = listOf(call) ?? latest;
	}
	return latest && latest.length > 0 ? latest : undefined;
}
