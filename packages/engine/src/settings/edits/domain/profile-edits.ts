import {
	type AgentHarnessName,
	type AgentProfile,
	type CustomAgent,
	customAgentSchema,
	customAgentSlug,
	HARNESS_CATALOG,
	type HarnessName,
	isAgentProfile,
	isCustomHarness,
	modelAddressProblem,
	type Profile,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

/** A saved profile, as the profiles give it: its id never changes. */
export type ProfileView = Profile & { id: string; updatedAt: number };

/**
 * The edits of this computer's configuration that touch more than one of
 * its parts: a profile names connections and CLI tools, a rename or a
 * removal changes the profiles that name it, and the harnesses are
 * settings. Each step checks, then writes, in one fixed order. Each takes
 * the parts it reads and writes as functions: the use cases give their
 * ports, and the guided setups give the stores.
 */

/** The profiles, as an edit reads and saves them. */
export type ProfileBook = {
	get(id: string): ProfileView | null;
	/** The profile with that name, as a flow names it. */
	byName(name: string): ProfileView | null;
	/** By name, then by id. */
	list(): ProfileView[];
	/** Adds a profile, or replaces the one of `id`. A rename keeps the id. */
	save(input: Profile, id?: string): Promise<ProfileView>;
};

/** The connections or the CLI tools, as an edit asks whether one exists. */
export type NamedTools = { get(name: string): unknown };

/** The settings an edit of the harnesses reads and saves. */
export type HarnessBook = {
	current(): {
		harnesses: HarnessName[];
		customAgents: CustomAgent[];
		agentPermissionMode: AgentProfile["permissionMode"];
	};
	save(patch: {
		harnesses?: HarnessName[];
		customAgents?: CustomAgent[];
	}): Promise<unknown>;
};

export const PROFILE_REMOVED = "This profile was removed. Add it again.";
export const CUSTOM_AGENT_REMOVED =
	"This custom agent was removed. Add it again.";

export function profileNameTaken(name: string): string {
	return `A profile named "${name}" already exists. Pick another name.`;
}

export function noConnectionsNamed(names: readonly string[]): string {
	return `There is no connection named ${names.map((n) => `"${n}"`).join(", ")}. Add it under Agents → Tools first.`;
}

export function noCliToolsNamed(names: readonly string[]): string {
	return `There is no CLI tool named ${names.map((n) => `"${n}"`).join(", ")}. Add it under Agents → Tools first.`;
}

export function customAgentTaken(slug: string): string {
	return `A custom agent named acp:${slug} already exists. Pick another name.`;
}

export function harnessInUse(using: readonly string[], label: string): string {
	return `The ${using.length === 1 ? "profile" : "profiles"} ${using.join(", ")} run on ${label}. Move ${using.length === 1 ? "it" : "them"} to another harness first.`;
}

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
 * Adds a profile, or changes or renames the one of `id`. A rename changes
 * the name only: the id stays. Refused when the name is taken, when the
 * profile of `id` is gone, when flows use the old name of a rename, or
 * when an Agent Profile names a connection or a CLI tool that does not
 * exist.
 */
export async function saveProfile(
	stores: {
		connections: NamedTools;
		cliTools: NamedTools;
		profiles: ProfileBook;
	},
	profile: Profile,
	options: {
		id?: string;
	} = {},
): Promise<ProfileView> {
	const { id } = options;
	const current = id === undefined ? null : stores.profiles.get(id);
	if (id !== undefined && !current) {
		throw new Refusal("not-found", PROFILE_REMOVED);
	}
	const taken = stores.profiles.byName(profile.name);
	if (taken && taken.id !== id) {
		throw new Refusal("conflict", profileNameTaken(profile.name));
	}
	const unknown = (isAgentProfile(profile) ? profile.connections : []).filter(
		(name) => !stores.connections.get(name),
	);
	if (unknown.length > 0) {
		throw new Refusal("conflict", noConnectionsNamed(unknown));
	}
	const unknownClis = (isAgentProfile(profile) ? profile.clis : []).filter(
		(name) => !stores.cliTools.get(name),
	);
	if (unknownClis.length > 0) {
		throw new Refusal("conflict", noCliToolsNamed(unknownClis));
	}
	const misfit = isAgentProfile(profile) ? null : modelAddressProblem(profile);
	if (misfit !== null) throw new Refusal("invalid", misfit);
	return stores.profiles.save(profile, id);
}

/** Saves every Agent Profile that `pick` changes, in the order of the list. */
export async function rewriteProfiles(
	profiles: Pick<ProfileBook, "list" | "save">,
	pick: (profile: AgentProfile) => Partial<AgentProfile> | null,
): Promise<void> {
	for (const p of profiles.list()) {
		if (!isAgentProfile(p)) continue;
		const change = pick(p);
		if (!change) continue;
		const { id, updatedAt: _at, ...profile } = p;
		await profiles.save({ ...profile, ...change }, id);
	}
}

/** Adds a built-in harness. Nothing changes when it is added already. */
export async function addHarness(
	stores: { settings: HarnessBook },
	harness: HarnessName,
): Promise<void> {
	const added = stores.settings.current().harnesses;
	if (added.includes(harness)) return;
	await stores.settings.save({ harnesses: [...added, harness] });
}

/**
 * Removes a harness, or a custom agent for good. Refused while a profile
 * runs on it. `labels` are what a person calls each built-in harness.
 */
export async function removeHarness(
	stores: { settings: HarnessBook; profiles: Pick<ProfileBook, "list"> },
	harness: AgentHarnessName,
	labels: Readonly<Record<HarnessName, string>>,
): Promise<void> {
	const values = stores.settings.current();
	const custom = customAgentOf(values.customAgents, harness);
	const label = isCustomHarness(harness)
		? (custom?.label ?? harness)
		: labels[harness];
	const using = stores.profiles
		.list()
		.filter((p) => isAgentProfile(p) && p.harness === harness)
		.map((p) => p.name);
	if (using.length > 0) {
		throw new Refusal("conflict", harnessInUse(using, label));
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
	stores: { settings: HarnessBook },
	agent: CustomAgent,
	previousSlug?: string,
): Promise<CustomAgent> {
	const agents = stores.settings.current().customAgents;
	if (previousSlug === undefined) {
		if (agents.some((a) => a.slug === agent.slug)) {
			throw new Refusal("conflict", customAgentTaken(agent.slug));
		}
		await stores.settings.save({ customAgents: [...agents, agent] });
		return customAgentSchema.parse(agent);
	}
	if (!agents.some((a) => a.slug === previousSlug)) {
		throw new Refusal("not-found", CUSTOM_AGENT_REMOVED);
	}
	const saved = customAgentSchema.parse({ ...agent, slug: previousSlug });
	await stores.settings.save({
		customAgents: agents.map((a) => (a.slug === previousSlug ? saved : a)),
	});
	return saved;
}

/**
 * Adds the harness, and an Agent Profile on it named after its program,
 * with the harness's default model and the night's permission mode. A
 * harness that has a profile keeps it: no second one is made. Setting up a
 * found program and the guided setup of an agent (ADR 25) both end here.
 */
export async function agentProfileOn(
	stores: {
		settings: HarnessBook;
		profiles: ProfileBook;
		connections: NamedTools;
		cliTools: NamedTools;
	},
	harness: HarnessName,
	program: string,
): Promise<{ id: string; name: string }> {
	await addHarness(stores, harness);
	const existing = stores.profiles
		.list()
		.find((p) => isAgentProfile(p) && p.harness === harness);
	if (existing) return { id: existing.id, name: existing.name };
	const profile = await saveProfile(stores, {
		name: freeProfileName(stores.profiles, program),
		harness,
		model: HARNESS_CATALOG[harness].defaultModel,
		permissionMode: stores.settings.current().agentPermissionMode,
		clis: [],
		connections: [],
	});
	return { id: profile.id, name: profile.name };
}

export function everyNameTaken(base: string): string {
	return `Every profile name for ${base} is taken. Add the profile yourself.`;
}

/** A profile name from the program's file name (`claude`), with a number when it is taken. */
export function freeProfileName(
	profiles: Pick<ProfileBook, "byName">,
	program: string,
): string {
	const file = program.split(/[\\/]/).at(-1) ?? program;
	const base =
		file
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, "_")
			.replace(/^[^a-z]+/, "")
			.slice(0, 36) || "agent";
	if (!profiles.byName(base)) return base;
	for (let n = 2; n < 100; n++) {
		const name = `${base}_${n}`;
		if (!profiles.byName(name)) return name;
	}
	throw new Refusal("conflict", everyNameTaken(base));
}
