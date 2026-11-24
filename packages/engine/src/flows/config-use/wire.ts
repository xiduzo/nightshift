import { loginReferences } from "../../device";
import type { SecretList } from "../../secrets";
import type {
	CliToolStore,
	ConnectionStore,
	ProfileStore,
} from "../../settings";
import {
	type CliToolInUse,
	listCliToolUse,
} from "./application/list-cli-tool-use";
import {
	type ConnectionInUse,
	listConnectionUse,
	type SecretInUse,
} from "./application/list-connection-use";
import {
	listProfileUse,
	type ProfileInUse,
} from "./application/list-profile-use";
import {
	listSharedSecretUse,
	type SharedSecretInUse,
} from "./application/list-shared-secret-use";
import type { ToolSignIns } from "./application/ports";
import type { SpaceFlowReader } from "./domain/flow-use";
import type { Asker, SecretOwner } from "./domain/secret-users";

export type { Asker } from "./domain/secret-users";

/** What the slice reads: this computer's Device and configuration, and a Space's flows. */
export type ConfigUseDeps = {
	/** This computer's Device id: the profiles flows name with it are this computer's. */
	deviceId: string;
	/** A Space as `at` sees it: its projects, their flows and schedules. */
	space(at: Asker): SpaceFlowReader;
	connections: Pick<
		ConnectionStore,
		"list" | "secrets" | "projectSecrets" | "spaceSecrets"
	>;
	cliTools: Pick<CliToolStore, "list">;
	profiles: Pick<ProfileStore, "list">;
	toolLaunchers: ToolSignIns;
};

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

/**
 * What uses a name of this computer's configuration, in the flows of a
 * Space: a secret, a Connection, a CLI tool or a profile. The "Used by" of
 * this computer's Secrets, Connections, CLI tools and profiles, and of the
 * Secrets of a project and of the Space. The four use cases of
 * `application/`, bound to this computer.
 */
export function wireConfigUse(deps: ConfigUseDeps): ConfigUse {
	const ports = {
		device: { id: deps.deviceId },
		spaces: { open: (at: Asker) => deps.space(at) },
		connections: deps.connections,
		cliTools: deps.cliTools,
		profiles: deps.profiles,
		toolLaunchers: deps.toolLaunchers,
		logins: { references: loginReferences },
	};
	const connections = listConnectionUse(ports);
	const cliTools = listCliToolUse(ports);
	const profiles = listProfileUse(ports);
	const sharedSecrets = listSharedSecretUse(ports);
	return {
		connections: (at) => connections({ at }),
		cliTools: (at) => cliTools({ at }),
		profiles: (at) => profiles({ at }),
		sharedSecrets: (at, owner) => sharedSecrets({ at, owner }),
	};
}
