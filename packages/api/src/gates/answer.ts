import {
	GateClosedError,
	lockScreenRefusal,
	type SpaceEngine,
} from "@nightshift/engine";
import type { ORPCErrorConstructorMap } from "@orpc/server";
import type { z } from "zod";

import type { gateAnswerSchema } from "./schemas";

/**
 * Why Night Shift does not take an answer. Each is a declared error of
 * `gates.resolve`, so a screen reads its code, never its message:
 * - `GATE_CLOSED`: the Gate does not wait anymore. Someone answered it,
 *   its run ended, or an answer is on its way.
 * - `NEEDS_APP`: a lock-screen answer to a Gate that its author did not
 *   mark for the lock screen, or with a choice it does not have.
 * - `NOT_FOUND`: the run is not in one of the Person's Spaces. These are
 *   the Gate's words for the refusal of `runProcedure`, which also refuses
 *   as `FORBIDDEN` when the Person's role in the Space does not allow an
 *   answer.
 * Any other refusal (the run cap, a choice that is not an option) is the
 * status of its kind with its words, and a failure a 500 (`readable`).
 */
export const answerRefusals = {
	GATE_CLOSED: { status: 409, message: "This Gate does not wait anymore." },
	NEEDS_APP: {
		status: 403,
		message: "Open this Gate in Night Shift to answer it.",
	},
	NOT_FOUND: {
		status: 404,
		message: "This Gate is not in one of your Spaces.",
	},
} as const;

type AnswerRefusals = ORPCErrorConstructorMap<typeof answerRefusals>;

/**
 * Answers the open Gate of a run, through the view of the run's own Space
 * (`runProcedure` found it and checked the role there). An answer from the
 * lock screen goes only where the engine's `lockScreenRefusal` lets it.
 * The engine refuses an answer to a Gate that no longer waits, and this
 * says so as `GATE_CLOSED`.
 */
export async function answerGate(
	space: Pick<SpaceEngine, "listGates" | "resolveGate">,
	input: z.output<typeof gateAnswerSchema>,
	errors: AnswerRefusals,
): Promise<void> {
	const { via, ...answer } = input;
	if (via === "lock-screen") {
		const refusal = lockScreenRefusal(await space.listGates(), answer);
		if (refusal === "gate-closed") throw errors.GATE_CLOSED();
		if (refusal === "needs-app") throw errors.NEEDS_APP();
	}
	try {
		await space.resolveGate(answer);
	} catch (error) {
		if (error instanceof GateClosedError) {
			throw errors.GATE_CLOSED({ cause: error });
		}
		throw error;
	}
}
