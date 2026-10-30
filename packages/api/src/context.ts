import type {
	CliCheck,
	CliToolCheck,
	HarnessModels,
	HarnessName,
	McpServerConfig,
	McpTestResult,
} from "@nightshift/agents";
import type { DeviceKeyAccess, RequestAccess } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { Devices, HostExchange, Offers } from "@nightshift/devices";
import type {
	Engine,
	KnowledgeFolders,
	KnowledgeSearch,
	ToolLaunchers,
} from "@nightshift/engine";
import type {
	CliToolStore,
	ConnectionStore,
	ProfileStore,
	SettingsStore,
} from "@nightshift/engine/device-config";
import type {
	GitHubClones,
	GitInstall,
	ProjectCopies,
	ProjectReadiness,
} from "@nightshift/engine/projects";
import type { AssistantService } from "@nightshift/flows";
import type { Notifications } from "@nightshift/notifications";
import type { Telemetry } from "@nightshift/telemetry";

/** What a procedure gets: the request, and the daemon's services. */
export type Context = Services & {
	/**
	 * Who the request is, in which Space, and what they may do there: one
	 * value from auth, read once when the request starts. On this computer,
	 * the local Person's session when the request has none. A procedure
	 * that works in a Space checks it first (`spaceAccess`).
	 */
	access: RequestAccess;
	/** The request came from this computer itself, not through a proxy or from elsewhere (`isThisComputer`). */
	fromThisComputer: boolean;
	/**
	 * The Device key the request carries (`Authorization: Bearer`), resolved.
	 * A request with a key has no session: it is a Device, not a Person.
	 */
	deviceKey: DeviceKeyAccess | null;
	/** The Host requires two-factor sign-in for sessions from other computers. */
	requireTwoFactor: boolean;
	/** Sets a Person's email and password (`@nightshift/auth/login`). */
	setLogin(
		personId: string,
		input: {
			email: string;
			password: string;
			name?: string;
			resetTwoFactor?: boolean;
		},
	): Promise<{ email: string }>;
};

/**
 * What the procedures use besides the request: the daemon's services. Its
 * composition root (`createDaemon`) fills them once. A new service goes
 * here, and in the composition root.
 */
export type Services = {
	/** This computer's Devices: as a Host (pairing, presence) and its links to Hosts. */
	devices: Devices;
	/** This computer as a Host of run history: what paired Devices pull, push and archive. */
	exchange: HostExchange;
	/** This computer's Offers, and the Devices of a Space as its Members see them. */
	offers: Offers;
	db: Database;
	/** The engine of this Device. Procedures use the view of the session's Space. */
	engine: Engine;
	settings: SettingsStore;
	/**
	 * The notifier: each Person's in-app stream, notification settings and
	 * push targets.
	 */
	notifications: Notifications;
	/** The export to monitoring: its headers, kept like a secret, by name only. */
	telemetry: Pick<Telemetry, "headers">;
	connections: ConnectionStore;
	cliTools: CliToolStore;
	/** The CLI tools' logins: signing one in, when it last did, its folder. */
	toolLaunchers: Pick<ToolLaunchers, "signIn" | "signedInAt" | "forget">;
	profiles: ProfileStore;
	/** The projects' knowledge folders on this computer, with their index. */
	knowledge: Pick<KnowledgeFolders, "index" | "proposed">;
	/** Keyword search over the projects' knowledge on this computer, and reading one file. */
	knowledgeSearch: Pick<KnowledgeSearch, "search" | "read">;
	/** Helps the person build a flow in the editor, on one of this computer's profiles. */
	assistant: AssistantService;
	/** Read-only checks of the CLIs and MCP servers on this machine. */
	checks: {
		harness(harness: HarnessName, bin: string): Promise<CliCheck>;
		/** A custom agent's command: where it is, and its version when it says. */
		customAgent(command: string, label: string): Promise<CliCheck>;
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
		/**
		 * Opens the native folder picker on the daemon's computer and waits
		 * for a choice. Null when the person cancels.
		 */
		chooseFolder(prompt: string): Promise<string | null>;
		/** This computer can open a folder picker (`chooseFolder`). */
		folderPicker: boolean;
		/** Clones from GitHub into Night Shift's own projects folder, and the GitHub CLI on this computer. */
		gitHub: GitHubClones;
		/** Copies of the Space's projects to this computer, from GitHub: a Host's, and the ones a person asks for. */
		copies: ProjectCopies;
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
