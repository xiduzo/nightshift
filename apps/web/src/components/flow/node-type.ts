import type { DecidedBy, FlowNodeType, ValueBy } from "@nightshift/flows";
import {
	BotIcon,
	BracesIcon,
	HandIcon,
	HourglassIcon,
	type LucideIcon,
	RepeatIcon,
	SparklesIcon,
	SplitIcon,
	SquareFunctionIcon,
	SquareTerminalIcon,
	VariableIcon,
} from "lucide-react";

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
	call: {
		label: "Call",
		icon: SquareFunctionIcon,
		blurb: "Runs another flow once, or once per item in a list.",
	},
	value: {
		label: "Value",
		icon: VariableIcon,
		blurb: "Makes a value from a rule or a model.",
	},
	wait: {
		label: "Wait",
		icon: HourglassIcon,
		blurb: "Waits for a time, a command to pass, or a signal.",
	},
};

/** The icon of a Call node that runs once per item. */
export const CALL_EACH_ICON: LucideIcon = RepeatIcon;

/** The icon of a Decision node, by who decides it. */
export const DECIDED_BY_ICON: Record<DecidedBy, LucideIcon> = {
	person: HandIcon,
	rule: SplitIcon,
	model: SparklesIcon,
};

/** The icon of a Value node, by who makes it. */
export const VALUE_BY_ICON: Record<ValueBy, LucideIcon> = {
	rule: BracesIcon,
	model: SparklesIcon,
};

/**
 * Whether a step ran a model and so has a cost: an Agent step, a Decision
 * step decided by a model, or a Value step made by a model (a Gate or a
 * rule costs nothing).
 */
export function hasCost(step: {
	nodeType: FlowNodeType;
	gate: unknown | null;
	costUsd: number;
}): boolean {
	return (
		step.nodeType === "agent" ||
		(step.nodeType === "decision" && step.gate === null && step.costUsd > 0) ||
		(step.nodeType === "value" && step.costUsd > 0)
	);
}
