import type { Database } from "@nightshift/db";
import { now } from "@nightshift/time";
import type { GateUseCases } from "../engine";
import { wireGates } from "../gates";
import type { AnsweredGate, OpenGate } from "../read";

/**
 * The Needs-you inbox of the engine (`Engine.gates.inbox` and
 * `answeredInbox`) over a test's database, with the Gates the test gives
 * per Space: what a door test reads without a whole engine. The Spaces of
 * a Person and their roles come from the database, as on a Replica. It
 * answers no Gate: a test gives `answer` itself.
 */
export function testInbox(deps: {
	db: Database;
	open(spaceId: string): Promise<OpenGate[]>;
	answered?(spaceId: string, since: number): Promise<AnsweredGate[]>;
}): Pick<GateUseCases, "inbox" | "answeredInbox"> {
	const refused = async (): Promise<never> => {
		throw new Error("The inbox of a test answers no Gate.");
	};
	const gates = wireGates({
		access: { openRun: refused, openSpace: async () => {} },
		walk: {} as Parameters<typeof wireGates>[0]["walk"],
		members: { db: deps.db },
		gates: {
			open: deps.open,
			answered: deps.answered ?? (async () => []),
		},
		files: { save: refused },
		now,
	});
	return { inbox: gates.listInbox, answeredInbox: gates.listAnsweredInbox };
}
