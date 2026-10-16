import type {
	CliCheck,
	HarnessModels,
	McpServerConfig,
	McpTestResult,
} from "@nightshift/agents";
import type { HarnessName } from "@nightshift/agents/types";
import type { Session } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type {
	CliToolStore,
	ConnectionStore,
	ProfileStore,
	SettingsStore,
} from "@nightshift/engine";
import type { Engine } from "@nightshift/engine/types";

export type Context = {
	session: Session | null;
	db: Database;
	engine: Engine;
	settings: SettingsStore;
	connections: ConnectionStore;
	cliTools: CliToolStore;
	profiles: ProfileStore;
	/** Read-only checks of the CLIs and MCP servers on this machine. */
	checks: {
		harness(harness: HarnessName, bin: string): Promise<CliCheck>;
		/** A CLI tool by name: where it is and its version. */
		cli(name: string): Promise<CliCheck>;
		/** The programs this computer can run by name, for the CLI tool picker. */
		programs(): Promise<string[]>;
		mcp(config: McpServerConfig, redact: string[]): Promise<McpTestResult>;
		/** The models a harness offers: its adapter's list, plus the CLI's own listing. */
		models(harness: HarnessName, bin: string): Promise<HarnessModels>;
	};
	/** Facts about this daemon that change only on a restart. */
	daemon: {
		dataDir: string;
		/** The database lease this daemon holds. `since` is epoch ms. */
		lease: { host: string; pid: number; epoch: number; since: number };
	};
};
