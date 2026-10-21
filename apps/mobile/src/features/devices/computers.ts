import type { DevicesOverview } from "@nightshift/client";

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

/** A platform as people say it: `darwin` is macOS. */
export function systemName(platform: string | null | undefined): string {
	switch (platform) {
		case "darwin":
			return "macOS";
		case "linux":
			return "Linux";
		case "win32":
			return "Windows";
		default:
			return platform || "Unknown system";
	}
}

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
			system: systemName(device.platform),
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
					system: systemName(host.platform),
					online: true,
					lastSeenAt: null,
					isHost: true,
				},
				...paired,
			]
		: paired;
}
