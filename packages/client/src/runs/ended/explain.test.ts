import { describe, expect, test } from "bun:test";
import type { ExplanationEvent } from "@nightshift/flows";
import { MutationObserver, QueryClient } from "@tanstack/react-query";

import {
	askWhyMutation,
	type ExplainClient,
	explainRun,
	NO_EXPLANATION,
} from "./explain";

/** A client whose `assistant.explain` streams `events`, and remembers what it was asked. */
function fakeClient(events: ExplanationEvent[]) {
	const asked: string[] = [];
	const client: ExplainClient = {
		assistant: {
			explain: async ({ runId }) => {
				asked.push(runId);
				return (async function* () {
					yield* events;
				})();
			},
		},
	};
	return { client, asked };
}

describe("explainRun", () => {
	test("reads the stream to its answer and hands on what the agent does", async () => {
		const { client, asked } = fakeClient([
			{ type: "activity", text: "Reads the run" },
			{ type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
			{
				type: "answer",
				answer: "The tests failed. Try the run again.",
			},
			{ type: "done" },
		]);
		const activity: string[] = [];
		const answer = await explainRun(client, "r1", {
			onActivity: (text) => activity.push(text),
		});
		expect(answer).toBe("The tests failed. Try the run again.");
		expect(activity).toEqual(["Reads the run"]);
		expect(asked).toEqual(["r1"]);
	});

	test("an error of the stream is the error of the ask, in its own words", async () => {
		const { client } = fakeClient([
			{ type: "error", message: "No profile can answer on this computer." },
		]);
		await expect(explainRun(client, "r1")).rejects.toThrow(
			"No profile can answer on this computer.",
		);
	});

	test("a stream that ends without an answer says so", async () => {
		const { client } = fakeClient([{ type: "done" }]);
		await expect(explainRun(client, "r1")).rejects.toThrow(NO_EXPLANATION);
	});
});

describe("askWhyMutation", () => {
	test("asks once per call, keyed by the run, and does not try again on its own", async () => {
		const { client, asked } = fakeClient([{ type: "done" }]);
		const queryClient = new QueryClient();
		const observer = new MutationObserver(
			queryClient,
			askWhyMutation(client, "r1"),
		);
		await expect(observer.mutate()).rejects.toThrow(NO_EXPLANATION);
		expect(asked).toEqual(["r1"]);
		const [kept] = queryClient
			.getMutationCache()
			.findAll({ mutationKey: ["assistant", "explain", { runId: "r1" }] });
		expect(kept?.state.status).toBe("error");
	});
});
