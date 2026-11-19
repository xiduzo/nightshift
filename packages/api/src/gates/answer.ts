import { RoleRefusal } from "@nightshift/auth";
import { type Engine, GateClosedError, NeedsApp } from "@nightshift/engine";
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

/** The declared errors the handler gets: the Gate's, and `FORBIDDEN` of `runProcedure`. */
type AnswerRefusals = ORPCErrorConstructorMap<
	typeof answerRefusals & { FORBIDDEN: { status: number; message: string } }
>;

type Via = "web" | "phone" | "lock_screen" | "_OTHER";

/**
 * Where the answer comes from, in the words the engine keeps:
 * `lock-screen` is the older name of `lock_screen`, an unknown or absent
 * place is `_OTHER`. The answer always names one.
 */
export function viaOf(raw: z.output<typeof gateAnswerSchema>["via"]): Via {
	if (raw === "lock-screen" || raw === "lock_screen") return "lock_screen";
	return raw === "web" || raw === "phone" ? raw : "_OTHER";
}

/**
 * Answers the open Gate of a run in the run's own Space (`runProcedure`
 * found it and checked the role there), as the session's Person. The
 * engine's `answerGate` applies every rule, the lock-screen rule too. This
 * says its refusals of the Gate in the Gate's declared words, and a role
 * that does not allow an answer as `runProcedure` does. A run the engine
 * does not find is its plain `NOT_FOUND` (`readable`), as before.
 */
export async function answerGate(
	gates: Pick<Engine["gates"], "answer">,
	who: { personId: string; spaceId: string },
	input: z.output<typeof gateAnswerSchema>,
	errors: AnswerRefusals,
): Promise<void> {
	const { via, ...answer } = input;
	try {
		await gates.answer(
			{ personId: who.personId },
			{ ...answer, spaceId: who.spaceId, via: viaOf(via) },
		);
	} catch (error) {
		if (error instanceof GateClosedError) {
			throw errors.GATE_CLOSED({ cause: error });
		}
		if (error instanceof NeedsApp) throw errors.NEEDS_APP({ cause: error });
		if (error instanceof RoleRefusal) throw errors.FORBIDDEN({ cause: error });
		throw error;
	}
}
