import { type DevicesOverview, platformName } from "@nightshift/client";

/** A computer that can run the person's flows, as the phone lists it. */
export type Computer = {
	id: string;
	name: string;
	/** "macOS", "Linux", "Windows". */
	system: string;
	online: boolean;
	lastSeenAt: number | null;
	/** The Host this phone is signed in to: it runs flows too. */
	isHost: boolean;
};

/**
 * The person's computers: the Host first when they own it (it answers, so
 * it is online), then their paired computers, online ones first, by name.
 * A computer whose access was removed cannot run a flow, so it is left out.
 */
export function computersOf(overview: DevicesOverview): Computer[] {
	const host = overview.thisComputer;
	const paired = overview.devices
		.filter((device) => device.revokedAt === null)
		.map((device) => ({
			id: device.id,
			name: device.name,
			system: platformName(device.platform),
			online: device.online,
			lastSeenAt: device.lastSeenAt,
			isHost: false,
		}))
		.sort(
			(a, b) =>
				Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
		);
	return host
		? [
				{
					id: host.id,
					name: host.name,
					system: platformName(host.platform),
					online: true,
					lastSeenAt: null,
					isHost: true,
				},
				...paired,
			]
		: paired;
}

/** The line under the title: "2 of 3 online", or how your one computer is. */
export function onlineSummary(
	computers: readonly Pick<Computer, "online">[],
): string {
	const online = computers.filter((computer) => computer.online).length;
	if (computers.length === 1) {
		return online === 1
			? "Your computer is online"
			: "Your computer is offline";
	}
	return `${online} of ${computers.length} online`;
}
