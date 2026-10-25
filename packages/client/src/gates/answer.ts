import { ORPCError } from "@orpc/client";

import { type ApiClient, type ApiInputs, isHostUnreachable } from "../api";

/** An answer to one Gate: its run, its step and the choice. `via: "lock-screen"` for a notification button. */
export type GateAnswer = ApiInputs["gates"]["resolve"];

/**
 * Why Night Shift did not take an answer:
 * - `closed`: the Gate does not wait anymore (someone answered it, or its run ended).
 * - `forbidden`: the person's role in the Space does not allow an answer.
 * - `needs-app`: a lock-screen answer to a Gate that must be answered in the app.
 * - `not-found`: the Gate is not in one of the person's Spaces.
 */
export type GateRefusal = "closed" | "forbidden" | "needs-app" | "not-found";

/** What came of an answer. */
export type GateAnswerResult =
	| { kind: "answered" }
	| { kind: "refused"; refusal: GateRefusal };

/** The one procedure an answer needs. `createApiClient`'s client and `orpc.gates.resolve.call` fit. */
export type GateAnswerClient = {
	gates: { resolve: ApiClient["gates"]["resolve"] };
};

/** The refusal of each code `gates.resolve` declares. */
const REFUSALS = new Map<string, GateRefusal>([
	["GATE_CLOSED", "closed"],
	["FORBIDDEN", "forbidden"],
	["NEEDS_APP", "needs-app"],
	["NOT_FOUND", "not-found"],
]);

/**
 * The refusal of an error of `gates.resolve`: one of the refusals the
 * procedure declares. Null for any other error (a dropped connection, a
 * full run cap, a code this screen does not know yet).
 */
export function gateRefusalOf(error: unknown): GateRefusal | null {
	if (!(error instanceof ORPCError) || !error.defined) return null;
	return REFUSALS.get(error.code) ?? null;
}

/**
 * Whether the Gate leaves the inbox after an answer: the answer went, or
 * Night Shift says the Gate is closed or not in the person's Spaces. A
 * refusal for the person's role or for the lock screen keeps it: the Gate
 * still waits.
 */
export function leavesInbox(result: GateAnswerResult): boolean {
	return (
		result.kind === "answered" ||
		result.refusal === "closed" ||
		result.refusal === "not-found"
	);
}

/**
 * Answers a Gate. A refusal is a result, so each screen says why. A dropped
 * connection or any other error throws: the answer was not sent.
 */
export async function answerGate(
	client: GateAnswerClient,
	answer: GateAnswer,
): Promise<GateAnswerResult> {
	try {
		await client.gates.resolve(answer);
		return { kind: "answered" };
	} catch (error) {
		const refusal = gateRefusalOf(error);
		if (refusal === null) throw error;
		return { kind: "refused", refusal };
	}
}

/** What a screen says for each refusal: the same words on the web and the phone. */
export function gateRefusalText(refusal: GateRefusal): {
	title: string;
	description: string;
} {
	switch (refusal) {
		case "closed":
			return {
				title: "This Gate does not wait anymore",
				description:
					"Someone answered it, or its run ended. Night Shift did not send your answer.",
			};
		case "forbidden":
			return {
				title: "Your answer was not sent",
				description:
					"Your role in this Space does not let you answer Gates. Ask an owner or admin of the Space.",
			};
		case "needs-app":
			return {
				title: "Answer this Gate in the app",
				description: "Open the Gate to answer it.",
			};
		case "not-found":
			return {
				title: "Your answer was not sent",
				description:
					"This Gate is not in one of your Spaces. Your inbox shows the Gates that wait for you.",
			};
	}
}

/**
 * What a screen says when an answer was not sent because the Host that
 * keeps the Gate's Space cannot be reached now. It is no refusal: the
 * Gate still waits. Null for any other error, so each screen says that
 * the answer was not sent in its own words.
 */
export function unreachableAnswerText(
	error: unknown,
): { title: string; description: string } | null {
	if (!isHostUnreachable(error)) return null;
	return {
		title: "The Host of this Space cannot be reached",
		description:
			"Night Shift did not send your answer. The Gate still waits. Try again later.",
	};
}
