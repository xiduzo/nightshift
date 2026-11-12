import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { validateFlow } from "../validate";
import type { CommandNode } from "./command";
import type { WaitNode } from "./wait";
import { secretParts, type WebRequestNode } from "./web-request";

/**
 * The Web request node and the Wait for a URL: what the schema takes, the
 * checks of their text, and how a node's own text splits into secrets.
 */

function request(
	id: string,
	extra: Partial<WebRequestNode> = {},
): WebRequestNode {
	return {
		id,
		type: "web-request",
		position: { x: 0, y: 0 },
		method: "GET",
		url: "https://api.example.com/items",
		...extra,
	};
}

function command(id: string, text = "true"): CommandNode {
	return {
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: text,
		stdout: "text",
	};
}

function flowOf(nodes: Flow["nodes"], edges: Flow["edges"] = []): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [{ name: "topic", type: "text" }],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
	};
}

const errorsOf = (flow: Flow) =>
	validateFlow(flow)
		.filter((issue) => issue.severity === "error")
		.map((issue) => issue.message);

describe("the Web request node schema", () => {
	test("parses with GET by default, and ends pass or fail with status, headers and body", () => {
		const parsed = flowSchema.parse({
			version: FLOW_VERSION,
			start: "fetch",
			nodes: [
				{
					id: "fetch",
					type: "web-request",
					position: { x: 0, y: 0 },
					url: "https://api.example.com/items",
				},
			],
			edges: [],
		});
		expect(parsed.nodes[0]).toEqual(request("fetch"));
	});

	test("refuses a size limit over 10 MB and a header name HTTP does not allow", () => {
		const ok = (node: Record<string, unknown>) =>
			flowSchema.safeParse({
				version: FLOW_VERSION,
				start: "fetch",
				nodes: [{ ...request("fetch"), ...node }],
				edges: [],
			}).success;
		expect(ok({ maxBytes: 10 * 1024 * 1024 })).toBe(true);
		expect(ok({ maxBytes: 10 * 1024 * 1024 + 1 })).toBe(false);
		expect(ok({ headers: { "Bad Name": "x" } })).toBe(false);
		expect(ok({ method: "TRACE" })).toBe(false);
	});
});

describe("validateFlow: Web request", () => {
	test("a request with templates and secrets in its own text has no errors", () => {
		const flow = flowOf(
			[
				request("fetch", {
					method: "POST",
					query: { q: "{{topic}}" },
					// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
					headers: { Authorization: "Bearer ${API_TOKEN}" },
					body: { kind: "json", value: '{"q": "{{topic}}", "n": 3}' },
				}),
				command("report", 'echo "{{fetch.status}} {{fetch.body.items}}"'),
			],
			[{ id: "e1", from: "fetch", outcome: "pass", to: "report" }],
		);
		expect(errorsOf(flow)).toEqual([]);
	});

	test("needs one place to go: a URL or a secret that holds one", () => {
		expect(errorsOf(flowOf([request("fetch", { url: "" })]))).toEqual([
			'Web request node "fetch" needs a URL, or a secret that holds one.',
		]);
		expect(
			errorsOf(flowOf([request("fetch", { urlSecret: "HOOK_URL" })])),
		).toEqual([
			'Web request node "fetch" has a URL and a secret that holds one. Keep one of them.',
		]);
		expect(
			errorsOf(
				flowOf([request("fetch", { url: undefined, urlSecret: "hook url" })]),
			),
		).toEqual([
			'Web request node "fetch": "hook url" is not the name of a secret. Use letters, digits and _, for example SLACK_WEBHOOK_URL.',
		]);
		expect(
			errorsOf(
				flowOf([
					request("fetch", { url: undefined, urlSecret: "{{topic}}_URL" }),
				]),
			),
		).toEqual([]);
	});

	test("a URL must be http:// or https://", () => {
		expect(errorsOf(flowOf([request("fetch", { url: "ftp://x" })]))).toEqual([
			'Web request node "fetch": the URL must start with http:// or https://, for example https://api.example.com/items.',
		]);
		expect(errorsOf(flowOf([request("fetch", { url: "{{topic}}" })]))).toEqual(
			[],
		);
	});

	test("a GET sends no body, and a JSON body must be valid JSON", () => {
		expect(
			errorsOf(
				flowOf([request("fetch", { body: { kind: "text", value: "hi" } })]),
			),
		).toEqual([
			'Web request node "fetch" sends a body with GET. Use POST, PUT or PATCH, or remove the body.',
		]);
		expect(
			errorsOf(
				flowOf([
					request("fetch", {
						method: "POST",
						body: { kind: "json", value: '{"n": {{topic}}}' },
					}),
				]),
			),
		).toEqual([
			'Web request node "fetch": the JSON body is not valid. Check its format, and put each template in quotes: "{{plan.data.tasks}}".',
		]);
		expect(
			errorsOf(
				flowOf([
					request("fetch", {
						method: "POST",
						body: { kind: "json", value: "{{topic}}" },
					}),
				]),
			),
		).toEqual([]);
	});

	test("a template in a header that reads an unknown name is an error", () => {
		expect(
			errorsOf(flowOf([request("fetch", { headers: { "X-A": "{{ghost}}" } })])),
		).toEqual([
			'The header "X-A" of "fetch" uses {{ghost}}, but there is no node or input "ghost".',
		]);
	});
});

describe("validateFlow: a Wait for a URL", () => {
	const wait = (fields: Partial<WaitNode> = {}): WaitNode => ({
		id: "ready",
		type: "wait",
		position: { x: 0, y: 0 },
		until: {
			kind: "url",
			url: "https://status.example.com/{{topic}}",
			everyMinutes: 5,
		},
		...fields,
	});

	test("its outcomes take rules over data, and a rule that reads another name is an error", () => {
		expect(
			errorsOf(
				flowOf(
					[
						wait({
							outcomes: [{ name: "finished", when: 'data.state = "done"' }],
						}),
						command("done"),
					],
					[{ id: "e1", from: "ready", outcome: "finished", to: "done" }],
				),
			),
		).toEqual([]);
		expect(
			errorsOf(
				flowOf(
					[
						wait({
							outcomes: [{ name: "finished", when: 'event.state = "done"' }],
						}),
						command("done"),
					],
					[{ id: "e1", from: "ready", outcome: "finished", to: "done" }],
				),
			),
		).toEqual([
			'The rule of "finished" of "ready" reads "event", but it can only read the value as data: $count(data.tasks) > 0.',
		]);
	});

	test("its timeout must be longer than how often it asks", () => {
		expect(errorsOf(flowOf([wait({ timeoutMinutes: 5 })]))).toEqual([
			'Wait node "ready" asks its URL every 5 min but times out after 5 min. Give it a longer timeout than the interval.',
		]);
	});
});

describe("secretParts", () => {
	test("splits each secret reference from the text around it, in order", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: secret references, as a person writes them.
		expect(secretParts("Bearer ${TOKEN} and ${ID}!")).toEqual([
			{ text: "Bearer " },
			{ secret: "TOKEN" },
			{ text: " and " },
			{ secret: "ID" },
			{ text: "!" },
		]);
		expect(secretParts("")).toEqual([{ text: "" }]);
		// Not a secret name: it stays text.
		// biome-ignore lint/suspicious/noTemplateCurlyInString: text that only looks like a reference.
		expect(secretParts("${1A} ${{x}}")).toEqual([{ text: "${1A} ${{x}}" }]);
	});
});
