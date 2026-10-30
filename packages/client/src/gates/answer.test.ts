import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";

import {
	answerGate,
	type GateAnswerClient,
	type GateRefusal,
	gateRefusalOf,
	gateRefusalText,
	unreachableAnswerText,
} from "./answer";

const answer = { runId: "run-1", stepId: "review", choice: "ship" };

/** A client whose `gates.resolve` does what `resolve` says. */
function clientOf(resolve: () => Promise<void>): GateAnswerClient {
	return { gates: { resolve } } as unknown as GateAnswerClient;
}

/** A refusal as `gates.resolve` declares it. */
function declared(code: string, status: number) {
	return new ORPCError(code, { defined: true, status });
}

describe("answerGate", () => {
	test("an answer Night Shift takes is answered", async () => {
		const sent: unknown[] = [];
		const client = {
			gates: {
				resolve: async (input: unknown) => {
					sent.push(input);
				},
			},
		} as unknown as GateAnswerClient;
		expect(await answerGate(client, answer)).toEqual({ kind: "answered" });
		expect(sent).toEqual([answer]);
	});

	test("each declared refusal is a result", async () => {
		const cases: [string, number, GateRefusal][] = [
			["GATE_CLOSED", 409, "closed"],
			["FORBIDDEN", 403, "forbidden"],
			["NEEDS_APP", 403, "needs-app"],
			["NOT_FOUND", 404, "not-found"],
		];
		for (const [code, status, refusal] of cases) {
			const client = clientOf(async () => {
				throw declared(code, status);
			});
			expect(await answerGate(client, answer)).toEqual({
				kind: "refused",
				refusal,
			});
		}
	});

	test("any other error throws: the answer was not sent", async () => {
		const runCap = new ORPCError("BAD_REQUEST", {
			message: "The run cap is reached.",
		});
		await expect(
			answerGate(
				clientOf(async () => {
					throw runCap;
				}),
				answer,
			),
		).rejects.toBe(runCap);
		const offline = new TypeError("Failed to fetch");
		await expect(
			answerGate(
				clientOf(async () => {
					throw offline;
				}),
				answer,
			),
		).rejects.toBe(offline);
	});
});

describe("gateRefusalOf", () => {
	test("a code the procedure does not declare, or does not know yet, is no refusal", () => {
		expect(gateRefusalOf(new ORPCError("GATE_CLOSED"))).toBeNull();
		expect(gateRefusalOf(declared("SOMETHING_NEW", 409))).toBeNull();
		expect(gateRefusalOf(new Error("offline"))).toBeNull();
		expect(gateRefusalOf(null)).toBeNull();
	});
});

describe("gateRefusalText", () => {
	test("each refusal has a title and a short, plain description", () => {
		const refusals: GateRefusal[] = [
			"closed",
			"forbidden",
			"needs-app",
			"not-found",
		];
		for (const refusal of refusals) {
			const { title, description } = gateRefusalText(refusal);
			expect(title.length).toBeGreaterThan(0);
			expect(description.length).toBeGreaterThan(0);
			for (const sentence of description.split(/(?<=\.) /)) {
				expect(sentence.split(" ").length).toBeLessThanOrEqual(20);
			}
			expect(`${title} ${description}`).not.toMatch(/[;]|n't/);
		}
	});
});

describe("an answer while the Host of the Space cannot be reached", () => {
	const unreachable = new ORPCError("HOST_UNREACHABLE", {
		status: 503,
		message: "The computer that keeps this Space cannot be reached.",
	});

	test("is no refusal: the answer throws, and the Gate still waits", async () => {
		expect(gateRefusalOf(unreachable)).toBeNull();
		await expect(
			answerGate(
				clientOf(async () => {
					throw unreachable;
				}),
				answer,
			),
		).rejects.toBe(unreachable);
	});

	test("has its own words; any other error has none", () => {
		const text = unreachableAnswerText(unreachable);
		expect(text?.title).toBe("Night Shift cannot reach the Host of this Space");
		expect(text?.description).not.toMatch(/[;]|n't/);
		for (const other of [
			new ORPCError("BAD_REQUEST", { message: "The run cap is reached." }),
			declared("SOMETHING_NEW", 409),
			new TypeError("Failed to fetch"),
		]) {
			expect(unreachableAnswerText(other)).toBeNull();
		}
	});
});
