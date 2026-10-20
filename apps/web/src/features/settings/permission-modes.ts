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
		description:
			"Claude Code approves safe actions on its own, so nobody needs to be awake. Made for nights.",
	},
	{
		value: "acceptEdits",
		label: "Accept edits",
		description:
			"The agent can edit files. It cannot run commands while nobody is there to approve them.",
	},
	{
		value: "default",
		label: "Ask for each tool",
		description:
			"Asks before each tool. At night nobody answers, so the agent cannot use its tools.",
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
			"Runs every tool, shell commands included, without asking. Use it only on a repository you trust.",
	},
];
