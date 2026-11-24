import {
	type Engine,
	GateClosedError,
	NeedsApp,
	type PersonActor,
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
 *   the Gate's words for the engine's refusal that `runProcedure` says,
 *   as it says `FORBIDDEN` when the Person's role in the Space does not
 *   allow an answer.
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

/** The declared errors of the Gate the handler gives. */
type AnswerRefusals = ORPCErrorConstructorMap<typeof answerRefusals>;

/**
 * Answers the open Gate of a run in the run's own Space, as the session's
 * Person. The engine's `answerGate` finds the run, checks the Person's
 * role in its Space and applies every rule, the lock-screen rule too. This
 * says its refusals of the Gate in the Gate's declared words.
 * `runProcedure` says a run the Person may not see as the Gate's
 * `NOT_FOUND`, and a role that does not allow an answer as `FORBIDDEN`.
 */
export async function answerGate(
	gates: Pick<Engine["gates"], "answer">,
	actor: PersonActor,
	input: z.output<typeof gateAnswerSchema>,
	errors: AnswerRefusals,
): Promise<void> {
	const { via = "_OTHER", ...answer } = input;
	try {
		await gates.answer(actor, { ...answer, via });
	} catch (error) {
		if (error instanceof GateClosedError) {
			throw errors.GATE_CLOSED({ cause: error });
		}
		if (error instanceof NeedsApp) throw errors.NEEDS_APP({ cause: error });
		throw error;
	}
}
