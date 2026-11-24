import type { ProfileSettings } from "@nightshift/flows";
import type { DeviceProfile } from "../../../contract";

/**
 * Copies of the Device documents of this computer's owner's other
 * Devices: the home Host syncs them here, read-only (ADR 1, decisions 2
 * and 3). They tell this computer the name, the profiles and the secret
 * names of each of those Devices, also while that Device or the Host is
 * offline. Secret values never enter a Device document, so none is here.
 */

/** One Device of the owner, as its last synced document says. */
export type DeviceCopy = {
	deviceId: string;
	/**
	 * The name it reports, else the name the Host last gave it. Null: neither
	 * is known.
	 */
	name: string | null;
	/** `process.platform`. Null: not reported yet. */
	platform: string | null;
	/** Its profiles, by name. */
	profiles: DeviceProfile[];
	/** The names of the secrets saved on it, by name. Never their values. */
	secrets: { name: string; setAt: number | null }[];
	/** When the Device last looked at itself (epoch ms). Null: not reported yet. */
	checkedAt: number | null;
};

/** A profile of another Device, as its document holds it. */
export type KnownProfile = ProfileSettings & {
	id: string;
	name: string;
	description?: string | null;
	updatedAt: number;
};

/** What one Device document says of its Device: the copy as a list shows it, and its profiles in full. */
export type DeviceRecord = { copy: DeviceCopy; profiles: KnownProfile[] };

/** The name a copy shows: the one it reports, else the one the Host gave. */
export function withHostName(
	copy: DeviceCopy,
	named: ReadonlyMap<string, string>,
): DeviceCopy {
	return { ...copy, name: copy.name ?? named.get(copy.deviceId) ?? null };
}

/** By name, then by Device id. A copy with no name comes first. */
export function copiesInOrder(copies: DeviceCopy[]): DeviceCopy[] {
	return copies.sort(
		(a, b) =>
			(a.name ?? "").localeCompare(b.name ?? "") ||
			a.deviceId.localeCompare(b.deviceId),
	);
}

/** The profiles of a Device by id, with their names: what a run starts from. */
export function knownProfiles(
	profiles: Iterable<KnownProfile>,
): Map<string, { name: string; settings: ProfileSettings }> {
	const known = new Map<string, { name: string; settings: ProfileSettings }>();
	for (const profile of profiles) {
		const {
			id,
			name,
			description: _description,
			updatedAt: _at,
			...settings
		} = profile;
		known.set(id, { name, settings: settings as ProfileSettings });
	}
	return known;
}
