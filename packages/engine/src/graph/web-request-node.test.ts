import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { Command } from "@langchain/langgraph";
import type { WaitNode, WebRequestNode } from "@nightshift/flows";
import { utc } from "@nightshift/time/testing";
import { foldRun } from "../log";
import { readTranscriptFile } from "../log/transcripts";
import { deriveSteps } from "../read/run-views";
import {
	command,
	drive,
	edge,
	flowOf,
	payloads,
	startRun,
} from "../testing/graph";
import {
	connectionsOf,
	createSandbox,
	type Sandbox,
} from "../testing/test-support";
import { jsonBody, retryAfterOf } from "./nodes/web-request";

/**
 * The Web request node and the Wait for a URL on the compiled graph,
 * against a real local server: the answer as outputs, a 404 as `fail`, a
 * 429 that waits until its Retry-After and asks again, the secrets that
 * only the node's own text fills, and a Wait that asks a URL until it
 * answers.
 */

/** What the server answers, per path; a test sets them. */
let answers: Record<string, Response[]> = {};
/** What the server got, per path. */
let got: { path: string; headers: Headers; body: string }[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			const path = new URL(request.url).pathname;
			got.push({ path, headers: request.headers, body: await request.text() });
			const queue = answers[path];
			return queue?.shift() ?? new Response("not here", { status: 404 });
		},
	});
});
afterAll(() => {
	server.stop(true);
});

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
	answers = {};
	got = [];
});
afterEach(async () => {
	await sandbox.cleanup();
});

const at = (path: string) => `http://127.0.0.1:${server.port}${path}`;

const request = (
	id: string,
	fields: Partial<WebRequestNode> = {},
): WebRequestNode => ({
	id,
	type: "web-request",
	position: { x: 0, y: 0 },
	method: "GET",
	url: at("/items"),
	...fields,
});

describe("the Web request node", () => {
	test("passes on 2xx with the status, headers and JSON body as outputs", async () => {
		answers["/items"] = [Response.json({ items: ["a", "b"] })];
		const h = await startRun(
			sandbox,
			flowOf(
				[
					request("fetch", { query: { q: "{{topic}}" } }),
					command("done", "true"),
				],
				[edge("e1", "fetch", "pass", "done")],
				{ inputs: [{ name: "topic" }] },
			),
			{ inputs: { topic: "rain & sun" } },
		);
		const { parked, state } = await drive(h, {
			inputs: { topic: "rain & sun" },
		});
		expect(parked).toEqual([]);
		expect(state.ended).toMatchObject({ status: "finished", nodeId: "done" });
		const logged = await h.events();
		expect(payloads(logged, "StepStarted")[0]).toMatchObject({
			nodeId: "fetch",
			nodeType: "web-request",
		});
		expect(payloads(logged, "StepEnded")[0]).toMatchObject({
			outcome: "pass",
			outputs: {
				outcome: "pass",
				status: 200,
				headers: { "content-type": expect.stringContaining("json") },
				body: { items: ["a", "b"] },
			},
			error: null,
		});
		const [step] = deriveSteps(foldRun(logged));
		const transcript = await readTranscriptFile(step?.transcriptPath as string);
		expect(transcript.map((entry) => entry.event)).toEqual([
			{
				type: "web-request",
				method: "GET",
				url: `${at("/items")}?q=rain%20%26%20sun`,
			},
			{ type: "web-response", status: 200, text: "OK", bytes: 19 },
		]);
	});

	test("fails on a 404, with the answer kept", async () => {
		const h = await startRun(
			sandbox,
			flowOf([request("fetch", { url: at("/gone") })]),
		);
		await drive(h, {});
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "fail",
			outputs: { status: 404, body: "not here" },
			error: "The server answered 404 Not Found.",
		});
	});

	test("a body that does not match a confirmed shape errors the step, an inferred one warns", async () => {
		const output = {
			type: "object",
			properties: { items: { type: "array" } },
		};
		answers["/items"] = [Response.json({ items: "none" })];
		const confirmed = await startRun(
			sandbox,
			flowOf([request("fetch", { output })]),
		);
		await drive(confirmed, {});
		expect(payloads(await confirmed.events(), "StepEnded")[0]).toMatchObject({
			outcome: "error",
			error:
				"The body of the answer does not match the output schema: data/items must be array.",
		});

		answers["/items"] = [Response.json({ items: "none" })];
		const inferred = await startRun(
			sandbox,
			flowOf([request("fetch", { output, outputInferred: true })]),
		);
		await drive(inferred, {});
		const logged = await inferred.events();
		expect(payloads(logged, "StepEnded")[0]).toMatchObject({
			outcome: "pass",
		});
		expect(payloads(logged, "RunWarned")).toEqual([
			{
				kind: "shape",
				message:
					"The body of the answer does not match the output schema: data/items must be array. Night Shift took this shape from an earlier run. Confirm it or change it in the editor.",
			},
		]);
	});

	test("a flow's step without a shape ends with the shape of its body", async () => {
		answers["/items"] = [Response.json({ items: ["a"] })];
		const h = await startRun(sandbox, flowOf([request("fetch")]), {
			flowName: "news",
		});
		await drive(h, {});
		expect(payloads(await h.events(), "StepEnded")[0]?.shapes).toEqual({
			body: {
				type: "object",
				properties: { items: { type: "array", items: { type: "string" } } },
			},
		});
	});

	test("waits out a 429 until its Retry-After, then asks again", async () => {
		answers["/items"] = [
			new Response("slow down", {
				status: 429,
				headers: { "retry-after": "120" },
			}),
			Response.json({ ok: true }),
		];
		const h = await startRun(
			sandbox,
			flowOf(
				[request("fetch"), command("done", "true")],
				[edge("e1", "fetch", "pass", "done")],
			),
		);
		const first = await drive(h, {});
		const [step] = deriveSteps(foldRun(await h.events()));
		expect(first.parked).toEqual([
			{
				kind: "wait",
				stepId: step?.id as string,
				nodeId: "fetch",
				reason: "usage-limit",
				until: expect.any(Number),
				message:
					"Usage limit: the server answered 429 Too Many Requests. The step continues a minute after the reset.",
			},
		]);
		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId: step?.id as string,
			payload: { early: false },
		});
		const second = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.nodeId).toBe("done");
		const ended = payloads(await h.events(), "StepEnded");
		expect(ended[0]).toMatchObject({
			outcome: "pass",
			outputs: { status: 200, body: { ok: true } },
		});
		expect(got.map((g) => g.path)).toEqual(["/items", "/items"]);
	});

	test("a server error waits as the network does", async () => {
		answers["/items"] = [new Response("down", { status: 503 })];
		const h = await startRun(sandbox, flowOf([request("fetch")]));
		const first = await drive(h, {});
		expect(first.parked[0]).toMatchObject({
			kind: "wait",
			reason: "network",
			message:
				"Network: the server answered 503 Service Unavailable. The step continues in 1 min.",
		});
	});

	test("fills a secret of its own text, never one a template renders, and masks it in the answer", async () => {
		answers["/items"] = [
			new Response("you sent tok-123", {
				headers: { "x-echo": "Bearer tok-123" },
			}),
		];
		const h = await startRun(
			sandbox,
			flowOf(
				[
					request("fetch", {
						method: "POST",
						// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
						headers: { Authorization: "Bearer ${API_TOKEN}" },
						body: {
							kind: "json",
							// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
							value: '{"token": "${API_TOKEN}", "note": "{{note}}"}',
						},
					}),
				],
				[],
				{ inputs: [{ name: "note" }] },
			),
			{
				// biome-ignore lint/suspicious/noTemplateCurlyInString: a value that names a secret, as a webhook could send it.
				inputs: { note: "${API_TOKEN}" },
				connections: connectionsOf({ secrets: { API_TOKEN: "tok-123" } }),
			},
		);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a value that names a secret, as a webhook could send it.
		await drive(h, { inputs: { note: "${API_TOKEN}" } });
		expect(got[0]?.headers.get("authorization")).toBe("Bearer tok-123");
		expect(JSON.parse(got[0]?.body ?? "")).toEqual({
			token: "tok-123",
			// The rendered value stays as it was: it is never filled.
			// biome-ignore lint/suspicious/noTemplateCurlyInString: the text the server got.
			note: "${API_TOKEN}",
		});
		const ended = payloads(await h.events(), "StepEnded")[0];
		expect(ended?.outputs).toMatchObject({
			body: "you sent •••",
			headers: { "x-echo": "Bearer •••" },
		});
		expect(JSON.stringify(await h.events())).not.toContain("tok-123");
	});

	test("ends error without the secret it names", async () => {
		const h = await startRun(
			sandbox,
			flowOf([
				request("fetch", {
					// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
					headers: { Authorization: "Bearer ${MISSING_TOKEN}" },
				}),
			]),
			{ connections: connectionsOf({ secrets: {} }) },
		);
		await drive(h, {});
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "error",
			error:
				"The request needs the secret MISSING_TOKEN, but it is not saved. Save it on the Secrets page, or remove it from the node.",
		});
		expect(got).toEqual([]);
	});
});

describe("a Wait for a URL", () => {
	const wait = (fields: Partial<WaitNode> = {}): WaitNode => ({
		id: "ready",
		type: "wait",
		position: { x: 0, y: 0 },
		until: { kind: "url", url: at("/status"), everyMinutes: 5 },
		...fields,
	});

	test("asks again until it answers, then ends on the outcome its rule picks", async () => {
		answers["/status"] = [
			new Response("busy", { status: 404 }),
			Response.json({ state: "running" }),
			Response.json({ state: "done", url: "https://example.com/r" }),
		];
		const h = await startRun(
			sandbox,
			flowOf(
				[
					wait({
						outcomes: [{ name: "finished", when: 'data.state = "done"' }],
					}),
					command("done", "true"),
				],
				[edge("e1", "ready", "finished", "done")],
			),
		);
		const first = await drive(h, {});
		expect(first.parked[0]).toMatchObject({
			kind: "wait",
			reason: "url",
			message: "The URL answered 404 Not Found. Asks again in 5 min.",
		});
		const stepId = deriveSteps(foldRun(await h.events()))[0]?.id as string;
		const wake = async () => {
			await h.log.append({
				type: "WaitEnded",
				runId: h.runId,
				stepId,
				payload: { early: false },
			});
			return drive(
				h,
				new Command({ resume: { kind: "wake", early: false } }),
				h.graph(),
			);
		};
		const second = await wake();
		expect(second.parked[0]).toMatchObject({
			kind: "wait",
			reason: "url",
			message: "The answer matched no rule. Asks again in 5 min.",
		});
		const third = await wake();
		expect(third.parked).toEqual([]);
		expect(third.state.ended?.nodeId).toBe("done");
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "finished",
			outputs: { data: { state: "done", url: "https://example.com/r" } },
		});
	});
});

describe("the parts of a request", () => {
	test("a JSON body keeps one reference as its value and escapes a secret inside a string", () => {
		const tctx = {
			run: {},
			inputs: { title: 'say "hi"' },
			nodes: { plan: { data: { tasks: ["a", "b"] } } },
		} as never;
		expect(
			jsonBody(
				// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
				'{"tasks": "{{plan.data.tasks}}", "text": "{{title}}", "auth": "key ${KEY}"}',
				tctx,
			),
		).toEqual([
			{ text: '{"tasks":["a","b"],"text":"say \\"hi\\"","auth":"key ' },
			{ secret: "KEY", escape: "json" },
			{ text: '"}' },
		]);
		expect(jsonBody("{{plan.data}}", tctx)).toEqual([
			{ text: '{"tasks":["a","b"]}' },
		]);
	});

	test("Retry-After reads seconds and a date", () => {
		expect(retryAfterOf("30", 1_000)).toBe(31_000);
		expect(retryAfterOf("Wed, 21 Oct 2015 07:28:00 GMT", 0)).toBe(
			utc(2015, 9, 21, 7, 28),
		);
		expect(retryAfterOf("soon", 0)).toBeNull();
		expect(retryAfterOf(undefined, 0)).toBeNull();
	});
});
