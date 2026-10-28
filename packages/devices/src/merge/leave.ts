import type { DeviceCopies } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import type { LeaveResult } from "../contract";
import type { DeviceKeyStore, DeviceLinks, HostLinks, Link } from "../links";
import type { PersonalSpaceSplit } from "./split";

export const LEAVE_WORDS = {
	noHome: "This computer has no home Host.",
} as const;

/**
 * This computer leaves its home Host (`nightshift leave`, ADR 1): the
 * Host removes its access, and Personal splits off the Host's with what
 * this computer worked on. The Host keeps everything.
 *
 * Refuses before it changes anything without a home Host, and while a
 * run this computer walks in Personal is not done. A Host that does not
 * answer does not hold it back: this computer leaves on its own, and the
 * Host lists it until its owner removes it there (`told`). The link
 * stops and its key goes, then the copies of the Person's other Devices,
 * then the split (`PersonalSpaceSplit`). It reports the split of the
 * Space it left, whoever ran it: the revoke hook may run it first.
 */
export async function leaveHomeHost(deps: {
	hostLinks: Pick<HostLinks, "list" | "get" | "revoked">;
	links: Pick<DeviceLinks, "get" | "add">;
	keys: Pick<DeviceKeyStore, "delete">;
	copies: Pick<DeviceCopies, "keep">;
	split: Pick<PersonalSpaceSplit, "check" | "run" | "of">;
}): Promise<LeaveResult> {
	const home = (await deps.hostLinks.list()).find(
		(link) => link.role === "home" && link.revokedAt === null,
	);
	if (!home) throw new Refusal("conflict", LEAVE_WORDS.noHome);
	const from = await deps.split.check();

	const told = await tell(deps.links.get(home.hostId));
	await deps.hostLinks.revoked(home.hostId);
	await deps.keys.delete(home.hostId);
	// A link without access does not start again: this stops it.
	const left = await deps.hostLinks.get(home.hostId);
	if (left) await deps.links.add(left);
	await deps.copies.keep([]);

	let waiting: string | null = null;
	try {
		await deps.split.run();
	} catch (error) {
		if (!(error instanceof Refusal)) throw error;
		waiting = error.message;
	}
	return {
		host: { id: home.hostId, name: home.name },
		told,
		split: from === null ? null : await deps.split.of(from),
		waiting,
	};
}

/** Asks the Host to remove this computer's access. False: it did not. */
async function tell(link: Link | undefined): Promise<boolean> {
	if (!link) return false;
	try {
		await link.call((client) => client.link.leave());
		return true;
	} catch (error) {
		// A Host that no longer knows this computer let it go already.
		return error instanceof ORPCError && error.code === "UNAUTHORIZED";
	}
}
