import type { FlowInput } from "../../flow";

/**
 * `kit:message/send`: sends one message to an incoming webhook, whose
 * address a secret holds: a chat, or any other service that takes one. No
 * shell and no CLI: a Value by rule builds the body, and a Web request
 * sends it. The format names no service: `json` puts the message in one
 * field of a JSON object (`field`), `plain` sends it as plain text. The
 * user guide gives the settings of common services.
 */
export const messageSendKit: FlowInput = {
	version: 9,
	description:
		"Sends a message to the incoming webhook of a chat or another service. Save its URL as the secret MESSAGE_WEBHOOK_URL, or name another secret in webhook.",
	inputs: [
		{
			name: "message",
			type: "text",
			description: "The message to send.",
			required: true,
		},
		{
			name: "webhook",
			type: "text",
			description:
				"The name of the secret that holds the webhook URL, for example TEAM_CHAT_URL.",
			default: "MESSAGE_WEBHOOK_URL",
		},
		{
			name: "format",
			type: "choice",
			options: ["json", "plain"],
			description:
				"json sends a JSON object with the message in one field. plain sends the message as plain text.",
			default: "json",
		},
		{
			name: "field",
			type: "text",
			description:
				"json only: the field that holds the message, for example content.",
			default: "text",
		},
	],
	outputs: [],
	start: "build",
	nodes: [
		{
			id: "build",
			type: "value",
			label: "Build the body",
			position: { x: 0, y: 0 },
			by: "rule",
			expression: `format = "plain"
  ? { "type": "text/plain; charset=utf-8", "text": message }
  : { "type": "application/json", "text": $string({ field: message }) }`,
			output: {
				type: "object",
				properties: {
					type: { type: "string", description: "The content type." },
					text: { type: "string", description: "The body to send." },
				},
				required: ["type", "text"],
			},
		},
		{
			id: "send",
			type: "web-request",
			label: "Send the message",
			position: { x: 300, y: 0 },
			method: "POST",
			urlSecret: "{{webhook}}",
			headers: { "Content-Type": "{{build.data.type}}" },
			body: { kind: "text", value: "{{build.data.text}}" },
		},
		{
			id: "sent",
			type: "end",
			position: { x: 600, y: -60 },
			status: "done",
			message: "Sent the message",
		},
		{
			id: "not_sent",
			type: "end",
			position: { x: 600, y: 60 },
			status: "failed",
			message: "Could not send the message",
		},
	],
	edges: [
		{ id: "build-send", from: "build", outcome: "pass", to: "send" },
		{ id: "send-sent", from: "send", outcome: "pass", to: "sent" },
		{ id: "send-fail", from: "send", outcome: "fail", to: "not_sent" },
	],
};
