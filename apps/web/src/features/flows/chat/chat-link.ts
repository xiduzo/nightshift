import {
	type FlowMove,
	moveKindOf,
	nodeLadderLabel,
	type SpendSaving,
	savingKindOf,
} from "@nightshift/client";

/** The way to save a chat about a run starts from: its kind, and the label of the step that cost most. */
export type ChatSaving = { kind: SpendSaving["kind"]; step?: string };

/** The next change to try a chat about a run starts from: its kind, and the step it is about. */
export type ChatMove = { kind: FlowMove["kind"]; step?: string };

/**
 * What the editor's `chat` search value opens: the chat panel as it is, or
 * a new chat about one run of the flow. A chat about a run can start from
 * the way to save the run shows, or from the next change to try that it
 * shows. A link, so a run page, the Spend page, a project's page or a new
 * flow can open the editor with the chat.
 */
export type ChatLink =
	| { kind: "open" }
	| { kind: "run"; runId: string; saving?: ChatSaving; move?: ChatMove };

const RUN_PREFIX = "run:";
const SAVING_PREFIX = "save:";
const MOVE_PREFIX = "move:";

/** The `chat` search value of `link`. */
export function chatSearch(link: ChatLink): string {
	if (link.kind !== "run") return "open";
	if (link.move) {
		const { kind, step } = link.move;
		return `${MOVE_PREFIX}${kind}:${link.runId}${step ? `:${step}` : ""}`;
	}
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

/** The `chat` search value that opens a chat about the next change to try `move`, on the run that shows it. */
export function chatAboutMove(move: {
	kind: FlowMove["kind"];
	runId: string;
	step?: string;
}): string {
	return chatSearch({
		kind: "run",
		runId: move.runId,
		move: { kind: move.kind, ...(move.step ? { step: move.step } : {}) },
	});
}

/** The kind, the run and the step after a prefix: `<kind>:<runId>[:<step>]`. */
function kindRunStep(value: string): [string, string, string] {
	// The step comes last: it is the only part that can hold a colon.
	const [kind = "", run = "", ...rest] = value.split(":");
	return [kind, run.trim(), rest.join(":").trim()];
}

/** The link in a `chat` search value, or undefined when it holds none. */
export function parseChatLink(value: unknown): ChatLink | undefined {
	if (value === "open") return { kind: "open" };
	if (typeof value !== "string") return undefined;
	if (value.startsWith(RUN_PREFIX)) {
		const runId = value.slice(RUN_PREFIX.length).trim();
		return runId ? { kind: "run", runId } : undefined;
	}
	if (value.startsWith(MOVE_PREFIX)) {
		const [kindText, runId, step] = kindRunStep(
			value.slice(MOVE_PREFIX.length),
		);
		const kind = moveKindOf(kindText);
		if (!kind || !runId) return undefined;
		return { kind: "run", runId, move: { kind, ...(step ? { step } : {}) } };
	}
	if (!value.startsWith(SAVING_PREFIX)) return undefined;
	const [kindText, runId, step] = kindRunStep(
		value.slice(SAVING_PREFIX.length),
	);
	const kind = savingKindOf(kindText);
	if (!kind || !runId) return undefined;
	return {
		kind: "run",
		runId,
		saving: { kind, ...(step ? { step } : {}) },
	};
}
