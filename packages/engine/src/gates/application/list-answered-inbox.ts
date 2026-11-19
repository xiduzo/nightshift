import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../contract";
import type { AnsweredGate } from "../../read";
import {
	answeredOrder,
	INBOX_KEEP_MS,
	INBOX_SIGNED_OUT,
} from "../domain/inbox-order";
import type { GateLists, MemberSpaces } from "./ports";

/** An answered Gate in a Person's inbox, with its Space's name. */
export type InboxAnsweredGate = AnsweredGate & { spaceName: string };

export type ListAnsweredInboxPorts = {
	spaces: MemberSpaces;
	gates: Pick<GateLists, "answered">;
	/** The time now. */
	now(): number;
};

/**
 * The answered part of the inbox: the Gates that closed in the last 90
 * days (`INBOX_KEEP_MS`) in every Space the Person is a Member of, newest
 * first, each with its Space's name. Night Shift has no inbox
 * (`signed-out`).
 */
export const listAnsweredInbox =
	(ports: ListAnsweredInboxPorts) =>
	async (actor: Actor): Promise<InboxAnsweredGate[]> => {
		if (!("personId" in actor)) {
			throw new Refusal("signed-out", INBOX_SIGNED_OUT);
		}
		const since = ports.now() - INBOX_KEEP_MS;
		const spaces = await ports.spaces.of(actor, {});
		const lists = await Promise.all(
			spaces.map(async (space) =>
				(await ports.gates.answered(space.id, since)).map((gate) => ({
					...gate,
					spaceName: space.name,
				})),
			),
		);
		return answeredOrder(lists.flat());
	};
