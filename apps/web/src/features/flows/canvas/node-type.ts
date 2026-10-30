import {
	DECISION_LABEL,
	type DecidedBy,
	type EndStatus,
	type FlowNode,
	type FlowNodeType,
	type NewNodeKind,
	NODE_TYPE_LABEL,
	type ValueBy,
} from "@nightshift/flows";
import {
	BotIcon,
	BracesIcon,
	FlagIcon,
	HandIcon,
	HourglassIcon,
	type LucideIcon,
	MergeIcon,
	PlugIcon,
	RepeatIcon,
	SparklesIcon,
	SplitIcon,
	SquareFunctionIcon,
	SquareTerminalIcon,
	VariableIcon,
} from "lucide-react";

type NodeMeta = { label: string; icon: LucideIcon; blurb: string };

/** How each node type shows in the editor, the run graph and the step list: its name (the one of `@nightshift/flows`), icon and blurb. */
export const NODE_TYPE: Record<FlowNodeType, NodeMeta> = {
	agent: {
		label: NODE_TYPE_LABEL.agent,
		icon: BotIcon,
		blurb: "A coding agent works on a task.",
	},
	command: {
		label: NODE_TYPE_LABEL.command,
		icon: SquareTerminalIcon,
		blurb: "Runs a shell command.",
	},
	decision: {
		label: NODE_TYPE_LABEL.decision,
		icon: SplitIcon,
		blurb: "Picks one of its options: you, a rule, or a model.",
	},
	call: {
		label: NODE_TYPE_LABEL.call,
		icon: SquareFunctionIcon,
		blurb: "Runs another flow once, or once per item in a list.",
	},
	value: {
		label: NODE_TYPE_LABEL.value,
		icon: VariableIcon,
		blurb: "Makes a value from a rule or a model.",
	},
	wait: {
		label: NODE_TYPE_LABEL.wait,
		icon: HourglassIcon,
		blurb: "Waits for a time, a command to pass, or a signal.",
	},
	tool: {
		label: NODE_TYPE_LABEL.tool,
		icon: PlugIcon,
		blurb: "Calls one tool of a connection.",
	},
	end: {
		label: NODE_TYPE_LABEL.end,
		icon: FlagIcon,
		blurb: "Ends the run with a result and one line for you.",
	},
	join: {
		label: NODE_TYPE_LABEL.join,
		icon: MergeIcon,
		blurb: "Waits for branches that run at once, then continues.",
	},
};

/**
 * How a Decision shows, by who decides it. You decide a Gate, a rule
 * decides a Branch. A Decision by a model keeps the plain name.
 */
export const DECISION_KIND: Record<DecidedBy, NodeMeta> = {
	person: {
		label: DECISION_LABEL.person,
		icon: HandIcon,
		blurb: "Waits for you to pick one of its options.",
	},
	rule: {
		label: DECISION_LABEL.rule,
		icon: SplitIcon,
		blurb: "Takes the first option whose rule holds.",
	},
	model: {
		label: DECISION_LABEL.model,
		icon: SparklesIcon,
		blurb: "A model picks one of its options.",
	},
};

/** How a node shows: its type, or for a Decision, a Gate or a Branch by who decides it. */
export function nodeMeta(node: FlowNode): NodeMeta {
	return node.type === "decision"
		? DECISION_KIND[node.by]
		: NODE_TYPE[node.type];
}

/** What the palette adds: every node type, with a Decision as a Gate or a Branch. */
export type PaletteItem = Exclude<NewNodeKind, "decision">;

/** How a palette item shows. */
export function paletteMeta(item: PaletteItem): NodeMeta {
	if (item === "gate") return DECISION_KIND.person;
	if (item === "branch") return DECISION_KIND.rule;
	return NODE_TYPE[item];
}

/** How an End node ends the run, in words. */
export const END_STATUS_LABEL: Record<EndStatus, string> = {
	done: "Done",
	"nothing-to-do": "Nothing to do",
	failed: "Failed",
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
	costMissing: number;
}): boolean {
	return (
		step.nodeType === "agent" ||
		(step.nodeType === "decision" &&
			step.gate === null &&
			(step.costUsd > 0 || step.costMissing > 0)) ||
		(step.nodeType === "value" && (step.costUsd > 0 || step.costMissing > 0))
	);
}
