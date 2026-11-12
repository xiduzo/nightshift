import { isAgentProfile, profileSecrets } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import { loginReferences, type ToolLaunchers } from "../device";
import type {
	CliTool,
	CliToolStore,
	Connection,
	ConnectionStore,
	ProfileStore,
	ProfileView,
	ProjectSecretName,
	SecretList,
	SecretView,
} from "../device-config";
import {
	type FlowReader,
	type FlowRef,
	type FlowUse,
	flowUse,
	profileUseKey,
} from "./flow-use";

/**
 * What uses a name of this computer's configuration, in the flows of a
 * Space: a secret, a Connection, a CLI tool or a profile. The "Used by" of
 * this computer's Secrets, Connections, CLI tools and profiles, and of the
 * Secrets of a project and of the Space. It reads the Space's flows itself
 * (`flowUse`) and knows this Device: a flow uses a profile of this computer
 * when it names the profile with this Device's id.
 *
 * One rule says what uses a secret of a project or of the Space
 * (`secretUsers`). This computer's list counts the flows that name a
 * secret or a Model Profile that reads it, and names the connections and
 * CLI tools that read it. It leaves out the flows whose project or Space
 * has the name (ADR 13, 18).
 */

/** Who asks, in which Space: the Space's flows and secrets as that Person sees them. */
export type Asker = { spaceId: string; personId: string };

/** What the module reads: this computer's Device and configuration, and a Space's flows. */
export type ConfigUseDeps = {
	/** This computer's Device id: the profiles flows name with it are this computer's. */
	deviceId: string;
	/** A Space as `at` sees it: its projects, their flows and schedules. */
	space(at: Asker): FlowReader;
	connections: Pick<
		ConnectionStore,
		"list" | "secrets" | "projectSecrets" | "spaceSecrets"
	>;
	cliTools: Pick<CliToolStore, "list">;
	profiles: Pick<ProfileStore, "list">;
	toolLaunchers: Pick<ToolLaunchers, "signedInAt">;
};

/** A connection, with the flows and the profiles that name it. */
export type ConnectionInUse = Connection & {
	usedBy: FlowRef[];
	profiles: string[];
};

/**
 * A secret of this computer or the Person's, with what uses it here.
 * `usedBy` holds the connections that read it.
 */
export type SecretInUse = SecretView & {
	/** The flows that use it through their nodes, or a Model Profile of this computer. */
	flows: FlowRef[];
	/** The CLI tools whose logins read it. */
	tools: string[];
	/** The flows a webhook schedule with this secret starts. */
	webhooks: FlowRef[];
};

/** Where a tool's login finds its secrets. */
export type CliToolLoginState = {
	/** This computer or the Personal secrets have every value: Sign in works here. */
	signsInHere: boolean;
	/** The projects that keep the values it does not have here. */
	projects: {
		projectId: string;
		projectName: string;
		/** When it last signed in for this project. Null: not yet, or it has no sign-in. */
		signedInAt: number | null;
	}[];
	/** The secrets with no value it can use. Empty when one could not be read now. */
	missing: string[];
};

/** A CLI tool, with the flows and the profiles that name it, and when its login last signed in. */
export type CliToolInUse = CliTool & {
	usedBy: FlowRef[];
	profiles: string[];
	signedInAt: number | null;
	/** Null: the tool has no login. */
	loginState: CliToolLoginState | null;
};

/** A profile of this computer, with the nodes that name it. */
export type ProfileInUse = ProfileView & {
	usedBy: (FlowRef & { nodeIds: string[] })[];
};

/** A secret of a project or of the Space, with what uses it, by name. */
export type SharedSecretInUse = ProjectSecretName & {
	/** The flows that use it (`secretUsers`): of the project, for a project's secret. */
	flows: string[];
	/** The CLI tools of this computer whose logins read it. */
	tools: string[];
	/** The flows a webhook schedule with this secret starts. */
	webhooks: string[];
};

/** Whose secrets: a project's, or the Space's (ADR 18). */
export type SecretOwner = { projectId: string } | "space";

/** What uses this computer's configuration and the Space's secrets, for a Person in a Space. */
export type ConfigUse = {
	/**
	 * This computer's connections, and the secrets of this computer and of
	 * its Person (Personal), with what uses each. `personal` says whether
	 * the Personal secrets could be read now.
	 */
	connections(at: Asker): Promise<{
		connections: ConnectionInUse[];
		secrets: SecretInUse[];
		personal: SecretList["personal"];
	}>;
	/** This computer's CLI tools, with what uses each and where each login finds its secrets. */
	cliTools(at: Asker): Promise<CliToolInUse[]>;
	/** This computer's profiles, with the nodes that name each. */
	profiles(at: Asker): Promise<ProfileInUse[]>;
	/**
	 * The secrets of a project or of the Space, with what uses each. Null:
	 * the Host that keeps the Space cannot be reached now, or is older.
	 */
	sharedSecrets(
		at: Asker,
		owner: SecretOwner,
	): Promise<SharedSecretInUse[] | null>;
};

export function createConfigUse(deps: ConfigUseDeps): ConfigUse {
	return {
		async connections(at) {
			const use = await flowUse(deps.space(at));
			const users = secretUsers(deps, use);
			const through = useThroughProfiles(deps.profiles, use, deps.deviceId);
			/** The flows that name it in a node, or name a Model Profile that reads it. */
			const named = (name: string) =>
				eachOnce([
					...(use.secrets.get(name) ?? []),
					...(through.secrets.get(name) ?? []),
				]);
			const toolFlows = (tool: string) => [
				...(use.clis.get(tool) ?? []),
				...(through.clis.get(tool) ?? []),
			];
			const listed = await deps.connections.secrets(users.named);
			const rows = listed.secrets.map((secret) => ({
				secret,
				of: users.of(secret.name),
			}));
			const covers = await coverage(
				sharedNames(deps, at),
				rows.flatMap(({ secret, of }) => [
					...named(secret.name),
					...of.webhooks,
					...of.tools.flatMap(toolFlows),
				]),
			);
			const secrets: SecretInUse[] = [];
			for (const { secret, of } of rows) {
				// A flow whose project or Space has the name reads that value.
				const covered = (flow: FlowRef) =>
					covers.get(flow.projectId)?.has(secret.name) === true;
				const flows = named(secret.name).filter((flow) => !covered(flow));
				const webhooks = of.webhooks.filter((flow) => !covered(flow));
				// A tool stays while no flow is known to use it or the name, or one
				// that does needs this value.
				const tools = of.tools.filter((tool) => {
					const users = [...toolFlows(tool), ...named(secret.name)];
					return users.length === 0 || !users.every(covered);
				});
				const needed =
					secret.saved ||
					secret.inEnv ||
					secret.usedBy.length > 0 ||
					tools.length > 0 ||
					flows.length > 0 ||
					webhooks.length > 0;
				if (needed) secrets.push({ ...secret, flows, tools, webhooks });
			}
			return {
				// After the secrets: a connection's variables read the Personal names as listed now.
				connections: deps.connections.list().map((c) => ({
					...c,
					usedBy: use.connections.get(c.name) ?? [],
					profiles: profilesNaming(deps.profiles, (p) => p.connections, c.name),
				})),
				secrets,
				personal: listed.personal,
			};
		},

		async cliTools(at) {
			const space = deps.space(at);
			const use = await flowUse(space);
			const tools = deps.cliTools.list();
			const references = tools.flatMap((tool) =>
				tool.login ? loginReferences(tool.login) : [],
			);
			const listed =
				references.length > 0
					? await deps.connections.secrets(references)
					: null;
			const here = new Set(
				(listed?.secrets ?? []).flatMap((secret) =>
					secret.saved || secret.inEnv ? [secret.name] : [],
				),
			);
			const namesOf = sharedNames(deps, at);
			const kept =
				references.length > 0
					? await Promise.all(
							(await space.listProjects()).map(async (project) => ({
								project,
								names: await namesOf(project.id),
							})),
						)
					: [];
			const unknown =
				listed?.personal === "unavailable" ||
				kept.some(({ names }) => names === null);

			async function loginStateOf(
				tool: CliTool,
			): Promise<CliToolLoginState | null> {
				if (!tool.login) return null;
				const signs = tool.login.signIn !== undefined;
				const wanted = loginReferences(tool.login);
				const notHere = wanted.filter((name) => !here.has(name));
				const projectRows = await Promise.all(
					kept.flatMap(({ project, names }) =>
						names !== null &&
						wanted.some((name) => names.has(name)) &&
						notHere.every((name) => names.has(name))
							? [
									(async () => ({
										projectId: project.id,
										projectName: project.name,
										signedInAt: signs
											? await deps.toolLaunchers.signedInAt(
													tool.name,
													project.id,
												)
											: null,
									}))(),
								]
							: [],
					),
				);
				return {
					signsInHere:
						notHere.length === 0 || (unknown && projectRows.length === 0),
					projects: projectRows,
					missing: !unknown && projectRows.length === 0 ? notHere : [],
				};
			}

			return Promise.all(
				tools.map(async (tool) => ({
					...tool,
					usedBy: use.clis.get(tool.name) ?? [],
					profiles: profilesNaming(deps.profiles, (p) => p.clis, tool.name),
					signedInAt: tool.login?.signIn
						? await deps.toolLaunchers.signedInAt(tool.name)
						: null,
					loginState: await loginStateOf(tool),
				})),
			);
		},

		async profiles(at) {
			const use = await flowUse(deps.space(at));
			return deps.profiles.list().map((p) => ({
				...p,
				usedBy: use.profiles.get(profileUseKey(deps.deviceId, p.id)) ?? [],
			}));
		},

		async sharedSecrets(at, owner) {
			let listed: ProjectSecretName[];
			try {
				listed =
					owner === "space"
						? await deps.connections.spaceSecrets(at.spaceId, at.personId)
						: await deps.connections.projectSecrets(
								{ spaceId: at.spaceId, projectId: owner.projectId },
								at.personId,
							);
			} catch (error) {
				if (error instanceof Refusal && error.kind === "unavailable") {
					return null;
				}
				throw error;
			}
			const users = secretUsers(deps, await flowUse(deps.space(at)));
			/** The names of the flows, each once and sorted: of the project, for a project's secret. */
			const names = (flows: readonly FlowRef[]) =>
				[
					...new Set(
						flows
							.filter(
								(flow) =>
									owner === "space" || flow.projectId === owner.projectId,
							)
							.map((flow) => flow.flowName),
					),
				].sort();
			return listed.map((secret) => {
				const of = users.of(secret.name);
				return {
					...secret,
					flows: names(of.flows),
					tools: [...of.tools].sort(),
					webhooks: names(of.webhooks),
				};
			});
		},
	};
}

/** What uses one secret, before any scope. */
type SecretUsersOf = {
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
function secretUsers(
	deps: Pick<
		ConfigUseDeps,
		"deviceId" | "connections" | "cliTools" | "profiles"
	>,
	use: FlowUse,
): { named: string[]; of(name: string): SecretUsersOf } {
	const through = useThroughProfiles(deps.profiles, use, deps.deviceId);
	const connectionsBySecret: FlowsByName = new Map();
	for (const connection of deps.connections.list()) {
		const flows = [
			...(use.connections.get(connection.name) ?? []),
			...(through.connections.get(connection.name) ?? []),
		];
		const names = new Set(connection.variables.map((v) => v.name));
		for (const name of names) add(connectionsBySecret, name, flows);
	}
	const toolsBySecret = new Map<string, string[]>();
	const toolFlows: FlowsByName = new Map();
	for (const tool of deps.cliTools.list()) {
		const flows = [
			...(use.clis.get(tool.name) ?? []),
			...(through.clis.get(tool.name) ?? []),
		];
		for (const name of tool.login ? loginReferences(tool.login) : []) {
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
	profiles: Pick<ProfileStore, "list">,
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
	for (const profile of profiles.list()) {
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
 * project's and its Space's (ADR 18), as `at` sees them. Null: they cannot
 * be read now. The Space's names are read once.
 */
function sharedNames(
	deps: Pick<ConfigUseDeps, "connections">,
	at: Asker,
): (projectId: string) => Promise<ReadonlySet<string> | null> {
	let space: Promise<readonly { name: string }[] | null> | undefined;
	return async (projectId) => {
		space ??= deps.connections.spaceSecrets(at.spaceId, at.personId).then(
			(names) => names,
			() => null,
		);
		const project = await deps.connections
			.projectSecrets({ spaceId: at.spaceId, projectId }, at.personId)
			.then(
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
async function coverage(
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
function profilesNaming(
	profiles: Pick<ProfileStore, "list">,
	pick: (profile: { connections: string[]; clis: string[] }) => string[],
	name: string,
): string[] {
	return profiles
		.list()
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
