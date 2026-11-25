import { listedThroughOffers } from "./through-offers";

/**
 * A Person's own Devices beside this computer, from what this computer
 * knows: the Devices paired with it, the list of the Space's Host, or the
 * copies of their documents while that Host cannot be reached.
 */

/** A copy of a Device's document. */
type Copy<P> = { deviceId: string; name: string | null; profiles: P[] };

/** The paired Devices with access, without this computer. */
export function othersPaired<
	D extends { id: string; revokedAt: number | null },
>(paired: readonly D[], selfId: string): D[] {
	return paired.filter((d) => d.revokedAt === null && d.id !== selfId);
}

/**
 * The Devices the Host lists, without this computer. A Host that cannot
 * tell the profiles of a Device of the Person: its copy here can.
 */
export function fromHost<
	P,
	D extends { deviceId: string; offers?: string[]; profiles?: P[] },
>(
	listed: readonly D[],
	copies: readonly Copy<P>[],
	selfId: string,
): (D & { thisDevice: false })[] {
	const copyOf = new Map(copies.map((c) => [c.deviceId, c]));
	return listed
		.filter((d) => d.deviceId !== selfId)
		.map((d) => {
			const profiles =
				d.profiles ??
				(listedThroughOffers(d) ? undefined : copyOf.get(d.deviceId)?.profiles);
			return {
				...d,
				thisDevice: false,
				...(profiles ? { profiles } : {}),
			};
		});
}

/** The Devices as their copies last told, offline: the Host cannot be reached. */
export function fromCopies<P>(
	copies: readonly Copy<P>[],
	known: {
		deviceName(deviceId: string): string | null;
		hasProject(deviceId: string): boolean;
	},
) {
	return copies.map((copy) => ({
		deviceId: copy.deviceId,
		name: copy.name ?? known.deviceName(copy.deviceId) ?? "Device",
		thisDevice: false,
		online: false,
		hasClone: known.hasProject(copy.deviceId),
		profiles: copy.profiles,
	}));
}
