import type { PermissionMode } from "@/shared/api";

/**
 * The permission modes as the settings page offers them for the default
 * agent: a short label and what each one means at night. The Agents page
 * and the flow editor use the one-line labels of `PERMISSION_MODES` in
 * the agents vertical.
 */
export const PERMISSION_MODES: {
	value: PermissionMode;
	label: string;
	description: string;
}[] = [
	{
		value: "auto",
		label: "Auto",
		description: "Claude Code approves safe actions itself. Made for nights.",
	},
	{
		value: "acceptEdits",
		label: "Accept edits",
		description: "Edits files. Runs no commands without your approval.",
	},
	{
		value: "default",
		label: "Ask for each tool",
		description:
			"Asks before each tool. At night nobody answers, so the agent stops.",
	},
	{
		value: "plan",
		label: "Plan only",
		description: "Reads the code and writes a plan. Changes nothing.",
	},
	{
		value: "bypassPermissions",
		label: "Bypass permissions",
		description:
			"Runs every tool and shell command without asking. Use it only on a project you trust.",
	},
];
