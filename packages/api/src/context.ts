import type {
	CliCheck,
	CliToolCheck,
	HarnessModels,
	HarnessName,
	McpServerConfig,
	McpTestResult,
} from "@nightshift/agents";
import type {
	DeviceKeyAccess,
	HostAccess,
	Permissions,
	RequestAccess,
	Session,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { Devices, HostExchange, Offers } from "@nightshift/devices";
import type {
	CliToolStore,
	ConnectionStore,
	Engine,
	GitHubClones,
	GitInstall,
	ProfileStore,
	ProjectReadiness,
	SettingsStore,
	ToolLaunchers,
} from "@nightshift/engine";
import type { Notifications } from "@nightshift/notifications";

export type Context = {
	/** The request's session. On this computer, the local Person's when the request has none. */
	session: Session | null;
	/** The Space the session works in: its active Space, else the Person's personal Space. Null without a session. */
	spaceId: string | null;
	/**
	 * Whether the session's Person may do `permissions` in that Space (or
	 * in `inSpace`): the organization plugin's check of their role, on the
	 * server.
	 */
	can(permissions: Permissions, inSpace?: string): Promise<boolean>;
	/** Makes a Space of the Person the session's active one. */
	setActiveSpace(spaceId: string): Promise<void>;
	/** The request's headers, with the local session when it got one: for Better Auth's own checks. */
	headers: Headers;
	/** The request came from this computer itself, not through a proxy or from elsewhere (`isThisComputer`). */
	fromThisComputer: boolean;
	/**
	 * Whether the session may use the Host (`@nightshift/auth/host-access`).
	 * Refused: a session from another computer on a Host that requires
	 * two-factor sign-in, whose Person has not turned it on.
	 */
	hostAccess: HostAccess;
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
	/**
	 * The Device key the request carries (`Authorization: Bearer`), resolved.
	 * A request with a key has no session: it is a Device, not a Person.
	 */
	deviceKey: DeviceKeyAccess | null;
	/** This computer's Devices: as a Host (pairing, presence) and its links to Hosts. */
	devices: Devices;
	/** This computer as a Host of run history: what paired Devices pull, push and archive. */
	exchange: HostExchange;
	/** This computer's Offers, and the Devices of a Space as its Members see them. */
	offers: Offers;
	/** A new Space, its creator the owner, and the session's active one. */
	createSpace(name: string): Promise<{ id: string }>;
	/** The Members and invitations of the session's Space (the organization plugin). */
	members: RequestAccess["members"];
	db: Database;
	/** The engine of this Device. Procedures use the view of the session's Space. */
	engine: Engine;
	settings: SettingsStore;
	/**
	 * The notifier: each Person's in-app stream, notification settings and
	 * push targets.
	 */
	notifications: Notifications;
	connections: ConnectionStore;
	cliTools: CliToolStore;
	/** The CLI tools' logins: signing one in, when it last did, its folder. */
	toolLaunchers: Pick<ToolLaunchers, "signIn" | "signedInAt" | "forget">;
	profiles: ProfileStore;
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
