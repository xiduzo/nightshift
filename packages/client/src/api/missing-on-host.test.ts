import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";

import { createApiClient } from "./client";
import { isMissingOnHost } from "./refusals";

/** The error a client gets when the Host answers each call with `respond`. */
async function errorOf(
	respond: (request: Request) => Response | Promise<Response>,
): Promise<unknown> {
	const client = createApiClient({
		baseUrl: "http://localhost:3000",
		fetch: async (request: Request) => respond(request),
	});
	try {
		await client.knowledge.learnings({});
	} catch (error) {
		return error;
	}
	throw new Error("The call did not fail.");
}

describe("a Host of an older version", () => {
	test("answers a procedure it does not have with a plain 404", async () => {
		// Hono's own answer when no route matches.
		const error = await errorOf(
			() =>
				new Response("404 Not Found", {
					status: 404,
					headers: { "content-type": "text/plain; charset=UTF-8" },
				}),
		);
		expect(isMissingOnHost(error)).toBe(true);
	});

	test("answers a stream it does not have with a plain 404 too", async () => {
		const client = createApiClient({
			baseUrl: "http://localhost:3000",
			fetch: async () =>
				new Response("404 Not Found", {
					status: 404,
					headers: { "content-type": "text/plain; charset=UTF-8" },
				}),
		});
		const error = await client.assistant
			.explain({ runId: "r1" })
			.catch((error: unknown) => error);
		expect(isMissingOnHost(error)).toBe(true);
	});

	test("answers it in a batch with a 404 for that call", async () => {
		let batched = false;
		const client = createApiClient({
			baseUrl: "http://localhost:3000",
			fetch: async (request: Request) => {
				// The first answer says the Host reads batches.
				if (!new URL(request.url).pathname.endsWith("/__batch__")) {
					return new Response(JSON.stringify({ json: [] }), {
						headers: {
							"content-type": "application/json",
							"x-nightshift-reads": "batch",
						},
					});
				}
				batched = true;
				const calls = (await request.clone().json()) as unknown[];
				const replies = calls.map((_, index) => ({
					index,
					status: 404,
					headers: {},
					body: "No procedure matched",
				}));
				return new Response(JSON.stringify(replies), {
					status: 207,
					headers: { "content-type": "application/json" },
				});
			},
		});
		await client.projects.list();
		const error = await Promise.all([
			client.knowledge.learnings({}),
			client.knowledge.learnings({ projectId: "p1" }),
		]).catch((error: unknown) => error);
		expect(batched).toBe(true);
		expect(isMissingOnHost(error)).toBe(true);
	});
});

describe("a procedure that refuses with NOT_FOUND itself", () => {
	test("is not a missing procedure", async () => {
		const error = await errorOf(
			() =>
				new Response(
					JSON.stringify({
						json: {
							defined: false,
							code: "NOT_FOUND",
							status: 404,
							message: "This learning no longer waits.",
						},
					}),
					{ status: 404, headers: { "content-type": "application/json" } },
				),
		);
		expect(error).toBeInstanceOf(ORPCError);
		expect(isMissingOnHost(error)).toBe(false);
	});

	test("nor is another error", () => {
		expect(isMissingOnHost(new Error("Failed to fetch"))).toBe(false);
		expect(isMissingOnHost(new ORPCError("FORBIDDEN"))).toBe(false);
		expect(isMissingOnHost(null)).toBe(false);
	});
});
