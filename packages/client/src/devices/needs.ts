import type { DevicesOverview, SpaceDevice } from "./types";

/**
 * Which computers a flow needs that are offline now. A flow names its
 * computers by name (a node's device) and by id (a profile's device). The
 * Host answers what it knows of them: the Space's computers, the
 * Person's paired computers, and itself.
 */

/** A computer as the Host knows it now. Null `online`: it cannot tell. */
export type KnownComputer = {
	id: string;
	name: string;
	online: boolean | null;
};

/**
 * The computers the Host knows, the Space's first: the Host itself (it
 * answers, so it is online), the Space's computers, then the Person's
 * paired ones. A paired computer whose access was removed is offline.
 */
export function knownComputers(
	overview: DevicesOverview | undefined,
	space: readonly SpaceDevice[] | undefined,
): KnownComputer[] {
	const host = overview?.thisComputer;
	return [
		...(host ? [{ id: host.id, name: host.name, online: true }] : []),
		...(space ?? []).map((device) => ({
			id: device.id,
			name: device.name,
			online: device.thisDevice ? true : device.online,
		})),
		...(overview?.devices ?? []).map((device) => ({
			id: device.id,
			name: device.name,
			online: device.revokedAt === null && device.online,
		})),
	];
}

/**
 * The names of the computers a flow names that are offline now, each
 * once, in the flow's order. A computer the Host does not know, or cannot
 * tell about, is left out: there is nothing sure to say.
 */
export function offlineNeeds(
	flow: { names: readonly string[]; ids: readonly string[] },
	known: readonly KnownComputer[],
): string[] {
	const offline = new Set<string>();
	const check = (computer: KnownComputer | undefined) => {
		if (computer?.online === false) offline.add(computer.name);
	};
	for (const name of flow.names) {
		check(known.find((computer) => computer.name === name));
	}
	for (const id of flow.ids) {
		check(known.find((computer) => computer.id === id));
	}
	return [...offline];
}
