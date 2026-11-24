import type { Profile } from "@nightshift/flows";
import { inMemoryComputer } from "../../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../../contract";
import { removeProfile } from "../../application/remove-profile";
import { writeProfile } from "../../application/write-profile";
import { profilesInOrder } from "../../domain/profile-entries";
import type { ProfileStore } from "../../wire";
import { inMemorySavedProfiles } from "./in-memory-saved-profiles";

/**
 * The profiles over in-memory adapters: the real use cases, with ids from a
 * counter. The use-case test of every slice that reads or saves a profile
 * takes this one. Test code: production code never imports this file.
 */
export function inMemoryProfiles() {
	const saved = inMemorySavedProfiles();
	let next = 1;
	const write = writeProfile({
		saved,
		now: () => 1,
		random: () => `p-${next++}`,
	});
	const remove = removeProfile({ computerAccess: inMemoryComputer(), saved });
	const list = () => profilesInOrder(saved.read());
	const bound = {
		list,
		get: (id) => saved.read().get(id) ?? null,
		byName: (name) => list().find((p) => p.name === name) ?? null,
		save: (profile: Profile, id?: string) =>
			write(id === undefined ? { profile } : { profile, id }),
		remove: (id) => remove(NIGHT_SHIFT, { id }),
	} satisfies Partial<ProfileStore>;
	return { ...bound, saved };
}
