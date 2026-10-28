import type { FlowInput } from "../../document";

/** `kit:jira/assign`: assigns a Jira work item, with the Atlassian CLI (`acli`). */
export const jiraAssignKit: FlowInput = {
	version: 7,
	description:
		"Assigns a Jira work item to a person, or to you. Needs the Atlassian CLI, signed in.",
	inputs: [
		{
			name: "key",
			type: "text",
			description: "The work item, for example PROJ-123.",
			required: true,
		},
		{
			name: "assignee",
			type: "text",
			description:
				"An email address or account ID. @me: you. default: the project's default assignee.",
			default: "@me",
		},
	],
	outputs: [],
	start: "assign",
	nodes: [
		{
			id: "assign",
			type: "command",
			label: "Assign the work item",
			position: { x: 0, y: 0 },
			command: `acli jira workitem assign --key "{{key}}" --assignee "{{assignee}}" --yes`,
			exits: [
				{ name: "assigned", code: 0, color: "green" },
				{ name: "fail", color: "red" },
			],
		},
		{
			id: "assigned",
			type: "end",
			position: { x: 300, y: -60 },
			status: "done",
			message: "Assigned {{key}} to {{assignee}}",
		},
		{
			id: "not_assigned",
			type: "end",
			position: { x: 300, y: 60 },
			status: "failed",
			message: "Could not assign {{key}}",
		},
	],
	edges: [
		{
			id: "assign-assigned",
			from: "assign",
			outcome: "assigned",
			to: "assigned",
		},
		{ id: "assign-fail", from: "assign", outcome: "fail", to: "not_assigned" },
	],
};
