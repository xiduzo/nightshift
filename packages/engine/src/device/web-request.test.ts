import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type OutgoingRequest, sendRequest } from "./web-request";

/**
 * The core of a web request against two real local servers: the answer as
 * JSON or text, the redirects it follows (and what it drops on the way to
 * another server), the addresses it refuses, the size cap and the time
 * limit. The servers are on this computer, so the rules allow loopback
 * unless a test asks as a Host.
 */

let main: ReturnType<typeof Bun.serve>;
let other: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	other = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request) {
			return Response.json({
				authorization: request.headers.get("authorization"),
				token: request.headers.get("x-token"),
				plain: request.headers.get("x-plain"),
			});
		},
	});
	main = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			const url = new URL(request.url);
			switch (url.pathname) {
				case "/json":
					return Response.json({ items: [1, 2], q: url.searchParams.get("q") });
				case "/text":
					return new Response("hello", {
						headers: { "content-type": "text/plain" },
					});
				case "/echo":
					return Response.json({
						method: request.method,
						type: request.headers.get("content-type"),
						body: await request.text(),
					});
				case "/moved":
					return Response.redirect("/json?q=moved", 302);
				case "/see-other":
					return Response.redirect("/echo", 303);
				case "/away":
					return Response.redirect(`http://127.0.0.1:${other.port}/`, 307);
				case "/loop":
					return Response.redirect("/loop", 302);
				case "/metadata":
					return Response.redirect("http://169.254.169.254/latest", 302);
				case "/big":
					return new Response("x".repeat(64 * 1024));
				case "/slow":
					await Bun.sleep(2_000);
					return new Response("late");
				default:
					return new Response("not here", {
						status: 404,
						statusText: "Not Found",
					});
			}
		},
	});
});

afterAll(() => {
	main.stop(true);
	other.stop(true);
});

const laptop = { privateNetwork: true };

function request(
	path: string,
	extra: Partial<OutgoingRequest> = {},
): OutgoingRequest {
	return {
		method: "GET",
		url: `http://127.0.0.1:${main.port}${path}`,
		headers: [],
		timeoutMs: 5_000,
		maxBytes: 1024 * 1024,
		showHost: true,
		signal: new AbortController().signal,
		...extra,
	};
}

describe("sendRequest", () => {
	test("reads a JSON answer as JSON, with its status and headers", async () => {
		const result = await sendRequest(request("/json?q=news"), laptop);
		expect(result).toMatchObject({
			kind: "answered",
			response: {
				status: 200,
				body: { items: [1, 2], q: "news" },
				headers: { "content-type": expect.stringContaining("json") },
			},
		});
	});

	test("reads any other answer as text, and a 404 is an answer", async () => {
		expect(await sendRequest(request("/text"), laptop)).toMatchObject({
			kind: "answered",
			response: { status: 200, body: "hello", bytes: 5 },
		});
		expect(await sendRequest(request("/nothing"), laptop)).toMatchObject({
			kind: "answered",
			response: { status: 404, statusText: "Not Found", body: "not here" },
		});
	});

	test("sends a body with its content type", async () => {
		const result = await sendRequest(
			request("/echo", {
				method: "POST",
				body: { contentType: "application/json", text: '{"a":1}' },
			}),
			laptop,
		);
		expect(result).toMatchObject({
			kind: "answered",
			response: {
				body: { method: "POST", type: "application/json", body: '{"a":1}' },
			},
		});
	});

	test("follows a redirect, and a 303 asks again with GET and no body", async () => {
		expect(await sendRequest(request("/moved"), laptop)).toMatchObject({
			kind: "answered",
			response: { status: 200, body: { q: "moved" } },
		});
		expect(
			await sendRequest(
				request("/see-other", {
					method: "POST",
					body: { contentType: "text/plain", text: "hi" },
				}),
				laptop,
			),
		).toMatchObject({
			kind: "answered",
			response: { body: { method: "GET", body: "" } },
		});
	});

	test("never takes a secret header or credentials to another server", async () => {
		const result = await sendRequest(
			request("/away", {
				headers: [
					{ name: "Authorization", value: "Bearer open", secret: false },
					{ name: "X-Token", value: "s3cret", secret: true },
					{ name: "X-Plain", value: "kept", secret: false },
				],
			}),
			laptop,
		);
		expect(result).toMatchObject({
			kind: "answered",
			response: {
				body: { authorization: null, token: null, plain: "kept" },
			},
		});
	});

	test("stops after five redirects", async () => {
		expect(await sendRequest(request("/loop"), laptop)).toEqual({
			kind: "failed",
			message: `127.0.0.1:${main.port} redirected more than 5 times.`,
			network: false,
		});
	});

	test("checks the address of every redirect", async () => {
		const result = await sendRequest(request("/metadata"), laptop);
		expect(result).toMatchObject({ kind: "failed", network: false });
		expect(result.kind === "failed" && result.message).toContain(
			"Night Shift never sends web requests there",
		);
	});

	test("refuses this computer and its network on a Host, before it sends", async () => {
		const result = await sendRequest(request("/json"), {
			privateNetwork: false,
		});
		expect(result).toEqual({
			kind: "refused",
			message: `127.0.0.1:${main.port} is on this computer or its private network. A Host sends web requests there only when its Settings allow it.`,
		});
	});

	test("keeps the server of a URL from a secret out of every message", async () => {
		const result = await sendRequest(request("/json", { showHost: false }), {
			privateNetwork: false,
		});
		expect(result.kind === "refused" && result.message).not.toContain(
			"127.0.0.1",
		);
	});

	test("fails an answer larger than its cap", async () => {
		expect(
			await sendRequest(request("/big", { maxBytes: 1024 }), laptop),
		).toEqual({
			kind: "failed",
			message:
				"The answer is larger than 1 KB. Raise the size limit of the node, up to 10 MB, or ask for less.",
			network: false,
		});
	});

	test("a server that does not answer in time is a network failure", async () => {
		const result = await sendRequest(
			request("/slow", { timeoutMs: 1_000 }),
			laptop,
		);
		expect(result).toEqual({
			kind: "failed",
			message: `127.0.0.1:${main.port} did not answer within 1 s`,
			network: true,
		});
	});

	test("refuses a URL that is not valid, or a header with a line break", async () => {
		expect(
			await sendRequest(request("", { url: "not a url" }), laptop),
		).toMatchObject({ kind: "refused" });
		expect(
			await sendRequest(
				request("/json", {
					headers: [{ name: "X-A", value: "a\nb", secret: false }],
				}),
				laptop,
			),
		).toEqual({
			kind: "refused",
			message: 'The header "X-A" has a line break. Keep a header on one line.',
		});
	});
});
