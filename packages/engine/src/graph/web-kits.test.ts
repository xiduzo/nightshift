import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { type Flow, type JsonValue, kitFlow } from "@nightshift/flows";
import { drive, flowOf, payloads, startRun } from "../testing/graph";
import {
	connectionsOf,
	createSandbox,
	type Sandbox,
} from "../testing/test-support";

/**
 * The kits that need no shell, run end to end as a Subflow runs them,
 * against a real local server: `kit:message/send` posts a message to the
 * webhook URL that a secret holds, and `kit:feeds/read` reads a feed and
 * gives the items that are new since the last run. Together they prove the
 * Web request, the Convert and the Since last run compose.
 */

/** What the server answers, per path; a test sets them. */
let answers: Record<string, Response[]> = {};
/** What the server got. */
let got: { method: string; path: string; type: string; body: string }[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			const path = new URL(request.url).pathname;
			got.push({
				method: request.method,
				path,
				type: request.headers.get("content-type") ?? "",
				body: await request.text(),
			});
			return (
				answers[path]?.shift() ?? new Response("not here", { status: 404 })
			);
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

function kit(name: string): Flow {
	const flow = kitFlow(name);
	if (!flow) throw new Error(`no ${name}`);
	return flow;
}

/** A flow with one Subflow node, `call`, that runs `name` with `inputs`. */
function calling(name: string, inputs: Record<string, string>): Flow {
	return flowOf([
		{ id: "call", type: "call", position: { x: 0, y: 0 }, flow: name, inputs },
	]);
}

/**
 * Runs the flow once as the saved flow `flowName`; the Subflow step's end.
 * A Subflow that ends `fail` has no edge here, so that run stops there.
 */
async function runOnce(
	flow: Flow,
	name: string,
	options: { flowName?: string; secrets?: Record<string, string> } = {},
) {
	const h = await startRun(sandbox, flow, {
		flowName: options.flowName ?? "watch",
		flows: { [name]: kit(name) },
		connections: connectionsOf({ secrets: options.secrets ?? {} }),
	});
	await drive(h, {});
	const events = await h.events();
	const ended = payloads(events, "StepEnded").find(
		(end) => end.outputs.ended !== undefined,
	);
	return { ended, events };
}

describe("kit:message/send", () => {
	let hook: string;
	let secrets: Record<string, string>;
	beforeEach(() => {
		hook = at("/hook");
		secrets = { MESSAGE_WEBHOOK_URL: hook, TEAM_CHAT_URL: hook };
	});

	test("posts the message as JSON to the URL in the secret, and never shows that URL", async () => {
		answers["/hook"] = [new Response("ok")];
		const { ended, events } = await runOnce(
			calling("kit:message/send", { message: 'Price "drop": € 5' }),
			"kit:message/send",
			{ secrets },
		);
		expect(got).toEqual([
			{
				method: "POST",
				path: "/hook",
				type: "application/json",
				body: JSON.stringify({ text: 'Price "drop": € 5' }),
			},
		]);
		expect(ended).toMatchObject({
			outcome: "pass",
			outputs: { ended: "done", end_message: "Sent the message" },
		});
		expect(JSON.stringify(events)).not.toContain(hook);
	});

	test("takes another field, another secret, or plain text", async () => {
		answers["/hook"] = [new Response(null, { status: 204 })];
		await runOnce(
			calling("kit:message/send", {
				message: "Hi",
				field: "content",
				webhook: "TEAM_CHAT_URL",
			}),
			"kit:message/send",
			{ secrets },
		);
		answers["/hook"] = [new Response("ok")];
		await runOnce(
			calling("kit:message/send", { message: "Hi", format: "plain" }),
			"kit:message/send",
			{ secrets },
		);
		expect(got.map(({ type, body }) => ({ type, body }))).toEqual([
			{ type: "application/json", body: '{"content":"Hi"}' },
			{ type: "text/plain; charset=utf-8", body: "Hi" },
		]);
	});

	test("ends failed when the webhook refuses the message", async () => {
		answers["/hook"] = [new Response("no such hook", { status: 404 })];
		const { ended } = await runOnce(
			calling("kit:message/send", { message: "Hi" }),
			"kit:message/send",
			{ secrets },
		);
		expect(ended).toMatchObject({
			outcome: "fail",
			outputs: {
				ended: "failed",
				end_message: "Could not send the message",
			},
		});
	});
});

describe("kit:feeds/read", () => {
	/** An RSS feed with these items, by id and title. */
	const rss = (...items: [string, string][]) =>
		new Response(
			`<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><link>https://example.com</link><description>All of it</description>${items
				.map(
					([id, title]) =>
						`<item><guid>${id}</guid><title>${title}</title><link>https://example.com/${id}</link></item>`,
				)
				.join("")}</channel></rss>`,
			{ headers: { "content-type": "application/rss+xml" } },
		);

	const titles = (items: JsonValue | undefined) =>
		(items as { title: string }[]).map((item) => item.title);

	test("the first run only remembers; a later run gives what is new", async () => {
		const flow = calling("kit:feeds/read", { url: at("/feed.xml") });
		answers["/feed.xml"] = [rss(["1", "One"], ["2", "Two"])];
		const first = await runOnce(flow, "kit:feeds/read");
		expect(first.ended).toMatchObject({
			outcome: "pass",
			outputs: { ended: "nothing-to-do", items: [], title: "News" },
		});

		answers["/feed.xml"] = [rss(["3", "Three"], ["1", "One"], ["2", "Two"])];
		const second = await runOnce(flow, "kit:feeds/read");
		expect(second.ended).toMatchObject({
			outcome: "pass",
			outputs: { ended: "done", end_message: "The feed has new items" },
		});
		expect(titles(second.ended?.outputs.items)).toEqual(["Three"]);
		expect(second.ended?.outputs.items).toEqual([
			expect.objectContaining({
				id: "3",
				title: "Three",
				link: "https://example.com/3",
			}),
		]);

		answers["/feed.xml"] = [rss(["3", "Three"], ["1", "One"])];
		const third = await runOnce(flow, "kit:feeds/read");
		expect(third.ended).toMatchObject({
			outputs: { ended: "nothing-to-do", items: [] },
		});
	});

	test("first_run new gives every item on the first run", async () => {
		answers["/feed.xml"] = [rss(["1", "One"], ["2", "Two"])];
		const { ended } = await runOnce(
			calling("kit:feeds/read", { url: at("/feed.xml"), first_run: "new" }),
			"kit:feeds/read",
		);
		expect(ended).toMatchObject({ outputs: { ended: "done" } });
		expect(titles(ended?.outputs.items)).toEqual(["One", "Two"]);
	});

	test("each feed has its own memory", async () => {
		const both = flowOf(
			[
				{
					id: "call",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "kit:feeds/read",
					inputs: { url: "{{url}}", first_run: "new" },
				},
			],
			[],
			{ inputs: [{ name: "url", type: "text" }] },
		);
		const run = async (path: string) => {
			const h = await startRun(sandbox, both, {
				flowName: "watch",
				flows: { "kit:feeds/read": kit("kit:feeds/read") },
				inputs: { url: at(path) },
			});
			await drive(h, { inputs: { url: at(path) } });
			return payloads(await h.events(), "StepEnded").find(
				(end) => end.outputs.ended !== undefined,
			);
		};
		answers["/a.xml"] = [rss(["1", "One"])];
		answers["/b.xml"] = [rss(["1", "One"])];
		expect(titles((await run("/a.xml"))?.outputs.items)).toEqual(["One"]);
		expect(titles((await run("/b.xml"))?.outputs.items)).toEqual(["One"]);
	});

	test("ends failed on an answer that is not a feed, or no answer at all", async () => {
		answers["/feed.xml"] = [new Response("<html>hello</html>")];
		const page = await runOnce(
			calling("kit:feeds/read", { url: at("/feed.xml") }),
			"kit:feeds/read",
		);
		expect(page.ended).toMatchObject({
			outcome: "fail",
			outputs: { ended: "failed" },
		});
		expect(page.ended?.outputs.end_message).toStartWith(
			`${at("/feed.xml")} is not a feed: `,
		);

		const gone = await runOnce(
			calling("kit:feeds/read", { url: at("/gone.xml") }),
			"kit:feeds/read",
		);
		expect(gone.ended).toMatchObject({
			outcome: "fail",
			outputs: {
				ended: "failed",
				end_message: `Could not read the feed ${at("/gone.xml")}`,
			},
		});
	});
});
