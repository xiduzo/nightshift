/**
 * What the Device needs of this computer's settings, secrets and project
 * readiness, as ports. The settings and projects capabilities fill them in
 * the daemon wire.
 */
import type {
	AgentHarness,
	AgentHarnessName,
	McpServerConfig,
} from "@nightshift/agents/types";
import type { ProfileSettings } from "@nightshift/flows";
import type { SecretEnv, SecretUse } from "../contract";
import type { DeviceCliTool, DeviceCliToolGuide } from "./words";

/**
 * The agent harnesses of this computer, read at each question: the ones
 * added on the Agents page, and the custom agents (`acp:<slug>`).
 */
export type Harnesses = {
	get(name: AgentHarnessName, use?: SecretUse): AgentHarness | undefined;
	names(): readonly AgentHarnessName[];
};
/** MCP servers expanded for a step, or why they could not be. */
export type DeviceMcpExpansion =
	| {
			ok: true;
			servers: Record<string, McpServerConfig>;
			values?: string[];
	  }
	| { ok: false; message: string };

/** What the Device reads of this computer's connections and secrets. */
export type DeviceConnectionsPort = {
	names(): ReadonlySet<string>;
	mcpServersFor(
		node: { connections: string[] },
		use?: SecretUse,
	): Promise<DeviceMcpExpansion>;
	secretEnv(names: readonly string[], use?: SecretUse): Promise<SecretEnv>;
};

/** What the Device reads of this computer's CLI tools. */
export type DeviceCliToolsPort = {
	names(): ReadonlySet<string>;
	program(name: string): string;
	guides(names: readonly string[]): Promise<DeviceCliToolGuide[]>;
};

/** What tool launchers read of this computer's CLI tools. */
export type DeviceCliToolLookup = {
	get(name: string): DeviceCliTool | null;
	list(): DeviceCliTool[];
};

/** What the Device reads of this computer's Agent Profiles. */
export type DeviceProfilesPort = {
	settingsFor(ref: string): ProfileSettings | null;
};

/** Project readiness steps the Device checks before it adds a worktree. */
export type DeviceProjectReadiness = {
	steps: readonly {
		id: string;
		status: string;
		problem: string | null;
	}[];
};

/** What the Device asks of a project's folder before a run starts in it. */
export type DeviceProjectPort = {
	check(repoPath: string): Promise<DeviceProjectReadiness>;
};
