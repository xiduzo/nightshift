import type { DeviceOffers, Memberships, Profiles, SpaceOffers } from "./ports";

export type NoteProfileRenamedPorts = {
	deviceOffers: DeviceOffers;
	spaceOffers: Pick<SpaceOffers, "list" | "publish">;
	memberships: Pick<Memberships, "personInSpace">;
	profiles: Pick<Profiles, "get">;
	self: { id: string; name: string };
};

/**
 * Shows a profile's new name in the Spaces that list its Offers. Each
 * Offer keeps its caps. A Space that cannot be reached keeps the old
 * name until the next change of the Offer.
 */
export const noteProfileRenamed =
	(ports: NoteProfileRenamedPorts) =>
	async (profileId: string, by: string): Promise<void> => {
		const profile = ports.profiles.get(profileId);
		if (!profile) return;
		for (const offer of ports.deviceOffers.list(() => profile.name)) {
			if (offer.profile !== profileId) continue;
			const listed = (await ports.spaceOffers.list(offer.spaceId)).find(
				(o) => o.deviceId === ports.self.id && o.profile === profileId,
			);
			// A Space that stopped listing it keeps it withdrawn.
			if (!listed || listed.profileName === profile.name) continue;
			try {
				await ports.spaceOffers.publish({
					spaceId: offer.spaceId,
					profile: profileId,
					profileName: profile.name,
					permissionCap: offer.permissionCap,
					sessionCap: offer.sessionCap,
					deviceId: ports.self.id,
					deviceName: ports.self.name,
					by: await ports.memberships.personInSpace(offer.spaceId, by),
				});
			} catch (error) {
				// The rename stands. The Space shows the old name until the
				// next change of this Offer.
				console.error(
					`[offers] the new name of ${profileId} did not reach ${offer.spaceId}:`,
					error,
				);
			}
		}
	};
