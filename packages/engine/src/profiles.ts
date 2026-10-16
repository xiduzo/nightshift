import type { Database } from "@nightshift/db";
import { agentProfile } from "@nightshift/db/schema/nightshift";
import {
	type AgentProfile,
	type AgentProfileSettings,
	agentProfileSchema,
	agentProfileSettingsSchema,
} from "@nightshift/flows";
import { eq, sql } from "drizzle-orm";

/**
 * Agent Profiles: a harness, a model and its tools under one name, defined
 * once on this daemon (the Agents page). Agent nodes name a profile; a run
 * resolves it when it starts.
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

export function createProfileStore(options: { db: Database }): ProfileStore {
	const { db } = options;
	const profiles = new Map<string, ProfileView>();

	return {
		async load() {
			profiles.clear();
			for (const row of await db.select().from(agentProfile)) {
				const parsed = agentProfileSettingsSchema.safeParse(
					safeJson(row.settings),
				);
				// A row this version cannot read stays in the database, unused.
				if (!parsed.success) continue;
				profiles.set(row.name, {
					...parsed.data,
					name: row.name,
					...(row.description ? { description: row.description } : {}),
					updatedAt: row.updatedAt.getTime(),
				});
			}
		},
		list: () =>
			[...profiles.values()].sort((a, b) => a.name.localeCompare(b.name)),
		get: (name) => profiles.get(name) ?? null,
		settingsFor(name) {
			const found = profiles.get(name);
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
			const json = JSON.stringify(settings);
			const [row] = await db
				.insert(agentProfile)
				.values({ name, description: description || null, settings: json })
				.onConflictDoUpdate({
					target: agentProfile.name,
					set: {
						description: description || null,
						settings: json,
						updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`,
					},
				})
				.returning();
			const saved: ProfileView = {
				...settings,
				name,
				...(description ? { description } : {}),
				updatedAt: row?.updatedAt.getTime() ?? Date.now(),
			};
			profiles.set(name, saved);
			return saved;
		},
		async remove(name) {
			await db.delete(agentProfile).where(eq(agentProfile.name, name));
			profiles.delete(name);
		},
	};
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
