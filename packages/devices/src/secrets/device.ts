import { HostUnreachableError } from "@nightshift/engine";
import type { PersonalSecrets } from "@nightshift/engine/device-config";
import type { HostClient } from "../contract";
import type { DeviceLinks, HostLinks, Link } from "../links";
import type { PersonalSecretStore } from "./store";

/** What a person reads when their Home Host does not know Personal secrets yet. */
export const OLDER_HOST_SECRETS =
	"Your home Host runs an older version of Night Shift. Update Night Shift there to use Personal secrets.";

/** How long one call for the Personal secrets may take before a step reads them as missing. */
export const PERSONAL_DEADLINE_MS = 20_000;

/**
 * The Person's Personal secrets as this computer reaches them (ADR 13),
 * the engine's `PersonalSecrets` port:
 *
 * - With a Home Host (a home link with access): each call goes to that
 *   Host over its link, with this Device's key. The Host answers for the
 *   key's Person only. Nothing is kept here: a value lives in memory for
 *   the use that asked.
 * - Without one: this computer keeps them itself, in its own store, for
 *   its owner.
 *
 * A Host that cannot be reached, or does not answer within
 * `PERSONAL_DEADLINE_MS`, throws `HostUnreachableError`: a step then reads
 * the secret as missing (fails closed). The Host's refusals come back in
 * this computer's words: the Link's.
 */
export function devicePersonalSecrets(deps: {
	hostLinks: Pick<HostLinks, "home">;
	/** Lazy: the links are made after this. */
	links(): Pick<DeviceLinks, "get">;
	store: PersonalSecretStore;
	/** The Person who owns this computer: whose secrets it keeps without a Home Host. */
	ownerId: string;
	/** This computer's Device: the one that set a value it keeps itself. */
	selfId: string;
	deadlineMs?: number;
}): PersonalSecrets {
	const deadlineMs = deps.deadlineMs ?? PERSONAL_DEADLINE_MS;

	async function at<T>(
		here: () => Promise<T>,
		onHost: (client: HostClient) => Promise<T>,
	): Promise<T> {
		const home = await deps.hostLinks.home();
		if (!home) return here();
		return askHost(deps.links().get(home.hostId), onHost, {
			deadlineMs,
			olderHost: OLDER_HOST_SECRETS,
		});
	}

	const { store, ownerId } = deps;
	return {
		list: () =>
			at(
				() => store.list(ownerId),
				(client) => client.secrets.list(),
			),
		values: (names) =>
			names.length === 0
				? Promise.resolve({})
				: at(
						() => store.values(ownerId, names),
						(client) => client.secrets.values({ names: [...names] }),
					),
		set: (name, value) =>
			at(
				() => store.set(ownerId, name, value, deps.selfId),
				(client) => client.secrets.set({ name, value }),
			),
		remove: (name) =>
			at(
				() => store.remove(ownerId, name),
				(client) => client.secrets.remove({ name }),
			),
	};
}

/**
 * One call of a Host over its link, for a secret: within `deadlineMs`,
 * else `HostUnreachableError`, as is a Host without a link here. A Host
 * of a version without the call says `olderHost`.
 */
export async function askHost<T>(
	link: Pick<Link, "call"> | undefined,
	onHost: (client: HostClient) => Promise<T>,
	options: { deadlineMs: number; olderHost: string },
): Promise<T> {
	if (!link) throw new HostUnreachableError();
	return link.call(onHost, {
		...options,
		late: () => new HostUnreachableError(),
	});
}
