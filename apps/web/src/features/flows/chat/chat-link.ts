/**
 * What the editor's `chat` search value opens: the chat panel as it is, or
 * a new chat about one run of the flow. A link, so a run page or a new
 * flow can open the editor with the chat.
 */
export type ChatLink = { kind: "open" } | { kind: "run"; runId: string };

const RUN_PREFIX = "run:";

/** The `chat` search value of `link`. */
export function chatSearch(link: ChatLink): string {
	return link.kind === "run" ? `${RUN_PREFIX}${link.runId}` : "open";
}

/** The `chat` search value that opens a chat about run `runId`. */
export function chatAboutRun(runId: string): string {
	return chatSearch({ kind: "run", runId });
}

/** The link in a `chat` search value, or undefined when it holds none. */
export function parseChatLink(value: unknown): ChatLink | undefined {
	if (value === "open") return { kind: "open" };
	if (typeof value !== "string" || !value.startsWith(RUN_PREFIX))
		return undefined;
	const runId = value.slice(RUN_PREFIX.length).trim();
	return runId ? { kind: "run", runId } : undefined;
}
