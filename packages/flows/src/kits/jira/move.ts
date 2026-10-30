import type { FlowInput } from "../../flow";

/** `kit:jira/move`: moves a Jira work item to another status, with the Atlassian CLI (`acli`). */
export const jiraMoveKit: FlowInput = {
	version: 7,
	description:
		"Moves a Jira work item to another status, for example In Progress. Needs a CLI tool that runs the Atlassian CLI signed in.",
	inputs: [
		{
			name: "key",
			type: "text",
			description: "The work item, for example PROJ-123.",
			required: true,
		},
		{
			name: "status",
			type: "text",
			description: "The status to move it to, as Jira names it: In Progress.",
			required: true,
		},
		{
			name: "tool",
			type: "text",
			description:
				"The CLI tool that runs acli signed in, for example acli-dimpact. Each CLI tool with a login is one account.",
			default: "acli",
		},
	],
	outputs: [],
	start: "move",
	nodes: [
		{
			id: "move",
			type: "command",
			label: "Move the work item",
			position: { x: 0, y: 0 },
			command: `"{{tool}}" jira workitem transition --key "{{key}}" --status "{{status}}" --yes`,
			exits: [
				{ name: "moved", code: 0, color: "green" },
				{ name: "fail", color: "red" },
			],
		},
		{
			id: "moved",
			type: "end",
			position: { x: 300, y: -60 },
			status: "done",
			message: "{{key}} is in {{status}} now",
		},
		{
			id: "not_moved",
			type: "end",
			position: { x: 300, y: 60 },
			status: "failed",
			message: "Could not move {{key}} to {{status}}",
		},
	],
	edges: [
		{ id: "move-moved", from: "move", outcome: "moved", to: "moved" },
		{ id: "move-fail", from: "move", outcome: "fail", to: "not_moved" },
	],
};
