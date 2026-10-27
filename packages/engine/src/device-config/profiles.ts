import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import {
	isAgentProfile,
	migrateToolSets,
	type Profile,
	type ProfileSettings,
	profileSchema,
	profileSettingsSchema,
} from "@nightshift/flows";
import * as Y from "yjs";
import { z } from "zod";
import type { DeviceProfile } from "../contract";
import {
	type DeviceDocument,
	deviceDocumentName,
	mapView,
} from "./device-document";
import { documentRows } from "./ydoc";

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
	/** What a run resolves a node with, or null when there is no such profile. */
	settingsFor(id: string): ProfileSettings | null;
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
function readProfiles(entries: Y.Map<unknown>): Map<string, ProfileView> {
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

/**
 * The profiles in this Replica's copy of another Device's document, as
 * a Person picks them: a Host keeps the copies of the Devices whose home
 * Host it is. Null when this Replica has no copy.
 */
export async function storedDeviceProfiles(
	db: Database,
	deviceId: string,
): Promise<DeviceProfile[] | null> {
	const state = await documentRows(db).fetch(deviceDocumentName(deviceId));
	if (!state) return null;
	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, state);
		return [...readProfiles(doc.getMap("profiles")).values()]
			.map(profileChoice)
			.sort((a, b) => a.name.localeCompare(b.name));
	} finally {
		doc.destroy();
	}
}

/** A profile as a Person picks it for a node. */
export function profileChoice(profile: ProfileView): DeviceProfile {
	return {
		id: profile.id,
		name: profile.name,
		kind: isAgentProfile(profile) ? "agent" : "model",
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
		settingsFor(id) {
			const found = profiles().get(id);
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
			const updatedAt = Date.now();
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
