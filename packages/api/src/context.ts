import type {
	CliCheck,
	CliToolCheck,
	HarnessModels,
	McpServerConfig,
	McpTestResult,
} from "@nightshift/agents";
import type { HarnessName } from "@nightshift/agents/types";
import type { Permissions, Session } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type {
	CliToolStore,
	ConnectionStore,
	GitInstall,
	ProfileStore,
	ProjectReadiness,
	SettingsStore,
} from "@nightshift/engine";
import type { Engine } from "@nightshift/engine/types";

export type Context = {
	/** The request's session. On this computer, the local Person's when the request has none. */
	session: Session | null;
	/** The Space the session works in: its active Space, else the Person's personal Space. Null without a session. */
	spaceId: string | null;
	/**
	 * Whether the session's Person may do `permissions` in that Space: the
	 * organization plugin's check of their role, on the server.
	 */
	can(permissions: Permissions): Promise<boolean>;
	/** Makes a Space of the Person the session's active one. */
	setActiveSpace(spaceId: string): Promise<void>;
	db: Database;
	/** The engine of this Device. Procedures use the view of the session's Space. */
	engine: Engine;
	settings: SettingsStore;
	connections: ConnectionStore;
	cliTools: CliToolStore;
	profiles: ProfileStore;
	/** Read-only checks of the CLIs and MCP servers on this machine. */
	checks: {
		harness(harness: HarnessName, bin: string): Promise<CliCheck>;
		/** A CLI tool by name: where it is, its version and its help. */
		cli(name: string): Promise<CliToolCheck>;
		/** The programs this computer can run by name, for the CLI tool picker. */
		programs(): Promise<string[]>;
		mcp(config: McpServerConfig, redact: string[]): Promise<McpTestResult>;
		/** The models a harness offers: its adapter's list, plus the CLI's own listing. */
		models(harness: HarnessName, bin: string): Promise<HarnessModels>;
	};
	/** What a folder needs before runs can start in it, and the fixes a person asks for. */
	projectSetup: {
		check(path: string): Promise<ProjectReadiness>;
		setUpGit(input: {
			path: string;
			name?: string;
			email?: string;
		}): Promise<ProjectReadiness>;
		installGit(): Promise<GitInstall>;
	};
	/** Facts about this daemon that change only on a restart. */
	daemon: {
		dataDir: string;
		/** This computer's Device and the Person who owns it. */
		device: { id: string; name: string; ownerId: string };
		/** The database lease this daemon holds. `since` is epoch ms. */
		lease: { host: string; pid: number; epoch: number; since: number };
	};
};
