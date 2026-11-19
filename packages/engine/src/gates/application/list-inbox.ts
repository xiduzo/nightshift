import { Refusal } from "@nightshift/refusal";
import { type Actor, permissionOf } from "../../contract";
import type { inboxOrder, OpenGate } from "../../read";
import { INBOX_SIGNED_OUT } from "../domain/inbox-order";
import type { GateLists, MemberSpaces } from "./ports";

/** An open Gate in a Person's inbox: with its Space's name and whether their role there allows an answer. */
export type InboxGate = OpenGate & { spaceName: string; canAnswer: boolean };

export type ListInboxPorts = {
	spaces: MemberSpaces;
	gates: Pick<GateLists, "open">;
	/** The order of every list of open Gates: the one that waited longest first (`read/`). */
	inboxOrder: typeof inboxOrder;
};

/**
 * The Needs-you inbox: the open Gates of every Space the Person is a
 * Member of on this Replica, in one order (the Gate that waited longest
 * first), each with its Space's name and whether their role there allows
 * an answer. It is not only the Space the Person works in: a Gate is
 * answered where it is, without a switch. Each Space's list comes from
 * its own runs. Night Shift has no inbox (`signed-out`).
 */
export const listInbox =
	(ports: ListInboxPorts) =>
	async (actor: Actor): Promise<InboxGate[]> => {
		if (!("personId" in actor)) {
			throw new Refusal("signed-out", INBOX_SIGNED_OUT);
		}
		const spaces = await ports.spaces.of(actor, permissionOf("answer"));
		const lists = await Promise.all(
			spaces.map(async (space) =>
				(await ports.gates.open(space.id)).map((gate) => ({
					...gate,
					spaceName: space.name,
					canAnswer: space.allowed,
				})),
			),
		);
		return ports.inboxOrder(lists.flat());
	};
