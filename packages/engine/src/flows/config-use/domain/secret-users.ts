import {
	isAgentProfile,
	type Profile,
	profileSecrets,
} from "@nightshift/flows";
import type { PersonActor } from "../../../contract";
import { type FlowRef, type FlowUse, profileUseKey } from "./flow-use";

/**
 * The one rule of what uses a secret, and what each list of this
 * computer's configuration shares. Each list then keeps the uses that read
 * its scope (ADR 13, 18): this computer's list leaves out the flows whose
 * project or Space has the name.
 */

/** Who asks, in which Space: the Space's flows and secrets as that Person sees them. */
export type Asker = { spaceId: string; actor: PersonActor };

/** Whose secrets: a project's, or the Space's (ADR 18). */
export type SecretOwner = { projectId: string } | "space";

/** A connection of this computer, by the secrets its variables read. */
export type ConnectionNames = {
	name: string;
	variables: readonly { name: string }[];
};

/** A CLI tool of this computer, by the secrets its login reads. */
export type ToolNames = { name: string; logins: readonly string[] };

/** A profile of this computer, by its id. */
export type ProfileNames = Profile & { id: string };

/** What uses one secret, before any scope. */
export type SecretUsersOf = {
	/** The flows that use it, each once. */
	flows: FlowRef[];
	/** The CLI tools of this computer whose logins read it. */
	tools: readonly string[];
	/** The flows a webhook schedule with it starts. */
	webhooks: readonly FlowRef[];
};

/**
 * The one rule of what uses a secret. A flow uses it when it, or a flow or
 * kit it calls, names it in a node, or names a Model Profile of this
 * computer whose address reads it, or a Connection or a CLI tool of this
 * computer that reads it. A flow uses a Connection or a CLI tool when it
 * names it, or names an Agent Profile of this computer that names it.
 * `named`: every name something here uses, for the secret store.
 */
export function secretUsers(
	here: {
		deviceId: string;
		connections: readonly ConnectionNames[];
		tools: readonly ToolNames[];
		profiles: readonly ProfileNames[];
	},
	use: FlowUse,
): { named: string[]; of(name: string): SecretUsersOf } {
	const through = useThroughProfiles(here.profiles, use, here.deviceId);
	const connectionsBySecret: FlowsByName = new Map();
	for (const connection of here.connections) {
		const flows = [
			...(use.connections.get(connection.name) ?? []),
			...(through.connections.get(connection.name) ?? []),
		];
		const names = new Set(connection.variables.map((v) => v.name));
		for (const name of names) add(connectionsBySecret, name, flows);
	}
	const toolsBySecret = new Map<string, string[]>();
	const toolFlows: FlowsByName = new Map();
	for (const tool of here.tools) {
		const flows = [
			...(use.clis.get(tool.name) ?? []),
			...(through.clis.get(tool.name) ?? []),
		];
		for (const name of tool.logins) {
			toolsBySecret.set(name, [...(toolsBySecret.get(name) ?? []), tool.name]);
			add(toolFlows, name, flows);
		}
	}
	return {
		named: [
			...use.secrets.keys(),
			...through.secrets.keys(),
			...use.webhooks.keys(),
			...toolsBySecret.keys(),
		],
		of: (name) => ({
			flows: eachOnce([
				...(use.secrets.get(name) ?? []),
				...(through.secrets.get(name) ?? []),
				...(connectionsBySecret.get(name) ?? []),
				...(toolFlows.get(name) ?? []),
			]),
			tools: toolsBySecret.get(name) ?? [],
			webhooks: use.webhooks.get(name) ?? [],
		}),
	};
}

/**
 * What the profiles of this computer (`deviceId`) add to `use`: by name,
 * the flows that use each connection and CLI tool through an Agent
 * Profile that names it, and the flows that use each secret through a
 * Model Profile whose address reads it. A flow uses a profile when it
 * names it, or a flow or kit it calls does (`FlowUse.profileFlows`).
 */
function useThroughProfiles(
	profiles: readonly ProfileNames[],
	use: Pick<FlowUse, "profileFlows">,
	deviceId: string,
): {
	connections: ReadonlyMap<string, readonly FlowRef[]>;
	clis: ReadonlyMap<string, readonly FlowRef[]>;
	secrets: ReadonlyMap<string, readonly FlowRef[]>;
} {
	const connections: FlowsByName = new Map();
	const clis: FlowsByName = new Map();
	const secrets: FlowsByName = new Map();
	for (const profile of profiles) {
		const flows =
			use.profileFlows.get(profileUseKey(deviceId, profile.id)) ?? [];
		if (isAgentProfile(profile)) {
			for (const name of profile.connections) add(connections, name, flows);
			for (const name of profile.clis) add(clis, name, flows);
		}
		for (const name of profileSecrets(profile)) add(secrets, name, flows);
	}
	return { connections, clis, secrets };
}

/**
 * The names of the secrets each step of a project's runs can read: the
 * project's and its Space's (ADR 18). Null: they cannot be read now. The
 * Space's names are read once, at the first project.
 */
export function sharedNames(read: {
	space(): Promise<readonly { name: string }[]>;
	project(projectId: string): Promise<readonly { name: string }[]>;
}): (projectId: string) => Promise<ReadonlySet<string> | null> {
	let space: Promise<readonly { name: string }[] | null> | undefined;
	return async (projectId) => {
		space ??= read.space().then(
			(names) => names,
			() => null,
		);
		const project = await read.project(projectId).then(
			(names) => names,
			() => null,
		);
		const shared = await space;
		if (project === null || shared === null) return null;
		return new Set([...project, ...shared].map((secret) => secret.name));
	};
}

/**
 * The shared names of each project of `flows` (`sharedNames`). A project
 * whose names cannot be read now covers nothing: its flows stay listed.
 */
export async function coverage(
	namesOf: (projectId: string) => Promise<ReadonlySet<string> | null>,
	flows: readonly FlowRef[],
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
	const projectIds = new Set(flows.map((flow) => flow.projectId));
	return new Map(
		await Promise.all(
			[...projectIds].map(
				async (id) => [id, (await namesOf(id)) ?? new Set<string>()] as const,
			),
		),
	);
}

/** The Agent Profiles whose `pick` names it. */
export function profilesNaming(
	profiles: readonly ProfileNames[],
	pick: (profile: { connections: string[]; clis: string[] }) => string[],
	name: string,
): string[] {
	return profiles
		.filter((p) => isAgentProfile(p) && pick(p).includes(name))
		.map((p) => p.name);
}

/** The flows of each name, in a map that `add` fills. */
type FlowsByName = Map<string, FlowRef[]>;

/** Adds `flows` to those of `name`: a name without flows stays out. */
function add(map: FlowsByName, name: string, flows: readonly FlowRef[]): void {
	if (flows.length > 0) map.set(name, [...(map.get(name) ?? []), ...flows]);
}

/** Each flow once, in its first place. */
function eachOnce(flows: readonly FlowRef[]): FlowRef[] {
	const seen = new Set<string>();
	return flows.filter((flow) => {
		const key = JSON.stringify([flow.projectId, flow.flowName]);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
