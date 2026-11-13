import {
	gateOrder,
	mayAnswer,
	type OpenGate,
	type RunSummary,
} from "@nightshift/client";

/**
 * What waits for you on Needs you: a Gate, or a run that stopped.
 * Learnings to check wait on the computer: they are no work for now.
 */
export type NeedsItem =
	| { kind: "gate"; key: string; gate: OpenGate }
	| { kind: "run"; key: string; run: RunSummary };

/** The parts of the queue. Undefined while a part loads or did not load. */
export type NeedsParts = {
	gates: readonly OpenGate[] | undefined;
	runs: readonly RunSummary[] | undefined;
};

/**
 * Everything that waits for you, in one order: the Gates you may answer
 * first, in queue order (`gateOrder`), then the runs that stopped (the
 * newest first). A part that loads still adds nothing yet.
 */
export function needsItems(parts: NeedsParts): NeedsItem[] {
	return [
		...gateOrder((parts.gates ?? []).filter(mayAnswer)).map(
			(gate): NeedsItem => ({
				kind: "gate",
				key: `gate:${gate.runId}:${gate.stepId}`,
				gate,
			}),
		),
		...(parts.runs ?? []).map(runItem),
	];
}

/** A run that stopped, as a thing of the queue. */
export function runItem(run: RunSummary): NeedsItem {
	return { kind: "run", key: `run:${run.id}`, run };
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** "3 things wait for you". */
export function waitsText(count: number): string {
	return `${plural(count, "thing waits", "things wait")} for you`;
}

/** What a screen reader says for the Needs you tab: "Needs you, 3 things wait for you". */
export function needsTabLabel(count: number): string {
	return count === 0 ? "Needs you" : `Needs you, ${waitsText(count)}`;
}
