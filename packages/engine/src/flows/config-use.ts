import { isAgentProfile } from "@nightshift/flows";

import { loginReferences, type ToolLaunchers } from "../device";
import type {
	CliTool,
	CliToolStore,
	Connection,
	ConnectionStore,
	ProfileStore,
	ProfileView,
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
 * The connections and the secrets of this computer, with what uses each.
 * A secret only a Command node or a CLI tool's login names is listed too:
 * saved or not.
 */
export function connectionsInUse(
	config: {
		connections: Pick<ConnectionStore, "list" | "secrets">;
		cliTools: Pick<CliToolStore, "list">;
		profiles: Pick<ProfileStore, "list">;
	},
	use: FlowUse,
): { connections: ConnectionInUse[]; secrets: SecretInUse[] } {
	const toolsBySecret = new Map<string, string[]>();
	for (const tool of config.cliTools.list()) {
		for (const name of tool.login ? loginReferences(tool.login) : []) {
			toolsBySecret.set(name, [...(toolsBySecret.get(name) ?? []), tool.name]);
		}
	}
	return {
		connections: config.connections.list().map((c) => ({
			...c,
			usedBy: use.connections.get(c.name) ?? [],
			profiles: profilesNaming(config.profiles, (p) => p.connections, c.name),
		})),
		secrets: config.connections
			.secrets([...use.secrets.keys(), ...toolsBySecret.keys()])
			.map((secret) => ({
				...secret,
				flows: use.secrets.get(secret.name) ?? [],
				tools: toolsBySecret.get(secret.name) ?? [],
			})),
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
