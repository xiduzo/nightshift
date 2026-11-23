import type { Profile } from "@nightshift/flows";
import {
	type ProfileView,
	profileIdOf,
	profileSave,
} from "../domain/profile-entries";
import type { SavedProfiles } from "./ports";

export type WriteProfilePorts = {
	saved: Pick<SavedProfiles, "write">;
	now: () => number;
	/** A random value for the id of a new profile. */
	random: () => string;
};

/** A profile to write, and the id of the one it replaces. */
export type WriteProfile = { profile: Profile; id?: string };

/**
 * Adds a profile, or replaces the one of `id`, in one write. A rename
 * keeps the id. It checks nothing but the shape of the profile: the edits
 * of a person check the names first (`saveProfile` of `edits`).
 */
export const writeProfile =
	(ports: WriteProfilePorts) =>
	async (request: WriteProfile): Promise<ProfileView> => {
		const id = request.id ?? profileIdOf(ports.random());
		const { entry, view } = profileSave(request.profile, id, ports.now);
		await ports.saved.write(id, entry);
		return view;
	};
