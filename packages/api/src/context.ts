import type {
	CliCheck,
	McpServerConfig,
	McpTestResult,
} from "@nightshift/agents";
import type { HarnessName } from "@nightshift/agents/types";
import type { Session } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { ConnectionStore, SettingsStore } from "@nightshift/engine";
import type { Engine } from "@nightshift/engine/types";

export type Context = {
	session: Session | null;
	db: Database;
	engine: Engine;
	settings: SettingsStore;
	connections: ConnectionStore;
	/** Read-only checks of the CLIs and MCP servers on this machine. */
	checks: {
		harness(harness: HarnessName, bin: string): Promise<CliCheck>;
		github(bin: string): Promise<CliCheck>;
		mcp(config: McpServerConfig, redact: string[]): Promise<McpTestResult>;
	};
	/** Facts about this daemon that change only on a restart. */
	daemon: {
		dataDir: string;
		/** The database lease this daemon holds. `since` is epoch ms. */
		lease: { host: string; pid: number; epoch: number; since: number };
	};
};
