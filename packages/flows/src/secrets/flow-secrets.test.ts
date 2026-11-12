import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowInput, flowSchema } from "../flow";
import { flowSecrets } from "./flow-secrets";

/** `${NAME}`, as a person writes a secret reference. */
const ref = (name: string) => `\${${name}}`;

const at = { x: 0, y: 0 };

/** A flow of these nodes, with no edges: the order of the nodes is all that counts here. */
function flowOf(
	nodes: Record<string, unknown>[],
	extra: Partial<Omit<FlowInput, "version" | "nodes">> = {},
): Flow {
	return flowSchema.parse({
		version: FLOW_VERSION,
		start: nodes[0]?.id ?? "a",
		nodes: nodes.map((node) => ({ position: at, ...node })),
		edges: [],
		...extra,
	});
}

const webRequest = (id: string, fields: Record<string, unknown>) => ({
	id,
	type: "web-request",
	method: "POST",
	...fields,
});

describe("flowSecrets: each node kind", () => {
	test("Command and Service nodes: the secrets they name", () => {
		const flow = flowOf([
			{ id: "login", type: "command", command: "true", secrets: ["API_USER"] },
			{
				id: "stack",
				type: "service",
				start: "docker compose up -d",
				ready: { command: "true" },
				secrets: ["DB_PASSWORD", "API_USER"],
			},
		]);
		expect(flowSecrets(flow)).toEqual(["API_USER", "DB_PASSWORD"]);
	});

	test("a Web request: the secret that holds its URL, and each secret reference of its URL, query, headers and body", () => {
		const flow = flowOf([
			webRequest("hook", {
				urlSecret: "CHAT_URL",
				body: { kind: "text", value: "hi" },
			}),
			webRequest("api", {
				url: `https://api.example.com/${ref("ACCOUNT")}/items`,
				query: { key: ref("API_KEY") },
				headers: { Authorization: `Bearer ${ref("API_TOKEN")}` },
				body: { kind: "json", value: `{"sign": "${ref("SIGNING_KEY")}"}` },
			}),
			webRequest("form", {
				url: "https://example.com/login",
				body: { kind: "form", fields: { password: ref("SITE_PASSWORD") } },
			}),
			webRequest("text", {
				url: "https://example.com/note",
				body: { kind: "text", value: `token ${ref("NOTE_TOKEN")}` },
			}),
		]);
		expect(flowSecrets(flow)).toEqual([
			"CHAT_URL",
			"ACCOUNT",
			"API_KEY",
			"API_TOKEN",
			"SIGNING_KEY",
			"SITE_PASSWORD",
			"NOTE_TOKEN",
		]);
	});

	test("a Web request whose URL secret a run picks names no secret before the run", () => {
		const flow = flowOf([
			{ id: "pick", type: "command", command: "echo TEAM_URL" },
			webRequest("send", { urlSecret: "{{pick.data}}" }),
		]);
		expect(flowSecrets(flow)).toEqual([]);
	});

	test("a Wait for a URL: each secret reference of its URL and headers, and other Waits name none", () => {
		const flow = flowOf([
			{
				id: "ready",
				type: "wait",
				until: {
					kind: "url",
					url: `https://status.example.com/${ref("JOB_ID")}`,
					everyMinutes: 5,
					headers: { Authorization: `Bearer ${ref("STATUS_TOKEN")}` },
				},
			},
			{ id: "later", type: "wait", until: { kind: "duration", minutes: 5 } },
		]);
		expect(flowSecrets(flow)).toEqual(["JOB_ID", "STATUS_TOKEN"]);
	});

	test("Agent and Tool nodes name no secret: a connection or a CLI tool reads them on the computer", () => {
		const flow = flowOf([
			{
				id: "plan",
				type: "agent",
				prompt: "Plan",
				harness: "claude-code",
				model: "sonnet",
				permissionMode: "auto",
				connections: ["tracker"],
				clis: ["gh"],
			},
			{ id: "file", type: "tool", connection: "tracker", tool: "create" },
		]);
		expect(flowSecrets(flow)).toEqual([]);
	});

	test("the flow's own input default fills a URL secret template", () => {
		const flow = flowOf([webRequest("send", { urlSecret: "{{hook}}" })], {
			inputs: [{ name: "hook", type: "text", default: "TEAM_CHAT_URL" }],
		});
		expect(flowSecrets(flow)).toEqual(["TEAM_CHAT_URL"]);
		const required = flowOf([webRequest("send", { urlSecret: "{{hook}}" })], {
			inputs: [{ name: "hook", type: "text", required: true }],
		});
		expect(flowSecrets(required)).toEqual([]);
	});
});

describe("flowSecrets: the flows and kits it calls", () => {
	const call = (id: string, flow: string, extra: object = {}) => ({
		id,
		type: "call",
		flow,
		...extra,
	});

	test("a kit: the secret its input names by default, or the one a binding names", () => {
		expect(flowSecrets(flowOf([call("tell", "kit:message/send")]))).toEqual([
			"MESSAGE_WEBHOOK_URL",
		]);
		expect(
			flowSecrets(
				flowOf([
					call("tell", "kit:message/send", {
						inputs: {
							message: "{{run.flow}} is done",
							webhook: "TEAM_CHAT_URL",
						},
					}),
				]),
			),
		).toEqual(["TEAM_CHAT_URL"]);
		expect(flowSecrets(flowOf([call("mail", "kit:email/send")]))).toEqual([
			"EMAIL_SMTP_URL",
			"EMAIL_SMTP_USER",
			"EMAIL_SMTP_PASSWORD",
		]);
	});

	test("a binding reads the caller's inputs when they are known, else the run decides", () => {
		const viaInput = flowOf(
			[call("tell", "kit:message/send", { inputs: { webhook: "{{hook}}" } })],
			{ inputs: [{ name: "hook", type: "text", default: "OPS_CHAT_URL" }] },
		);
		expect(flowSecrets(viaInput)).toEqual(["OPS_CHAT_URL"]);
		const viaOutput = flowOf([
			{ id: "pick", type: "command", command: "echo X" },
			call("tell", "kit:message/send", {
				inputs: { webhook: "{{pick.data}}" },
			}),
		]);
		expect(flowSecrets(viaOutput)).toEqual([]);
		// A binding that renders empty text takes the default, as a run does.
		const empty = flowOf(
			[call("tell", "kit:message/send", { inputs: { webhook: "{{hook}}" } })],
			{ inputs: [{ name: "hook", type: "text", default: " " }] },
		);
		expect(flowSecrets(empty)).toEqual([]);
	});

	test("a flow of the project, its cascade tiers, and a call back that ends the walk", () => {
		const notify = flowOf([webRequest("send", { urlSecret: "{{hook}}" })], {
			inputs: [{ name: "hook", type: "text", default: "NOTIFY_URL" }],
		});
		const fetch = flowOf([
			{ id: "get", type: "command", command: "true", secrets: ["FETCH_TOKEN"] },
			call("again", "main"),
		]);
		const main = flowOf([
			call("fetch", "fetch", {
				cascade: [
					{ flow: "fetch" },
					{ flow: "notify", inputs: { hook: "BACKUP_URL" } },
				],
			}),
			call("missing", "gone"),
			call("broken", "broken"),
		]);
		const flows = { main, fetch, notify, broken: null };
		expect(flowSecrets(main, { flows, name: "main" })).toEqual([
			"FETCH_TOKEN",
			"BACKUP_URL",
		]);
		// Without the project's flows, only kits are known.
		expect(flowSecrets(main)).toEqual([]);
	});

	test("the input that takes each element of a list is not known before the run", () => {
		const each = flowOf([webRequest("send", { urlSecret: "{{item}}" })], {
			inputs: [{ name: "item", type: "text", default: "FIRST_URL" }],
		});
		const main = flowOf([
			call("all", "each", {
				each: { source: { kind: "json", value: '["A_URL"]' }, as: "item" },
			}),
		]);
		expect(flowSecrets(main, { flows: { each } })).toEqual([]);
	});
});
