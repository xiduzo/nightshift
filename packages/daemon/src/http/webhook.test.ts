import { describe, expect, test } from "bun:test";
import type { Engine, WebhookAnswer } from "@nightshift/engine";

import { webhookResponse } from "./webhook";

/** An engine that answers `answer` and records what it was handed. */
function fakeEngine(answer: WebhookAnswer) {
	const seen: Parameters<Engine["webhook"]>[0][] = [];
	const engine: Pick<Engine, "webhook"> = {
		async webhook(request) {
			seen.push(request);
			return { answer, done: Promise.resolve() };
		},
	};
	return { engine, seen };
}

const ids = { projectId: "p1", scheduleId: "review" };

const post = (
	body: string | ReadableStream<Uint8Array>,
	headers: Record<string, string> = {},
) =>
	new Request("http://localhost/hooks/p1/review", {
		method: "POST",
		body,
		headers,
	});

describe("webhookResponse", () => {
	test("hands the raw body and the headers over, and answers 202", async () => {
		const { engine, seen } = fakeEngine({ kind: "accepted" });
		const response = await webhookResponse(
			engine,
			post('{"a":1}', { "x-github-event": "push" }),
			ids,
		);
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ result: "accepted" });
		expect(seen[0]?.projectId).toBe("p1");
		expect(seen[0]?.scheduleId).toBe("review");
		expect(new TextDecoder().decode(seen[0]?.body)).toBe('{"a":1}');
		expect(seen[0]?.headers.get("x-github-event")).toBe("push");
	});

	test("one answer for an unknown schedule and a wrong secret; a reason once it checked out", async () => {
		const notFound = await webhookResponse(
			fakeEngine({ kind: "not-found" }).engine,
			post("{}"),
			ids,
		);
		expect(notFound.status).toBe(404);
		expect(await notFound.json()).toEqual({ message: "Not found." });

		const filtered = await webhookResponse(
			fakeEngine({ kind: "filtered" }).engine,
			post("{}"),
			ids,
		);
		expect(filtered.status).toBe(202);
		expect(await filtered.json()).toEqual({ result: "filtered" });

		const refused = await webhookResponse(
			fakeEngine({ kind: "refused", reason: "The schedule is paused." }).engine,
			post("{}"),
			ids,
		);
		expect(refused.status).toBe(409);
		expect(await refused.json()).toEqual({
			message: "The schedule is paused.",
		});
	});

	test("refuses a body over the cap before the engine sees it", async () => {
		const { engine, seen } = fakeEngine({ kind: "accepted" });
		const big = await webhookResponse(engine, post("x".repeat(65)), ids, 64);
		expect(big.status).toBe(413);
		// A body that does not say its length is counted as it comes.
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (let i = 0; i < 4; i++)
					controller.enqueue(new TextEncoder().encode("x".repeat(20)));
				controller.close();
			},
		});
		const streamed = await webhookResponse(engine, post(stream), ids, 64);
		expect(streamed.status).toBe(413);
		expect(seen).toEqual([]);

		const fits = await webhookResponse(engine, post("x".repeat(64)), ids, 64);
		expect(fits.status).toBe(202);
	});
});
