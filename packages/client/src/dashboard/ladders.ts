import type { FlowHealthRow, FlowRange } from "./types";

/**
 * Where the work landed (Q31), in words both apps share: the name of each
 * rung, its share of the landings, and how sure the deciders were. A
 * landing is one time a node's work or choice came to rest: "32 of 41
 * times". Never "steps": each try of a Cascade is a step of its own.
 */

/** Where the work of a flow's own runs landed. Older Hosts send none. */
type FlowLadders = NonNullable<FlowHealthRow["ladders"]>;
/** Where the climbs of one ladder landed, the cheapest rung first. */
export type LadderSummary = NonNullable<FlowLadders["work"]>;
/** The choice ladder also counts how sure its deciders were. */
type ChoiceLadderSummary = NonNullable<FlowLadders["choice"]>;
/** One rung of a ladder: how often work landed on it, and its cost per landing. */
export type LadderRungRow = LadderSummary["rungs"][number];
/** One node's ladder in a flow's detail. */
export type NodeLadder = NonNullable<
	FlowRange["ladders"]
>["nodes"]["rows"][number];

/** Who works on a node without a Cascade, by `by`. */
const BY_LABEL: Record<LadderRungRow["by"], string> = {
	agent: "Agent",
	flow: "Subflow",
	model: "Decider",
	person: "You",
	rule: "Rule",
};

/**
 * The name of a rung: its tier's name on a Cascade, else who worked on it.
 * A person is always "You", whatever the tier is called. A deadline that
 * answered for you is a rung of its own.
 */
export function rungLabel(
	row: Pick<LadderRungRow, "rung" | "by" | "tier">,
): string {
	switch (row.rung) {
		case "rule":
			return "Rule";
		case "person":
			return "You";
		case "deadline":
			return "Its deadline";
		case "none":
			return "Nowhere";
		default:
			return row.tier ?? BY_LABEL[row.by];
	}
}

/** A share as a whole percent: "78%", "<1%" for a share above 0 that rounds to 0. */
function percent(part: number, whole: number): string {
	if (whole <= 0) return "0%";
	const share = Math.round((part / whole) * 100);
	return share === 0 && part > 0 ? "<1%" : `${share}%`;
}

/** One rung with its name and its share of the ladder's landings. */
export type LadderPart = LadderRungRow & {
	/** `rung` and name: unique on one ladder. */
	key: string;
	label: string;
	/** "78%". */
	share: string;
};

/** The rungs of a ladder in ladder order, with their names and shares. */
export function ladderParts(summary: LadderSummary): LadderPart[] {
	return summary.rungs.map((row) => {
		const label = rungLabel(row);
		return {
			...row,
			key: `${row.rung}:${label}`,
			label,
			share: percent(row.landed, summary.landed),
		};
	});
}

/**
 * Where a ladder's landings went, in one line, in ladder order: "Sonnet
 * 78% · Opus 19% · You 3%". With more rungs than `max`, the biggest stay
 * and the line says how many it leaves out.
 */
export function shareText(summary: LadderSummary, max = 3): string {
	const parts = ladderParts(summary);
	const kept = new Set(
		[...parts]
			.sort((a, b) => b.landed - a.landed)
			.slice(0, max)
			.map((part) => part.key),
	);
	const shown = parts
		.filter((part) => kept.has(part.key))
		.map((part) => `${part.label} ${part.share}`);
	const hidden = parts.length - shown.length;
	return [...shown, ...(hidden > 0 ? [`${hidden} more`] : [])].join(" · ");
}

/** How often work landed on a rung: "32 of 41 times". */
export function landedText(landed: number, of: number): string {
	return `${landed} of ${of} ${of === 1 ? "time" : "times"}`;
}

/** How often a choice landed on a rung: "32 of 50 Decisions". */
export function decisionsText(landed: number, of: number): string {
	return `${landed} of ${of} ${of === 1 ? "Decision" : "Decisions"}`;
}

/**
 * How sure the deciders were: "A decider was not sure enough in 6 of 50
 * Decisions." Null when no decider gave a probability.
 */
export function unsureText(
	choice: Pick<ChoiceLadderSummary, "picked" | "unsure">,
): string | null {
	const { picked, unsure } = choice;
	if (picked === 0) return null;
	if (unsure === 0) {
		return picked === 1
			? "A decider was sure enough in its 1 Decision."
			: `A decider was sure enough in all ${picked} Decisions.`;
	}
	return `A decider was not sure enough in ${decisionsText(unsure, picked)}.`;
}

/** A node by its id, after the Subflow nodes it ran in: "write / draft". */
export function nodeLadderLabel(
	node: Pick<NodeLadder, "nodeId" | "via">,
): string {
	return [...(node.via ? node.via.split("/") : []), node.nodeId].join(" / ");
}
