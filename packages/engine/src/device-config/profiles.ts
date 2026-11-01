import { randomUUID } from "node:crypto";
import {
	isAgentProfile,
	migrateToolSets,
	type Profile,
	type ProfileSettings,
	profileSchema,
	profileSettingsSchema,
} from "@nightshift/flows";
import { now } from "@nightshift/time";
import type * as Y from "yjs";
import { z } from "zod";
import type { DeviceProfile } from "../contract";
import { type DeviceDocument, mapView } from "./device-document";

/**
 * Profiles: an Agent Profile (a harness, a model and its tools) or a Model
 * Profile (a decider and its model), defined once on this Device (the
 * Agents page) and kept in its Device document. A profile's id never
 * changes. Its name is a label that a rename changes. Agent nodes, and
 * Decisions and Values decided by a model, name a profile by that label
 * for now; a run resolves it when it starts.
 */

export type ProfileView = Profile & { id: string; updatedAt: number };

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
	settingsFor(ref: string): ProfileSettings | null;
	/** Adds a profile, or replaces the one of `id`. A rename keeps the id. */
	save(input: Profile, id?: string): Promise<ProfileView>;
	remove(id: string): Promise<void>;
};

/**
 * A profile as the Device document holds it, under its id. An entry saved
 * before profiles had ids has no `name`: its key is its name and its id.
 */
const entrySchema = z.object({
	name: z.string().optional(),
	description: z.string().nullable(),
	settings: z.unknown(),
	updatedAt: z.number(),
});

/**
 * A new profile's id. The hyphen keeps it apart from every name
 * (`nameSchema`), so it never equals the id of an entry saved before ids.
 */
function newProfileId(): string {
	return `p-${randomUUID()}`;
}

/** The profiles of a Device document's `profiles` map, by id. */
export function readProfiles(
	entries: Y.Map<unknown>,
): Map<string, ProfileView> {
	const out = new Map<string, ProfileView>();
	for (const [id, value] of entries.entries()) {
		const entry = entrySchema.safeParse(value);
		if (!entry.success) continue;
		// A profile saved with the GitHub tool set reads as one with `gh`.
		const parsed = profileSettingsSchema.safeParse(
			migrateToolSets(entry.data.settings),
		);
		// An entry this version cannot read stays in the document, unused.
		if (!parsed.success) continue;
		out.set(id, {
			...parsed.data,
			id,
			name: entry.data.name ?? id,
			...(entry.data.description
				? { description: entry.data.description }
				: {}),
			updatedAt: entry.data.updatedAt,
		});
	}
	return out;
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

export function createProfileStore(options: {
	document: DeviceDocument;
}): ProfileStore {
	const { document } = options;
	const profiles = mapView(document, document.profiles, () =>
		readProfiles(document.profiles),
	);
	const list = () =>
		[...profiles().values()].sort(
			(a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
		);

	return {
		// The document is read when it opens; a remote edit applies at once.
		async load() {},
		list,
		get: (id) => profiles().get(id) ?? null,
		byName: (name) => list().find((p) => p.name === name) ?? null,
		settingsFor(ref) {
			// An id never equals a name (`newProfileId`): the two never mix up.
			const found =
				profiles().get(ref) ?? list().find((p) => p.name === ref) ?? null;
			if (!found) return null;
			const {
				id: _id,
				name: _name,
				description: _description,
				updatedAt: _at,
				...settings
			} = found;
			return settings;
		},
		async save(input, id = newProfileId()) {
			const { name, description, ...settings } = profileSchema.parse(input);
			const updatedAt = now();
			await document.change(() => {
				document.profiles.set(id, {
					name,
					description: description || null,
					settings,
					updatedAt,
				});
			});
			return {
				...settings,
				id,
				name,
				...(description ? { description } : {}),
				updatedAt,
			};
		},
		async remove(id) {
			await document.change(() => {
				document.profiles.delete(id);
			});
		},
	};
}
