import type { DecidedBy, FlowNodeType } from "@nightshift/flows";
import {
	BotIcon,
	HandIcon,
	type LucideIcon,
	PlugIcon,
	RepeatIcon,
	SparklesIcon,
	SplitIcon,
	SquareFunctionIcon,
	SquareTerminalIcon,
} from "lucide-react";

import type { NodeKind } from "@/lib/flow-draft";

type NodeMeta = { label: string; icon: LucideIcon; blurb: string };

/** How each node type shows in the editor, the run graph and the step list. */
export const NODE_TYPE: Record<FlowNodeType, NodeMeta> = {
	agent: {
		label: "Agent",
		icon: BotIcon,
		blurb: "A coding agent works on a task.",
	},
	command: {
		label: "Command",
		icon: SquareTerminalIcon,
		blurb: "Runs a shell command.",
	},
	decision: {
		label: "Decision",
		icon: SplitIcon,
		blurb: "Picks one of its options: you, a rule, or a model.",
	},
	subflow: {
		label: "Subflow",
		icon: SquareFunctionIcon,
		blurb: "Runs another flow once.",
	},
	foreach: {
		label: "For Each",
		icon: RepeatIcon,
		blurb: "Runs a flow once for each item in a list.",
	},
	tool: {
		label: "Tool",
		icon: PlugIcon,
		blurb: "Calls one tool of a connection.",
	},
};

/** The icon of a Decision node, by who decides it. */
export const DECIDED_BY_ICON: Record<DecidedBy, LucideIcon> = {
	person: HandIcon,
	rule: SplitIcon,
	model: SparklesIcon,
};

/** What the palette offers: every node type, plus a Gate (a Decision decided by you). */
export const PALETTE_ENTRY: Record<NodeKind, NodeMeta> = {
	...NODE_TYPE,
	gate: {
		label: "Gate",
		icon: HandIcon,
		blurb: "Waits for you to pick an option in the Needs-you inbox.",
	},
};

/**
 * Whether a step ran a model and so has a cost: an Agent step, or a
 * Decision step decided by a model (a Gate or a rule costs nothing).
 */
export function hasCost(step: {
	nodeType: FlowNodeType;
	gate: unknown | null;
	costUsd: number;
}): boolean {
	return (
		step.nodeType === "agent" ||
		(step.nodeType === "decision" && step.gate === null && step.costUsd > 0)
	);
}
