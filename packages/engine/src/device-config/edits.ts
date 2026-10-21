import { HARNESS_LABELS } from "@nightshift/agents/harness-facts";
import {
	type AgentHarnessName,
	type AgentProfile,
	type CustomAgent,
	customAgentSchema,
	customAgentSlug,
	type HarnessName,
	isCustomHarness,
} from "@nightshift/flows";

import type { CliToolStore } from "./cli-tools";
import type {
	Connection,
	ConnectionInput,
	ConnectionStore,
} from "./connections";
import type { ProfileStore, ProfileView } from "./profiles";
import type { SettingsStore } from "./settings";

/**
 * The edits of this computer's configuration that touch more than one store:
 * a profile names connections and CLI tools, a rename or a removal changes
 * the profiles that name it, and the harnesses are settings. Each function
 * checks, then writes, in one fixed order. The API's procedures call them.
 */

/** The stores of the configuration, as the API's context holds them. */
export type ConfigStores = {
	settings: SettingsStore;
	connections: ConnectionStore;
	cliTools: CliToolStore;
	profiles: ProfileStore;
};

/** The custom agent of that flow name on this computer, or undefined. */
export function customAgentOf(
	agents: readonly CustomAgent[],
	name: string,
): CustomAgent | undefined {
	return isCustomHarness(name)
		? agents.find((a) => a.slug === customAgentSlug(name))
		: undefined;
}

/**
 * Adds a profile, or changes or renames one (`previousName`). Refused when
 * the name is taken, when flows use the old name of a rename, or when it
 * names a connection or a CLI tool that does not exist.
 */
export async function saveProfile(
	stores: Pick<ConfigStores, "connections" | "cliTools" | "profiles">,
	profile: AgentProfile,
	options: {
		previousName?: string;
		/** The flows that name a profile, read only for a rename. */
		flowsUsing(name: string): Promise<readonly { flowName: string }[]>;
	},
): Promise<ProfileView> {
	const { previousName } = options;
	const renamed = previousName !== undefined && previousName !== profile.name;
	if (
		(previousName === undefined || renamed) &&
		stores.profiles.get(profile.name)
	) {
		throw new Error(
			`A profile named "${profile.name}" already exists. Pick another name.`,
		);
	}
	if (renamed) {
		const use = await options.flowsUsing(previousName);
		if (use.length > 0) {
			throw new Error(
				`The flows ${use.map((u) => u.flowName).join(", ")} use "${previousName}". Change it there first, or keep the name.`,
			);
		}
	}
	const unknown = profile.connections.filter(
		(name) => !stores.connections.get(name),
	);
	if (unknown.length > 0) {
		throw new Error(
			`There is no connection named ${unknown.map((n) => `"${n}"`).join(", ")}. Add it under Agents → Tools first.`,
		);
	}
	const unknownClis = profile.clis.filter((name) => !stores.cliTools.get(name));
	if (unknownClis.length > 0) {
		throw new Error(
			`There is no CLI tool named ${unknownClis.map((n) => `"${n}"`).join(", ")}. Add it under Agents → Tools first.`,
		);
	}
	const saved = await stores.profiles.save(profile);
	if (renamed) await stores.profiles.remove(previousName);
	return saved;
}

/** Saves every profile that `pick` changes, in the order of the list. */
async function rewriteProfiles(
	profiles: ProfileStore,
	pick: (profile: ProfileView) => Partial<AgentProfile> | null,
): Promise<void> {
	for (const p of profiles.list()) {
		const change = pick(p);
		if (!change) continue;
		const { updatedAt: _at, ...profile } = p;
		await profiles.save({ ...profile, ...change });
	}
}

/**
 * Adds a connection, or changes or renames one (`previousName`). A rename
 * moves the profiles that name the old name to the new one.
 */
export async function saveConnection(
	stores: Pick<ConfigStores, "connections" | "profiles">,
	connection: ConnectionInput,
	previousName?: string,
): Promise<Connection> {
	if (
		previousName !== connection.name &&
		stores.connections.get(connection.name)
	) {
		throw new Error(
			`A connection named "${connection.name}" already exists. Pick another name.`,
		);
	}
	const saved = await stores.connections.save(connection);
	if (previousName && previousName !== connection.name) {
		await stores.connections.remove(previousName);
		await rewriteProfiles(stores.profiles, (p) =>
			p.connections.includes(previousName)
				? {
						connections: p.connections.map((c) =>
							c === previousName ? connection.name : c,
						),
					}
				: null,
		);
	}
	return saved;
}

/** Removes a connection, and takes it off the profiles that name it. */
export async function removeConnection(
	stores: Pick<ConfigStores, "connections" | "profiles">,
	name: string,
): Promise<void> {
	await stores.connections.remove(name);
	await rewriteProfiles(stores.profiles, (p) =>
		p.connections.includes(name)
			? { connections: p.connections.filter((c) => c !== name) }
			: null,
	);
}

/** Removes a CLI tool, and takes it off the profiles that name it. */
export async function removeCliTool(
	stores: Pick<ConfigStores, "cliTools" | "profiles">,
	name: string,
): Promise<void> {
	await stores.cliTools.remove(name);
	await rewriteProfiles(stores.profiles, (p) =>
		p.clis.includes(name) ? { clis: p.clis.filter((c) => c !== name) } : null,
	);
}

/** Adds a built-in harness. Nothing changes when it is added already. */
export async function addHarness(
	stores: Pick<ConfigStores, "settings">,
	harness: HarnessName,
): Promise<void> {
	const added = stores.settings.current().harnesses;
	if (added.includes(harness)) return;
	await stores.settings.save({ harnesses: [...added, harness] });
}

/**
 * Removes a harness, or a custom agent for good. Refused while a profile
 * runs on it.
 */
export async function removeHarness(
	stores: Pick<ConfigStores, "settings" | "profiles">,
	harness: AgentHarnessName,
): Promise<void> {
	const values = stores.settings.current();
	const custom = customAgentOf(values.customAgents, harness);
	const label = isCustomHarness(harness)
		? (custom?.label ?? harness)
		: HARNESS_LABELS[harness];
	const using = stores.profiles
		.list()
		.filter((p) => p.harness === harness)
		.map((p) => p.name);
	if (using.length > 0) {
		throw new Error(
			`The ${using.length === 1 ? "profile" : "profiles"} ${using.join(", ")} run on ${label}. Move ${using.length === 1 ? "it" : "them"} to another harness first.`,
		);
	}
	if (isCustomHarness(harness)) {
		await stores.settings.save({
			customAgents: values.customAgents.filter((a) => a !== custom),
		});
		return;
	}
	await stores.settings.save({
		harnesses: values.harnesses.filter((h) => h !== harness),
	});
}

/**
 * Adds a custom agent, or changes one (`previousSlug`). Its slug, the name
 * flows use, never changes: a flow that names it keeps working.
 */
export async function saveCustomAgent(
	stores: Pick<ConfigStores, "settings">,
	agent: CustomAgent,
	previousSlug?: string,
): Promise<CustomAgent> {
	const agents = stores.settings.current().customAgents;
	if (previousSlug === undefined) {
		if (agents.some((a) => a.slug === agent.slug)) {
			throw new Error(
				`A custom agent named acp:${agent.slug} already exists. Pick another name.`,
			);
		}
		await stores.settings.save({ customAgents: [...agents, agent] });
		return customAgentSchema.parse(agent);
	}
	if (!agents.some((a) => a.slug === previousSlug)) {
		throw new Error("This custom agent was removed. Add it again.");
	}
	const saved = customAgentSchema.parse({ ...agent, slug: previousSlug });
	await stores.settings.save({
		customAgents: agents.map((a) => (a.slug === previousSlug ? saved : a)),
	});
	return saved;
}
