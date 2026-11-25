import type { Decider } from "@nightshift/agents/types";
import type { AgentHarnessName } from "@nightshift/flows";
import type { ArtifactStore } from "../artifacts";
import type { SecretUse } from "../contract";
import type { Git } from "../git";
import type { RunFolders } from "../run-folders";
import type {
	DeviceCliToolsPort,
	DeviceConnectionsPort,
	DeviceProfilesPort,
	DeviceProjectPort,
	Harnesses,
} from "./ports";
import type { ToolLaunchers } from "./tool-launchers";
import type { DeciderFacts, StepKnowledge } from "./types";

/** What the Device reads of this computer's connections and secrets. */
export type DeviceConnections = DeviceConnectionsPort;

/** What the Device reads of this computer's CLI tools. */
export type DeviceCliTools = DeviceCliToolsPort;

/**
 * Everything on this computer a step body may touch: the harnesses, the
 * decider, this computer's configuration as its stores (connections and
 * secrets, CLI tools, Agent Profiles), `sh -c` and git worktrees.
 * `createDaemon` (`@nightshift/daemon`) wires it from the daemon's stores;
 * a test wires it over the same stores, or fakes of them.
 */
export type LocalDeviceDeps = {
	id: string;
	name: string;
	/** The harnesses added on this computer. */
	harnesses: Harnesses;
	/** Decides Decision nodes and makes values for Value nodes. */
	decider?: Decider;
	/**
	 * Who answers for Night Shift's own Decider and Brief writer here, from
	 * this computer's settings. Read on each `capabilities` call.
	 */
	builtinModels?: () => NonNullable<DeciderFacts["builtin"]>;
	/**
	 * This computer's connections and secrets (`ConnectionStore`): an Agent
	 * node's MCP servers with `${NAME}` expanded, a Command node's secrets
	 * by name, from the scopes of the use (`secretScopes`). Without it:
	 * no connections, and a node with connections is refused; a command's
	 * secrets come from `process.env`.
	 */
	connections?: DeviceConnections;
	/**
	 * This computer's CLI tools (`CliToolStore`): their names, the program
	 * each runs, and what an agent learns about them (each description and
	 * help, after a new session's prompt). Without it: none is defined,
	 * and a tool runs the program of its name.
	 */
	cliTools?: DeviceCliTools;
	/** This computer's Agent Profiles, by id. Without it: none. */
	profiles?: DeviceProfilesPort;
	/** Project readiness before a worktree. Without it: no check (tests). */
	checkProject?: DeviceProjectPort;
	/** Where a program is on this computer, or null. Default: `findProgram`. */
	which?: (program: string) => string | null;
	/**
	 * The CLI tools' launchers and logins (`createToolLaunchers`). Without
	 * it, a tool runs the program of its name with this computer's sign-in.
	 */
	toolLaunchers?: Pick<ToolLaunchers, "prepare" | "forCommand" | "guarded">;
	/*
	 * Every secret this Device reads for a step goes through `connections`,
	 * `toolLaunchers`, `harnesses`, the decider and `secretValues`.
	 * Which scopes each reads is the Secret scope rule's (`secretScopes`),
	 * not this file's: it passes the facts of the use on.
	 */
	/**
	 * The folder of a project's Clone on this computer, or null when it has
	 * none. Without it, this computer has no Clones: a run cannot start here.
	 */
	clonePath?: (projectId: string) => Promise<string | null>;
	/**
	 * The runs' own folders on this computer (ADR 22): a run of a project
	 * without a folder works in its folder here. Without it, this computer
	 * cannot run such a project.
	 */
	runFolders?: Pick<RunFolders, "make">;
	/**
	 * The git port: worktrees, Hand-offs and item branches, and finding git
	 * before a worktree is added. Default: the git programs on this computer.
	 */
	git?: Git;
	/**
	 * Whether this computer takes snapshots of a run's worktree, over the
	 * git port, to tell what a step changed there (`snapshotWorktree`,
	 * `worktreeChanges`). The daemon's does. Without it, it has neither.
	 */
	snapshots?: boolean;
	/**
	 * Where a session keeps its artifacts, and reads the files of the run's
	 * answers. Without it, sessions keep none and get none.
	 */
	artifacts?: Pick<ArtifactStore, "save" | "answerFolder">;
	/**
	 * The projects' knowledge on this computer, in step with their Spaces
	 * (ADR 4). A step that asks for it gets it here, and gives it back when
	 * it ends. Without it, a step gets none.
	 */
	knowledge?: StepKnowledge;
	/**
	 * What a run step's harness session adds to its environment, read as
	 * the session starts: the export to monitoring gives Claude Code its
	 * own telemetry under the step (`@nightshift/telemetry`). `values` are
	 * the secret values in `env` (an API key in its headers): the session's
	 * output has them as `•••`. `config`: the harness's own `--config`
	 * overrides (Codex sets its telemetry there). Without it, or when it
	 * gives nothing: nothing.
	 */
	sessionEnv?: (session: {
		harness: AgentHarnessName;
		runId: string;
		stepId: string;
	}) => {
		env: Record<string, string>;
		values: readonly string[];
		config?: Record<string, string>;
	};
	/**
	 * The values of the saved secrets (Personal ones too, when `use`
	 * allows them) and of the ones the connections reference, read as a
	 * session starts: its output has each as `•••`, as an exported run has.
	 * Without it: only the values the session was given (its CLI tools'
	 * logins, its MCP servers' and `sessionEnv`'s).
	 */
	secretValues?: (use?: SecretUse) => Promise<readonly string[]>;
	/**
	 * Whether a web request from this computer may reach loopback and
	 * private addresses (`web-access/addresses.ts`), read at each request. A
	 * Host's Settings decide it there. Without it: they may, as on a laptop.
	 */
	privateNetwork?: () => boolean;
	/** The addresses of a host name, for a test. Default: the system's resolver. */
	resolve?: (hostname: string) => Promise<string[]>;
};

/** A Device without connections: a node with connections is refused, and a command's secrets come from the environment. */
export const NO_CONNECTIONS: DeviceConnections = {
	names: () => new Set(),
	async mcpServersFor(node, _use) {
		return (node.connections ?? []).length > 0
			? {
					ok: false,
					message: `The node uses connections (${node.connections?.join(", ")}), but there are none. Add them under Agents → Tools.`,
				}
			: { ok: true, servers: {} };
	},
	async secretEnv(names, _use) {
		const missing = names.filter((name) => process.env[name] === undefined);
		if (missing.length > 0) return { ok: false, missing };
		return {
			ok: true,
			env: Object.fromEntries(
				names.map((name) => [name, process.env[name] ?? ""]),
			),
		};
	},
};
