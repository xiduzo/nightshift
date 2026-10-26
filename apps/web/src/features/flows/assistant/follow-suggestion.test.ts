import { describe, expect, test } from "bun:test";
import {
	flowSchema,
	type SuggestionEvent,
	type SuggestionRequest,
} from "@nightshift/flows";
import {
	followSuggestion,
	NO_SUGGESTION,
	type SuggestClient,
} from "./follow-suggestion";

const request: SuggestionRequest = {
	projectId: "p",
	flowName: "f",
	flow: flowSchema.parse({
		version: 6,
		start: "a",
		nodes: [
			{
				id: "a",
				type: "agent",
				position: { x: 0, y: 0 },
				profile: "w",
				prompt: "",
			},
		],
		edges: [],
	}),
	nodeId: "a",
	kind: "prompt",
	instruction: "",
};

function fake(events: SuggestionEvent[] | Error): SuggestClient {
	return {
		assistant: {
			suggest: async () => {
				if (events instanceof Error) throw events;
				return (async function* () {
					yield* events;
				})();
			},
		},
	};
}

const follow = (client: SuggestClient, lines: string[] = []) =>
	followSuggestion({
		client,
		request,
		signal: new AbortController().signal,
		onActivity: (text) => lines.push(text),
	});

describe("followSuggestion", () => {
	test("passes on activity and gives the suggestion", async () => {
		const lines: string[] = [];
		const result = await follow(
			fake([
				{ type: "activity", text: "Reads the flow" },
				{
					type: "suggestion",
					suggestion: { kind: "prompt", text: "Do it.", note: "" },
				},
				{ type: "done" },
			]),
			lines,
		);
		expect(lines).toEqual(["Reads the flow"]);
		expect(result).toEqual({
			ok: true,
			suggestion: { kind: "prompt", text: "Do it.", note: "" },
		});
	});

	test("an error event gives its words", async () => {
		expect(
			await follow(fake([{ type: "error", message: "Add a profile first." }])),
		).toEqual({ ok: false, message: "Add a profile first." });
	});

	test("a stream without a suggestion is an error", async () => {
		expect(await follow(fake([{ type: "done" }]))).toEqual({
			ok: false,
			message: NO_SUGGESTION,
		});
	});

	test("a refused call gives its words", async () => {
		expect(await follow(fake(new Error("Not allowed.")))).toEqual({
			ok: false,
			message: "Not allowed.",
		});
	});
});
