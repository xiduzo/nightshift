import { spacesOf } from "@nightshift/auth";
import { GateClosedError } from "@nightshift/engine";
import type { ORPCErrorConstructorMap } from "@orpc/server";
import type { z } from "zod";

import type { Context } from "../context";
import type { gateAnswerSchema, inboxGateSchema } from "./schemas";

/** The parts of a request the inbox needs: who asks, and this computer's engine and database. */
type InboxContext = Pick<Context, "db" | "engine" | "can"> & {
	session: NonNullable<Context["session"]>;
};

type InboxGate = z.output<typeof inboxGateSchema>;

/**
 * The open Gates of every Space the Person is a member of on this computer,
 * oldest first, each with its Space's name and whether their role there
 * allows an answer. Each Space's list comes from its own run log.
 */
export async function inboxOf(context: InboxContext): Promise<InboxGate[]> {
	const personId = context.session.user.id;
	const spaces = await spacesOf(context.db, personId);
	const lists = await Promise.all(
		spaces.map(async (space) => {
			const [open, canAnswer] = await Promise.all([
				context.engine.space(space.id, { personId }).listGates(),
				context.can({ gate: ["resolve"] }, space.id),
			]);
			return open.map((gate) => ({
				...gate,
				spaceName: space.name,
				canAnswer,
			}));
		}),
	);
	return lists.flat().sort((a, b) => a.openedAt - b.openedAt);
}

/**
 * Why Night Shift does not take an answer. Each is a declared error of
 * `gates.resolve`, so a screen reads its code, never its message:
 * - `GATE_CLOSED`: the Gate does not wait anymore. Someone answered it,
 *   its run ended, or an answer is on its way.
 * - `NEEDS_APP`: a lock-screen answer to a Gate that its author did not
 *   mark for the lock screen, or with a choice it does not have.
 * - `FORBIDDEN`: the Person's role in the Space does not allow an answer.
 * - `NOT_FOUND`: the run is not in one of the Person's Spaces.
 * Any other problem (the run cap, a choice that is not an option) stays a
 * bad request with its message.
 */
export const answerRefusals = {
	GATE_CLOSED: { status: 409, message: "This Gate does not wait anymore." },
	NEEDS_APP: {
		status: 403,
		message: "Open this Gate in Night Shift to answer it.",
	},
	FORBIDDEN: {
		status: 403,
		message: "Your role in this Space does not allow this.",
	},
	NOT_FOUND: {
		status: 404,
		message: "This Gate is not in one of your Spaces.",
	},
} as const;

type AnswerRefusals = ORPCErrorConstructorMap<typeof answerRefusals>;

/**
 * Answers the open Gate of a run in whichever of the Person's Spaces it is,
 * with their role there; the session's Space stays as it is. A run outside
 * their Spaces is "not found", the same as one that does not exist. The
 * engine refuses an answer to a Gate that no longer waits, and this says
 * so as `GATE_CLOSED`. An answer from the lock screen goes only to a Gate
 * its author marked for it, with one of its choices: the push that shows
 * the buttons is not proof of that. The Host alone checks it.
 */
export async function answerGate(
	context: InboxContext,
	input: z.output<typeof gateAnswerSchema>,
	errors: AnswerRefusals,
): Promise<void> {
	const personId = context.session.user.id;
	const spaceId = await context.engine.spaceOfRun(input.runId);
	const spaces = spaceId ? await spacesOf(context.db, personId) : [];
	if (!spaceId || !spaces.some((space) => space.id === spaceId)) {
		throw errors.NOT_FOUND();
	}
	if (!(await context.can({ gate: ["resolve"] }, spaceId))) {
		throw errors.FORBIDDEN();
	}
	const { via, ...answer } = input;
	const space = context.engine.space(spaceId, { personId });
	if (via === "lock-screen") {
		const gate = (await space.listGates()).find(
			(open) => open.runId === answer.runId && open.stepId === answer.stepId,
		);
		if (!gate || gate.answerPending) throw errors.GATE_CLOSED();
		const known = gate.choices.some((choice) => choice.name === answer.choice);
		if (!gate.lockScreen || !known) throw errors.NEEDS_APP();
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
