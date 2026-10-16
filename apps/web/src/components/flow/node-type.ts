import type { FlowNodeType } from "@nightshift/flows";
import {
	BotIcon,
	HandIcon,
	type LucideIcon,
	RepeatIcon,
	SplitIcon,
	SquareFunctionIcon,
	SquareTerminalIcon,
} from "lucide-react";

/** How each node type shows in the editor, the run graph and the step list. */
export const NODE_TYPE: Record<
	FlowNodeType,
	{ label: string; icon: LucideIcon; blurb: string }
> = {
	agent: {
		label: "Agent",
		icon: BotIcon,
		blurb: "Runs a Claude Code session in the worktree.",
	},
	command: {
		label: "Command",
		icon: SquareTerminalIcon,
		blurb: "Runs a shell command in the worktree.",
	},
	decision: {
		label: "Decision",
		icon: SplitIcon,
		blurb: "A small model picks one of its labels.",
	},
	gate: {
		label: "Gate",
		icon: HandIcon,
		blurb: "Waits for you to pick a choice in the inbox.",
	},
	subflow: {
		label: "Subflow",
		icon: SquareFunctionIcon,
		blurb: "Runs another flow once, with its inputs bound.",
	},
	foreach: {
		label: "For Each",
		icon: RepeatIcon,
		blurb: "Runs a flow once per element of a list.",
	},
};

/** Node types whose steps run a model and so have a cost. */
export function hasCost(type: FlowNodeType): boolean {
	return type === "agent" || type === "decision";
}
