import { roleAllows, spacesOf } from "@nightshift/auth";
import type { Database } from "@nightshift/db";

import type { Actor } from "../contract";
import type { OpenGate } from "./views";

/**
 * The Needs-you inbox: the open Gates of every Space a Person is in, in one
 * order, and which answers from the lock screen it takes. The API lists it
 * and answers through it. The reply is in its order, so no screen sorts it
 * again.
 */

/** An open Gate in a Person's inbox: with its Space's name and whether their role there allows an answer. */
export type InboxGate = OpenGate & { spaceName: string; canAnswer: boolean };

type Ordered = Pick<OpenGate, "openedAt" | "runId" | "stepId">;

/**
 * The inbox order: the Gate that has waited longest first. Two Gates that
 * opened at the same moment keep one order on every screen.
 */
export function inboxOrder<G extends Ordered>(gates: readonly G[]): G[] {
	return [...gates].sort(
		(a, b) =>
			a.openedAt - b.openedAt ||
			a.runId.localeCompare(b.runId) ||
			a.stepId.localeCompare(b.stepId),
	);
}

/** What the inbox reads: the Spaces of a Person, and the open Gates of each through its view. */
export type InboxSources = {
	db: Database;
	engine: {
		space(spaceId: string, actor: Actor): { listGates(): Promise<OpenGate[]> };
	};
};

/**
 * The open Gates of every Space the Person is a member of on this computer,
 * in the inbox order, each with its Space's name and whether their role
 * there allows an answer (their role, read with the Spaces). Each Space's
 * list comes from its own run log.
 */
export async function inboxOf(
	{ db, engine }: InboxSources,
	personId: string,
): Promise<InboxGate[]> {
	const spaces = await spacesOf(db, personId);
	const lists = await Promise.all(
		spaces.map(async (space) => {
			const open = await engine.space(space.id, { personId }).listGates();
			const canAnswer = roleAllows(space.role, { gate: ["resolve"] });
			return open.map((gate) => ({
				...gate,
				spaceName: space.name,
				canAnswer,
			}));
		}),
	);
	return inboxOrder(lists.flat());
}

/**
 * Why an answer from the lock screen does not go to a Gate, or null when it
 * does. A Gate takes it only when its author marked it for the lock screen
 * and the choice is one of its own: the push that shows the buttons is not
 * proof of that. `gate-closed`: the Gate is not open, or an answer is on its
 * way. `needs-app`: the answer needs the app. `open` is the Space's open
 * Gates (`listGates`).
 */
export function lockScreenRefusal(
	open: readonly OpenGate[],
	answer: { runId: string; stepId: string; choice: string },
): "gate-closed" | "needs-app" | null {
	const gate = open.find(
		(one) => one.runId === answer.runId && one.stepId === answer.stepId,
	);
	if (!gate || gate.answerPending) return "gate-closed";
	const known = gate.choices.some((choice) => choice.name === answer.choice);
	return gate.lockScreen && known ? null : "needs-app";
}
