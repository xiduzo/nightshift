import { isAgentProfile } from "@nightshift/flows";

import { loginReferences, type ToolLaunchers } from "../device";
import type {
	CliTool,
	CliToolStore,
	Connection,
	ConnectionStore,
	ProfileStore,
	ProfileView,
	SecretList,
	SecretView,
} from "../device-config";
import { type FlowRef, type FlowUse, profileUseKey } from "./flow-use";

/**
 * What uses this computer's configuration, for the pages that list it: the
 * flows of the Space that name a connection, a secret, a CLI tool or a
 * profile (`flowUse`), the Agent Profiles that name a connection or a CLI
 * tool, and the CLI tools whose login reads a secret.
 */

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

/** A connection, with the flows and the profiles that name it. */
export type ConnectionInUse = Connection & {
	usedBy: FlowRef[];
	profiles: string[];
};

/** A secret, with the flows whose Command nodes name it and the CLI tools whose logins read it. */
export type SecretInUse = SecretView & { flows: FlowRef[]; tools: string[] };

/**
 * The connections and the secrets of this computer and of its Person
 * (Personal), with what uses each. A secret only a Command node or a CLI
 * tool's login names is listed too: saved or not. `personal` says whether
 * the Personal secrets could be read now.
 *
 * `projectNames` gives the names of a project's own secrets (ADR 13). A
 * project's secret wins for its flows, so those flows do not use this
 * computer's value or the Person's: they leave the list. A CLI tool's
 * login reads the secret of the project its step runs in too, so a tool
 * leaves a name's list when each flow known to use the tool or the name is
 * in a project that has it. A tool no flow is known to use stays. A name
 * that is not saved here and that nothing else uses then leaves it too.
 */
export async function connectionsInUse(
	config: {
		connections: Pick<ConnectionStore, "list" | "secrets">;
		cliTools: Pick<CliToolStore, "list">;
		profiles: Pick<ProfileStore, "list">;
	},
	use: FlowUse,
	projectNames: (
		projectId: string,
	) => Promise<ReadonlySet<string>> = async () => new Set(),
): Promise<{
	connections: ConnectionInUse[];
	secrets: SecretInUse[];
	personal: SecretList["personal"];
}> {
	const toolsBySecret = new Map<string, string[]>();
	for (const tool of config.cliTools.list()) {
		for (const name of tool.login ? loginReferences(tool.login) : []) {
			toolsBySecret.set(name, [...(toolsBySecret.get(name) ?? []), tool.name]);
		}
	}
	const listed = await config.connections.secrets([
		...use.secrets.keys(),
		...toolsBySecret.keys(),
	]);
	// The flows that use a CLI tool: by name in an Agent node, or through
	// an Agent Profile that names it.
	const toolFlows = new Map<string, FlowRef[]>();
	for (const tool of config.cliTools.list()) {
		const viaProfiles = config.profiles
			.list()
			.filter((p) => isAgentProfile(p) && p.clis.includes(tool.name))
			.flatMap((p) =>
				[...use.profiles]
					.filter(([key]) => key.endsWith(`/${p.id}`))
					.flatMap(([, flows]) => flows),
			);
		toolFlows.set(tool.name, [
			...(use.clis.get(tool.name) ?? []),
			...viaProfiles,
		]);
	}
	const projectIds = new Set(
		[...use.secrets.values(), ...toolFlows.values()]
			.flat()
			.map((flow) => flow.projectId),
	);
	const kept = new Map(
		await Promise.all(
			[...projectIds].map(async (id) => [id, await projectNames(id)] as const),
		),
	);
	const secrets: SecretInUse[] = [];
	for (const secret of listed.secrets) {
		const covered = (flow: FlowRef) =>
			kept.get(flow.projectId)?.has(secret.name) === true;
		const tools = (toolsBySecret.get(secret.name) ?? []).filter((tool) => {
			const users = [
				...(toolFlows.get(tool) ?? []),
				...(use.secrets.get(secret.name) ?? []),
			];
			return users.length === 0 || !users.every(covered);
		});
		const flows = (use.secrets.get(secret.name) ?? []).filter(
			(flow) => !covered(flow),
		);
		const needed =
			secret.saved ||
			secret.inEnv ||
			secret.usedBy.length > 0 ||
			tools.length > 0 ||
			flows.length > 0;
		if (needed) secrets.push({ ...secret, flows, tools });
	}
	return {
		// After the secrets: a connection's variables read the Personal names as listed now.
		connections: config.connections.list().map((c) => ({
			...c,
			usedBy: use.connections.get(c.name) ?? [],
			profiles: profilesNaming(config.profiles, (p) => p.connections, c.name),
		})),
		secrets,
		personal: listed.personal,
	};
}

/** A CLI tool, with the flows and the profiles that name it, and when its login last signed in. */
export type CliToolInUse = CliTool & {
	usedBy: FlowRef[];
	profiles: string[];
	signedInAt: number | null;
};

/** The CLI tools of this computer, with what uses each. */
export function cliToolsInUse(
	config: {
		cliTools: Pick<CliToolStore, "list">;
		profiles: Pick<ProfileStore, "list">;
		toolLaunchers: Pick<ToolLaunchers, "signedInAt">;
	},
	use: FlowUse,
): Promise<CliToolInUse[]> {
	return Promise.all(
		config.cliTools.list().map(async (tool) => ({
			...tool,
			usedBy: use.clis.get(tool.name) ?? [],
			profiles: profilesNaming(config.profiles, (p) => p.clis, tool.name),
			signedInAt: tool.login?.signIn
				? await config.toolLaunchers.signedInAt(tool.name)
				: null,
		})),
	);
}

/** The profiles of this computer (`deviceId`), each with the nodes that use it. */
export function profilesInUse(
	config: { profiles: Pick<ProfileStore, "list"> },
	use: FlowUse,
	deviceId: string,
): (ProfileView & { usedBy: (FlowRef & { nodeIds: string[] })[] })[] {
	return config.profiles.list().map((p) => ({
		...p,
		usedBy: use.profiles.get(profileUseKey(deviceId, p.id)) ?? [],
	}));
}
