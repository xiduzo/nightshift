import {
	type AgentProfile,
	type AgentProfileSettings,
	agentProfileSchema,
	agentProfileSettingsSchema,
	migrateToolSets,
} from "@nightshift/flows";
import { z } from "zod";

import { type DeviceDocument, mapView } from "./device/document";

/**
 * Agent Profiles: a harness, a model and its tools under one name, defined
 * once on this Device (the Agents page) and kept in its Device document.
 * Agent nodes name a profile; a run resolves it when it starts.
 */

export type ProfileView = AgentProfile & { updatedAt: number };

export type ProfileStore = {
	/** Reads the profiles. Call once before the rest. */
	load(): Promise<void>;
	list(): ProfileView[];
	get(name: string): ProfileView | null;
	/** What a run resolves a node with, or null when there is no such profile. */
	settingsFor(name: string): AgentProfileSettings | null;
	/** Creates or replaces a profile. */
	save(input: AgentProfile): Promise<ProfileView>;
	remove(name: string): Promise<void>;
};

/** A profile as the Device document holds it. */
const entrySchema = z.object({
	description: z.string().nullable(),
	settings: z.unknown(),
	updatedAt: z.number(),
});

export function createProfileStore(options: {
	document: DeviceDocument;
}): ProfileStore {
	const { document } = options;
	const profiles = mapView(document.profiles, () => {
		const out = new Map<string, ProfileView>();
		for (const [name, value] of document.profiles.entries()) {
			const entry = entrySchema.safeParse(value);
			if (!entry.success) continue;
			// A profile saved with the GitHub tool set reads as one with `gh`.
			const parsed = agentProfileSettingsSchema.safeParse(
				migrateToolSets(entry.data.settings),
			);
			// An entry this version cannot read stays in the document, unused.
			if (!parsed.success) continue;
			out.set(name, {
				...parsed.data,
				name,
				...(entry.data.description
					? { description: entry.data.description }
					: {}),
				updatedAt: entry.data.updatedAt,
			});
		}
		return out;
	});

	return {
		// The document is read when it opens; a remote edit applies at once.
		async load() {},
		list: () =>
			[...profiles().values()].sort((a, b) => a.name.localeCompare(b.name)),
		get: (name) => profiles().get(name) ?? null,
		settingsFor(name) {
			const found = profiles().get(name);
			if (!found) return null;
			const {
				name: _name,
				description: _description,
				updatedAt: _at,
				...settings
			} = found;
			return settings;
		},
		async save(input) {
			const { name, description, ...settings } =
				agentProfileSchema.parse(input);
			const updatedAt = Date.now();
			await document.change(() => {
				document.profiles.set(name, {
					description: description || null,
					settings,
					updatedAt,
				});
			});
			return {
				...settings,
				name,
				...(description ? { description } : {}),
				updatedAt,
			};
		},
		async remove(name) {
			await document.change(() => {
				document.profiles.delete(name);
			});
		},
	};
}
