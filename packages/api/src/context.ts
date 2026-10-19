import type {
	CliCheck,
	CliToolCheck,
	HarnessModels,
	McpServerConfig,
	McpTestResult,
} from "@nightshift/agents";
import type { HarnessName } from "@nightshift/agents/types";
import type { Permissions, Session } from "@nightshift/auth";
import type { DeviceKeyAccess } from "@nightshift/auth/device-keys";
import type { RequestAccess } from "@nightshift/auth/request";
import type { Database } from "@nightshift/db";
import type {
	ArchiveRef,
	CliToolStore,
	ConnectionStore,
	GitInstall,
	HostRole,
	KeyStoreKind,
	ListedSpace,
	PairedDevice,
	ProfileStore,
	ProjectReadiness,
	RunCommand,
	RunCommandInput,
	RunRows,
	SettingsStore,
	SyncCursors,
} from "@nightshift/engine";
import type { Engine } from "@nightshift/engine/types";

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
	/**
	 * The Device key the request carries (`Authorization: Bearer`), resolved.
	 * A request with a key has no session: it is a Device, not a Person.
	 */
	deviceKey: DeviceKeyAccess | null;
	/** This computer's Devices: as a Host (pairing, presence) and its links to Hosts. */
	devices: Devices;
	/** This computer as a Host of run history: what paired Devices pull, push and archive. */
	exchange: HostExchange;
	/** A new Space, its creator the owner, and the session's active one. */
	createSpace(name: string): Promise<{ id: string }>;
	/** The Members and invitations of the session's Space (the organization plugin). */
	members: RequestAccess["members"];
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

/** What the Devices page shows, for one Person. */
export type DevicesOverview = {
	/** This computer, for its owner. Null for another Person. */
	thisComputer: {
		id: string;
		name: string;
		platform: string;
		/** Where its Device keys are: the keychain, else a file only its user can read. */
		keyStore: KeyStoreKind;
		host: {
			/** "Be a Host" is on. */
			enabled: boolean;
			/** In the order Devices try them. */
			addresses: string[];
			/** Whom this computer answers now: itself only, or the network. */
			reachable: "this-computer" | "network";
			/** The settings ask for another reach than it has: a restart applies them. */
			restartNeeded: boolean;
			/** The SHA-256 fingerprint of the certificate it serves itself, if any. */
			fingerprint: string | null;
		};
		/** Its home Host and guest Hosts. */
		hosts: LinkedHost[];
	} | null;
	/** The Person's Devices paired with this computer, when it is a Host. */
	devices: PairedDevice[];
};

export type LinkStatus = "connecting" | "online" | "offline" | "revoked";

/** A Host this computer paired with. */
export type LinkedHost = {
	hostId: string;
	name: string;
	role: HostRole;
	addresses: string[];
	/** The address that answers now. */
	address: string | null;
	status: LinkStatus;
	/** Epoch ms of the last change of `status`. */
	since: number;
	fingerprint: string | null;
};

/** A pairing code for a joining Device, and where its Person approves it. */
export type PairingStart = {
	deviceCode: string;
	userCode: string;
	/** The page of the Host where the Person enters the code. */
	verificationUri: string;
	/** The same page with the code filled in. */
	verificationUriComplete: string;
	expiresIn: number;
	interval: number;
	/** The SHA-256 fingerprint of the certificate the Host serves itself, if any. */
	fingerprint: string | null;
};

/** The Host's answer to a joining Device's poll. */
export type PairingRedeemed =
	| { status: "pending" | "slow-down" | "denied" | "expired" }
	| {
			status: "joined";
			key: string;
			personId: string;
			host: HostHello["host"];
	  };

/** What a paired Device learns from its Host when its link answers. */
export type HostHello = {
	host: { id: string; name: string; addresses: string[] };
	deviceId: string;
	personId: string;
	/** The Spaces the Device's owner is a Member of on the Host, with their role there. */
	spaces: ListedSpace[];
};

/** One answer of the exchange: rows after the Device's cursors, and its commands. */
export type SyncBatch = {
	rows: RunRows;
	/** The cursors moved past these rows. */
	cursors: SyncCursors;
	/** The commands that wait for the Device, as the Walker of their runs. */
	commands: RunCommand[];
};

/**
 * This computer as the Host of run history, for its paired Devices. Each
 * call carries the Device key; the Host filters by its Person's membership
 * and never lets a Device write a row of another Walker.
 */
export type HostExchange = {
	/** Rows of the Spaces the key's Person is a Member of, after the cursors, but the Device's own. */
	pull(key: DeviceKeyAccess, cursors: SyncCursors): Promise<SyncBatch>;
	/** The same, then every new batch as rows land, until the signal aborts. */
	stream(
		key: DeviceKeyAccess,
		cursors: SyncCursors,
		signal?: AbortSignal,
	): AsyncIterable<SyncBatch>;
	/** Takes the Device's own rows. Refuses a batch with a row of another Walker or Space. */
	push(key: DeviceKeyAccess, rows: RunRows): Promise<{ events: number }>;
	/** A person's action on a run another Device walks, in the name of the key's Person. */
	command(
		key: DeviceKeyAccess,
		input: RunCommandInput & { runId: string },
	): Promise<void>;
	/** The Walker applied a command, or says why not. */
	commandDone(
		key: DeviceKeyAccess,
		input: { id: string; error: string | null },
	): Promise<void>;
	/** Records the Device's Clone of a Project in a Space of this Host. */
	addClone(
		key: DeviceKeyAccess,
		input: { spaceId: string; projectId: string; deviceName: string },
	): Promise<void>;
	/** Keeps a file of a run the Device walks. */
	archivePut(
		key: DeviceKeyAccess,
		ref: ArchiveRef,
		content: string,
	): Promise<void>;
	/** A file of a run of a Space the key's Person is a Member of. Null when there is none. */
	archiveGet(key: DeviceKeyAccess, ref: ArchiveRef): Promise<string | null>;
};

/** A pairing code, as the Person approving it sees it. */
export type PairingReviewView = {
	userCode: string;
	status: "pending" | "approved" | "denied";
	device: { id: string; name: string | null; platform: string | null };
	/** This Host's certificate fingerprint, to compare with the one the device shows. */
	fingerprint: string | null;
};

/** How `nightshift join` goes, step by step. */
export type JoinProgress =
	| {
			kind: "code";
			userCode: string;
			verificationUri: string;
			verificationUriComplete: string;
			/** The fingerprint of the Host's self-signed certificate, pinned on approval. */
			fingerprint: string | null;
			expiresAt: number;
	  }
	| { kind: "joined"; hostId: string; hostName: string; role: HostRole };

export type Devices = {
	overview(input: {
		personId: string;
		owner: boolean;
	}): Promise<DevicesOverview>;
	/** A joining Device asks for a pairing code. Only a Host answers. */
	startPairing(input: {
		deviceId: string;
		name: string;
		platform: string;
	}): Promise<PairingStart>;
	/** A joining Device polls for the answer; on approval it gets its key. */
	redeemPairing(input: {
		deviceCode: string;
		deviceId: string;
		/** This Host is to be the Device's home Host. */
		home: boolean;
		/** The address the Device joined by. */
		address: string;
	}): Promise<PairingRedeemed>;
	/** Binds the code to the Person whose session `headers` carry, and shows it. */
	review(headers: Headers, userCode: string): Promise<PairingReviewView>;
	approve(headers: Headers, userCode: string): Promise<void>;
	deny(headers: Headers, userCode: string): Promise<void>;
	/** Removes a Device's access: its key, its connections. The Person's own Devices only. */
	revoke(personId: string, deviceId: string): Promise<void>;
	/** A paired Device's link answered. */
	hello(key: DeviceKeyAccess): Promise<HostHello>;
	/** Pairs this computer with a Host, step by step (`nightshift join`). */
	join(
		input: { url: string; role: HostRole },
		signal?: AbortSignal,
	): AsyncIterable<JoinProgress>;
};
