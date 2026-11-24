import {
	isAgentProfile,
	type Profile,
	type ProfileSettings,
	profileSchema,
	profileSettingsSchema,
} from "@nightshift/flows";
import { z } from "zod";
import type { DeviceProfile } from "../../../contract";

/**
 * Profiles: an Agent Profile (a harness, a model and its tools) or a Model
 * Profile (a decider and its model), defined once on this Device (the
 * Agents page) and kept in its Device document. A profile's id never
 * changes. Its name is a label that a rename changes. Agent nodes, and
 * Decisions and Values decided by a model, name a profile by its Device
 * and its id. A run resolves it when it starts.
 */

export type ProfileView = Profile & { id: string; updatedAt: number };

/** A profile as the Device document holds it, under its id. */
export type ProfileEntry = {
	name: string;
	description: string | null;
	settings: ProfileSettings;
	updatedAt: number;
};

/** A profile as the Device document holds it, under its id. */
const entrySchema = z.object({
	name: z.string(),
	description: z.string().nullable(),
	settings: z.unknown(),
	updatedAt: z.number(),
});

/** A new profile's id, from a random value. */
export function profileIdOf(random: string): string {
	return `p-${random}`;
}

/** The profiles of a Device document's `profiles` map, by id. */
export function readProfiles(
	entries: Iterable<[string, unknown]>,
): Map<string, ProfileView> {
	const out = new Map<string, ProfileView>();
	for (const [id, value] of entries) {
		const entry = entrySchema.safeParse(value);
		if (!entry.success) continue;
		const parsed = profileSettingsSchema.safeParse(entry.data.settings);
		// An entry this version cannot read stays in the document, unused.
		if (!parsed.success) continue;
		out.set(id, {
			...parsed.data,
			id,
			name: entry.data.name,
			...(entry.data.description
				? { description: entry.data.description }
				: {}),
			updatedAt: entry.data.updatedAt,
		});
	}
	return out;
}

/** The profiles in the order the Agents page lists them: by name, then by id. */
export function profilesInOrder(
	profiles: ReadonlyMap<string, ProfileView>,
): ProfileView[] {
	return [...profiles.values()].sort(
		(a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
	);
}

/**
 * What a run resolves a node with, or null when there is no such profile.
 * A flow names a profile by its id. Only this Device's own profiles: never
 * another Device's (ADR 3).
 */
export function settingsFor(
	profiles: ReadonlyMap<string, ProfileView>,
	id: string,
): ProfileSettings | null {
	const found = profiles.get(id);
	return found ? settingsOf(found) : null;
}

/** A profile's settings: what a run takes from it. */
export function settingsOf(profile: ProfileView): ProfileSettings {
	const {
		id: _id,
		name: _name,
		description: _description,
		updatedAt: _at,
		...settings
	} = profile;
	return settings;
}

/**
 * What a save of `input` under `id` writes, and the profile it answers.
 * It reads the clock after the input parses.
 */
export function profileSave(
	input: Profile,
	id: string,
	now: () => number,
): { entry: ProfileEntry; view: ProfileView } {
	const { name, description, ...settings } = profileSchema.parse(input);
	const at = now();
	return {
		entry: {
			name,
			description: description || null,
			settings,
			updatedAt: at,
		},
		view: {
			...settings,
			id,
			name,
			...(description ? { description } : {}),
			updatedAt: at,
		},
	};
}

/** A profile as a Person picks it for a node. */
export function profileChoice(profile: ProfileView): DeviceProfile {
	if (!isAgentProfile(profile)) {
		return { id: profile.id, name: profile.name, kind: "model" };
	}
	return {
		id: profile.id,
		name: profile.name,
		kind: "agent",
		permissionMode: profile.permissionMode,
	};
}
