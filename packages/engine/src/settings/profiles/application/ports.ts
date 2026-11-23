import type { ProfileEntry, ProfileView } from "../domain/profile-entries";

/**
 * The profiles in this computer's Device document. A read is synchronous:
 * a run resolves its nodes with it.
 */
export type SavedProfiles = {
	/** The profiles that parse, by id. An entry this version cannot read is left out. */
	read(): ReadonlyMap<string, ProfileView>;
	/** Adds or replaces the profile of `id`, in one change of the document. */
	write(id: string, entry: ProfileEntry): Promise<void>;
	/** Removes the profile of `id`, in one change of the document. */
	remove(id: string): Promise<void>;
};
