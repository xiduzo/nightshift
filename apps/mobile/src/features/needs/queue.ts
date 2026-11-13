import {
	gateOrder,
	mayAnswer,
	type OpenGate,
	type RunSummary,
	urgencyOf,
} from "@nightshift/client";
import { GATE_URGENCIES, type GateUrgency } from "@nightshift/flows";

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
		...(parts.runs ?? []).map(
			(run): NeedsItem => ({ kind: "run", key: `run:${run.id}`, run }),
		),
	];
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** When the first Gate of the queue closes. Undefined when no Gate has a deadline. */
export function firstDeadline(items: readonly NeedsItem[]): number | undefined {
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
	items: readonly NeedsItem[],
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
 * have time, and the runs that stopped.
 */
export type NeedsSection = GateUrgency | "run";

const SECTIONS: readonly NeedsSection[] = [...GATE_URGENCIES, "run"];

/** The section of one thing: a Gate goes in the section of its urgency. */
function sectionOf(item: NeedsItem): NeedsSection {
	return item.kind === "gate" ? urgencyOf(item.gate) : item.kind;
}

/**
 * One row of the Needs you list: the head of a section, or one thing of
 * it. A thing knows whether it starts or ends its section's card.
 */
export type NeedsRow =
	| {
			kind: "head";
			key: string;
			section: NeedsSection;
			count: number;
			/** The first section: no space above its head. */
			top: boolean;
	  }
	| (NeedsItem & { first: boolean; last: boolean });

/**
 * The queue as one flat list: the head of each section that holds
 * something, then its things in queue order. The Gates split by urgency:
 * Now, Today, When you have time. A section with nothing in it stays out.
 */
export function needsRows(items: readonly NeedsItem[]): NeedsRow[] {
	const rows: NeedsRow[] = [];
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
export function headIndices(rows: readonly NeedsRow[]): number[] {
	return rows.flatMap((row, index) => (row.kind === "head" ? [index] : []));
}

/** What a screen reader says for the Needs you tab: "Needs you, 3 things wait for you". */
export function needsTabLabel(count: number): string {
	return count === 0
		? "Needs you"
		: `Needs you, ${plural(count, "thing waits", "things wait")} for you`;
}
