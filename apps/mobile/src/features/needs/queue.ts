import {
	gateOrder,
	mayAnswer,
	type OpenGate,
	type RunSummary,
	urgencyOf,
} from "@nightshift/client";
import { GATE_URGENCIES, type GateUrgency } from "@nightshift/flows";

/** What waits for you on Needs you: a Gate, a run that stopped, or a learning. */
export type NeedsItem<L> =
	| { kind: "gate"; key: string; gate: OpenGate }
	| { kind: "run"; key: string; run: RunSummary }
	| { kind: "learning"; key: string; learning: L };

/** The parts of the queue. Undefined while a part loads or did not load. */
export type NeedsParts<L> = {
	gates: readonly OpenGate[] | undefined;
	runs: readonly RunSummary[] | undefined;
	learnings: readonly L[] | undefined;
};

/**
 * Everything that waits for you, in one order: the Gates you may answer
 * first, in queue order (`gateOrder`), then the runs that stopped (the
 * newest first), then the learnings. A part that loads still adds
 * nothing yet.
 */
export function needsItems<L extends { projectId: string; id: string }>(
	parts: NeedsParts<L>,
): NeedsItem<L>[] {
	return [
		...gateOrder((parts.gates ?? []).filter(mayAnswer)).map(
			(gate): NeedsItem<L> => ({
				kind: "gate",
				key: `gate:${gate.runId}:${gate.stepId}`,
				gate,
			}),
		),
		...(parts.runs ?? []).map(
			(run): NeedsItem<L> => ({ kind: "run", key: `run:${run.id}`, run }),
		),
		...(parts.learnings ?? []).map(
			(learning): NeedsItem<L> => ({
				kind: "learning",
				key: `learning:${learning.projectId}:${learning.id}`,
				learning,
			}),
		),
	];
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** When the first Gate of the queue closes. Undefined when no Gate has a deadline. */
export function firstDeadline(
	items: readonly NeedsItem<unknown>[],
): number | undefined {
	const deadlines = items.flatMap((item) =>
		item.kind === "gate" && item.gate.deadline ? [item.gate.deadline.at] : [],
	);
	return deadlines.length > 0 ? Math.min(...deadlines) : undefined;
}

/**
 * The line under a title: what waits and when the first Gate closes.
 * "3 things. The first Gate closes at 07:30." "1 thing. No Gate is open."
 */
export function needsSummary(
	items: readonly NeedsItem<unknown>[],
	time: (epochMs: number) => string,
): string {
	if (items.length === 0) return "Nothing needs you";
	const things = plural(items.length, "thing", "things");
	if (!items.some((item) => item.kind === "gate")) {
		return `${things}. No Gate is open.`;
	}
	const at = firstDeadline(items);
	return at === undefined
		? `${things}. A Gate waits for you.`
		: `${things}. The first Gate closes at ${time(at)}.`;
}

/**
 * A section of Needs you: the Gates for now, for today and for when you
 * have time, the runs that stopped, the learnings.
 */
export type NeedsSection = GateUrgency | "run" | "learning";

const SECTIONS: readonly NeedsSection[] = [
	...GATE_URGENCIES,
	"run",
	"learning",
];

/** The section of one thing: a Gate goes in the section of its urgency. */
function sectionOf(item: NeedsItem<unknown>): NeedsSection {
	return item.kind === "gate" ? urgencyOf(item.gate) : item.kind;
}

/**
 * One row of the Needs you list: the head of a section, or one thing of
 * it. A thing knows whether it starts or ends its section's card.
 */
export type NeedsRow<L> =
	| {
			kind: "head";
			key: string;
			section: NeedsSection;
			count: number;
			/** The first section: no space above its head. */
			top: boolean;
	  }
	| (NeedsItem<L> & { first: boolean; last: boolean });

/**
 * The queue as one flat list: the head of each section that holds
 * something, then its things in queue order. The Gates split by urgency:
 * Now, Today, When you have time. A section with nothing in it stays out.
 */
export function needsRows<L>(items: readonly NeedsItem<L>[]): NeedsRow<L>[] {
	const rows: NeedsRow<L>[] = [];
	for (const section of SECTIONS) {
		const part = items.filter((item) => sectionOf(item) === section);
		if (part.length === 0) continue;
		rows.push({
			kind: "head",
			key: `head:${section}`,
			section,
			count: part.length,
			top: rows.length === 0,
		});
		part.forEach((item, at) => {
			rows.push({ ...item, first: at === 0, last: at === part.length - 1 });
		});
	}
	return rows;
}

/** Where the heads are in the list: they stick to the top while their rows scroll. */
export function headIndices(rows: readonly NeedsRow<unknown>[]): number[] {
	return rows.flatMap((row, index) => (row.kind === "head" ? [index] : []));
}

/** What a screen reader says for the Needs you tab: "Needs you, 3 things wait for you". */
export function needsTabLabel(count: number): string {
	return count === 0
		? "Needs you"
		: `Needs you, ${plural(count, "thing waits", "things wait")} for you`;
}
