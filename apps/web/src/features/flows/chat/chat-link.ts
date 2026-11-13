import {
	nodeLadderLabel,
	type SpendSaving,
	savingKindOf,
} from "@nightshift/client";

/** The way to save a chat about a run starts from: its kind, and the label of the step that cost most. */
export type ChatSaving = { kind: SpendSaving["kind"]; step?: string };

/**
 * What the editor's `chat` search value opens: the chat panel as it is, or
 * a new chat about one run of the flow. A chat about a run can start from
 * the way to save the run shows. A link, so a run page, the Spend page or
 * a new flow can open the editor with the chat.
 */
export type ChatLink =
	| { kind: "open" }
	| { kind: "run"; runId: string; saving?: ChatSaving };

const RUN_PREFIX = "run:";
const SAVING_PREFIX = "save:";

/** The `chat` search value of `link`. */
export function chatSearch(link: ChatLink): string {
	if (link.kind !== "run") return "open";
	if (!link.saving) return `${RUN_PREFIX}${link.runId}`;
	const { kind, step } = link.saving;
	return `${SAVING_PREFIX}${kind}:${link.runId}${step ? `:${step}` : ""}`;
}

/** The `chat` search value that opens a chat about run `runId`. */
export function chatAboutRun(runId: string): string {
	return chatSearch({ kind: "run", runId });
}

/** The `chat` search value that opens a chat about the way to save `saving`, on the run that shows it. */
export function chatAboutSaving(
	saving: Pick<SpendSaving, "kind" | "step" | "runId">,
): string {
	return chatSearch({
		kind: "run",
		runId: saving.runId,
		saving: {
			kind: saving.kind,
			...(saving.step ? { step: nodeLadderLabel(saving.step) } : {}),
		},
	});
}

/** The link in a `chat` search value, or undefined when it holds none. */
export function parseChatLink(value: unknown): ChatLink | undefined {
	if (value === "open") return { kind: "open" };
	if (typeof value !== "string") return undefined;
	if (value.startsWith(RUN_PREFIX)) {
		const runId = value.slice(RUN_PREFIX.length).trim();
		return runId ? { kind: "run", runId } : undefined;
	}
	if (!value.startsWith(SAVING_PREFIX)) return undefined;
	// The step comes last: it is the only part that can hold a colon.
	const [kindText = "", runText = "", ...rest] = value
		.slice(SAVING_PREFIX.length)
		.split(":");
	const kind = savingKindOf(kindText);
	const runId = runText.trim();
	if (!kind || !runId) return undefined;
	const step = rest.join(":").trim();
	return {
		kind: "run",
		runId,
		saving: { kind, ...(step ? { step } : {}) },
	};
}
