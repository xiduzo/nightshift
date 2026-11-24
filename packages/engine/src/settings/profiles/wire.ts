import { randomUUID } from "node:crypto";
import type { Profile, ProfileSettings } from "@nightshift/flows";
import { now as timeNow } from "@nightshift/time";
import type { ComputerAccess } from "../../access";
import { NIGHT_SHIFT } from "../../contract";
import type { DeviceDocument } from "../../documents";
import { yjsSavedProfiles } from "./adapters/out/yjs-saved-profiles";
import { removeProfile } from "./application/remove-profile";
import { writeProfile } from "./application/write-profile";
import {
	type ProfileView,
	profilesInOrder,
	settingsFor,
} from "./domain/profile-entries";

/** This computer's profiles, as their readers and the edits use them. */
export type ProfileStore = {
	/** Reads the profiles. Call once before the rest. */
	load(): Promise<void>;
	list(): ProfileView[];
	get(id: string): ProfileView | null;
	/** The profile with that name, as a flow names it. */
	byName(name: string): ProfileView | null;
	/**
	 * What a run resolves a node with, or null when there is no such
	 * profile. A flow names a profile by its id. A Walker of an older Night
	 * Shift asks by the name: an old profile's id is its name, and a newer
	 * profile of that name is found by it. Only this Device's own profiles:
	 * never another Device's of the same name (ADR 3).
	 */
	settingsFor(id: string): ProfileSettings | null;
	/** Adds a profile, or replaces the one of `id`. A rename keeps the id. */
	save(input: Profile, id?: string): Promise<ProfileView>;
	remove(id: string): Promise<void>;
};

/** The profiles, and the use case of a person's door. */
export type Profiles = ProfileStore & {
	removeProfile: ReturnType<typeof removeProfile>;
};

/**
 * The profiles of this computer over its Device document. It binds the
 * use cases `writeProfile` and `removeProfile` behind the store that the
 * readers and the edits use today. The use case asks for the owner of
 * this computer. The store acts as Night Shift.
 */
export function wireProfiles(deps: {
	/** Who may ask of this computer. */
	computerAccess: Pick<ComputerAccess, "openComputer">;
	document: DeviceDocument;
	/** A random value for a new profile's id. Default: a UUID. */
	random?: () => string;
}): Profiles {
	const saved = yjsSavedProfiles(deps.document);
	const write = writeProfile({
		saved,
		now: timeNow,
		random: deps.random ?? randomUUID,
	});
	const remove = removeProfile({ computerAccess: deps.computerAccess, saved });
	const list = () => profilesInOrder(saved.read());
	return {
		// The document is read when it opens; a remote edit applies at once.
		async load() {},
		list,
		get: (id) => saved.read().get(id) ?? null,
		byName: (name) => list().find((p) => p.name === name) ?? null,
		settingsFor: (id) => settingsFor(saved.read(), id),
		save: (profile, id) =>
			write(id === undefined ? { profile } : { profile, id }),
		remove: (id) => remove(NIGHT_SHIFT, { id }),
		removeProfile: remove,
	};
}
