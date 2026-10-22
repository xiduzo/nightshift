import { spacesOf } from "@nightshift/auth";
import { ORPCError } from "@orpc/server";
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
 * Answers the open Gate of a run in whichever of the Person's Spaces it is,
 * with their role there; the session's Space stays as it is. A run outside
 * their Spaces is "not found", the same as one that does not exist. The
 * engine refuses a step that is not the run's open Gate, so an answer to a
 * closed Gate is refused too. An answer from the lock screen goes only to
 * a Gate its author marked for it: the push that shows the buttons is not
 * proof of that.
 */
export async function answerGate(
	context: InboxContext,
	input: z.output<typeof gateAnswerSchema>,
): Promise<void> {
	const personId = context.session.user.id;
	const spaceId = await context.engine.spaceOfRun(input.runId);
	const spaces = spaceId ? await spacesOf(context.db, personId) : [];
	if (!spaceId || !spaces.some((space) => space.id === spaceId)) {
		throw new ORPCError("NOT_FOUND", {
			message: "This Gate is not in one of your Spaces.",
		});
	}
	if (!(await context.can({ gate: ["resolve"] }, spaceId))) {
		throw new ORPCError("FORBIDDEN", {
			message: "Your role in this Space does not allow this.",
		});
	}
	const { via, ...answer } = input;
	const space = context.engine.space(spaceId, { personId });
	if (via === "lock-screen") {
		const gate = (await space.listGates()).find(
			(open) => open.runId === answer.runId && open.stepId === answer.stepId,
		);
		if (!gate) {
			throw new ORPCError("BAD_REQUEST", {
				message: "This Gate is no longer open.",
			});
		}
		if (!gate.lockScreen) {
			throw new ORPCError("FORBIDDEN", {
				message: "Open this Gate in Night Shift to answer it.",
			});
		}
	}
	await space.resolveGate(answer);
}
