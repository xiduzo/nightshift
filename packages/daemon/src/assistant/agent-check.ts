import type { AgentErrorKind } from "@nightshift/agents/types";
import type { DeciderName } from "@nightshift/flows";

/**
 * The check of a built-in agent ("Does it answer?"): how long it waits,
 * what it asks a model, and its words for the person when no answer comes.
 */

/** How long a check waits: an agent starts a program first, a model is one call. */
export const CHECK_TIMEOUTS = { agentMs: 60_000, modelMs: 30_000 };

export const NO_CHECK_FOLDER =
	"Night Shift has no folder for the check on this computer. Start Night Shift again, then try again.";

export const NO_CHECK_MODEL =
	"This computer cannot ask this model for a check. Choose another model in Settings.";

/** What the check asks a model that picks an option. */
export const CHECK_QUESTION =
	"This is a check that you answer. Pick the option: ready.";
export const CHECK_LABELS = [{ name: "ready" }, { name: "not ready" }];

/** What the check asks a model that writes an answer, and the shape it holds it to. */
export const CHECK_VALUE_PROMPT =
	'Answer with one JSON object. Set "answer" to the one word: ready.';
export const CHECK_OUTPUT = {
	type: "object",
	properties: { answer: { type: "string" } },
	required: ["answer"],
	additionalProperties: false,
};

export const seconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

/** What the person can check when a model did not answer. */
export function modelHint(decider: DeciderName): string {
	return decider === "ollama"
		? "Check that Ollama runs and has this model."
		: "Check its key and its model in Settings.";
}

/** Words for the person about a model call that failed. */
export function modelProblem(
	decider: DeciderName,
	kind: AgentErrorKind,
	message: string,
): string {
	switch (kind) {
		case "aborted":
			return "Stopped.";
		case "usage-limit":
			return "This model reached its usage limit. Try again later, or choose another model in Settings.";
		case "network":
			return "Night Shift could not reach the model. Check the internet connection, then try again.";
		default: {
			const said = message.trim();
			return `The model did not answer. ${said ? `${/[.!?]$/.test(said) ? said : `${said}.`} ` : ""}${modelHint(decider)}`;
		}
	}
}

/**
 * `work` with a time limit: its signal aborts after `ms`, and the wait
 * ends then, also when the work does not stop. "late": the time ran out.
 */
export async function within<T>(
	ms: number,
	outer: AbortSignal,
	work: (signal: AbortSignal) => Promise<T>,
): Promise<T | "late"> {
	const limit = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<"late">((resolve) => {
		timer = setTimeout(() => {
			limit.abort();
			resolve("late");
		}, ms);
	});
	try {
		return await Promise.race([
			work(AbortSignal.any([outer, limit.signal])),
			late,
		]);
	} finally {
		clearTimeout(timer);
	}
}
