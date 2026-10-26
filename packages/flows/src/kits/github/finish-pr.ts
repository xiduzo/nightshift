import type { FlowInput } from "../../document";

/** The data the finish commands write: the pull request as it is now. */
const VIEW = `gh pr view "$pr" --json number,url,state,isDraft --jq '{number, url, state: (.state | ascii_downcase), draft: .isDraft}' > "$NS_OUTPUT"`;

/**
 * `kit:github/finish-pr`: marks a draft pull request ready for review, or
 * closes it with a comment. `gh` only.
 */
export const finishPrKit: FlowInput = {
	version: 6,
	description:
		"Marks a pull request ready for review, or closes it. Both can leave a comment on it.",
	inputs: [
		{
			name: "pr",
			type: "text",
			description: "The pull request: its number, its address or its branch.",
			required: true,
		},
		{
			name: "action",
			type: "text",
			description: "ready or close.",
			default: "ready",
		},
		{
			name: "comment",
			type: "text",
			description:
				"A comment to leave on the pull request, in Markdown. Empty: no comment.",
			default: "",
		},
	],
	outputs: [
		{
			name: "number",
			value: "{{vars.result.number}}",
			description: "The number of the pull request.",
		},
		{
			name: "url",
			value: "{{vars.result.url}}",
			description: "The address of the pull request.",
		},
		{
			name: "state",
			value: "{{vars.result.state}}",
			description: "open, closed or merged.",
		},
	],
	variables: [
		{
			name: "result",
			type: "json",
			description: "The pull request as it is after the action.",
		},
	],
	start: "what",
	nodes: [
		{
			id: "what",
			type: "decision",
			label: "Ready or close",
			position: { x: 0, y: 0 },
			by: "rule",
			prompt: "Picks what the action input asks for.",
			options: [
				{ name: "ready", when: 'action = "ready"', color: "green" },
				{ name: "close", when: 'action = "close"', color: "orange" },
				{ name: "other", color: "red" },
			],
		},
		{
			id: "ready",
			type: "command",
			label: "Mark it ready",
			position: { x: 300, y: -120 },
			command: `# Marks the pull request ready for review, then leaves the comment.
set -e
pr="{{pr}}"
comment="{{comment}}"
gh pr ready "$pr"
if [ -n "$comment" ]; then gh pr comment "$pr" --body "$comment"; fi
${VIEW}`,
			set: [{ variable: "result", value: "{{ready.data}}", on: ["ready"] }],
			exits: [
				{ name: "ready", code: 0, color: "green" },
				{ name: "fail", color: "red" },
			],
		},
		{
			id: "close",
			type: "command",
			label: "Close it",
			position: { x: 300, y: 40 },
			command: `# Closes the pull request with the comment. Its branch stays.
set -e
pr="{{pr}}"
comment="{{comment}}"
if [ -n "$comment" ]; then gh pr close "$pr" --comment "$comment"; else gh pr close "$pr"; fi
${VIEW}`,
			set: [{ variable: "result", value: "{{close.data}}", on: ["closed"] }],
			exits: [
				{ name: "closed", code: 0, color: "green" },
				{ name: "fail", color: "red" },
			],
		},
		{
			id: "is_ready",
			type: "end",
			position: { x: 600, y: -200 },
			status: "done",
			message: "Pull request #{{ready.data.number}} is ready for review",
		},
		{
			id: "is_closed",
			type: "end",
			position: { x: 600, y: 40 },
			status: "done",
			message: "Closed pull request #{{close.data.number}}",
		},
		{
			id: "failed",
			type: "end",
			position: { x: 600, y: 200 },
			status: "failed",
			message: "Could not finish the pull request {{pr}}",
		},
		{
			id: "unknown_action",
			type: "end",
			position: { x: 300, y: 200 },
			status: "failed",
			message: "The action must be ready or close, not {{action}}",
		},
	],
	edges: [
		{ id: "what-ready", from: "what", outcome: "ready", to: "ready" },
		{ id: "what-close", from: "what", outcome: "close", to: "close" },
		{ id: "what-other", from: "what", outcome: "other", to: "unknown_action" },
		{ id: "ready-ready", from: "ready", outcome: "ready", to: "is_ready" },
		{ id: "ready-fail", from: "ready", outcome: "fail", to: "failed" },
		{ id: "close-closed", from: "close", outcome: "closed", to: "is_closed" },
		{ id: "close-fail", from: "close", outcome: "fail", to: "failed" },
	],
};
