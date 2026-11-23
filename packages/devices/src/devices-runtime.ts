import type { Auth } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type {
	Device,
	DeviceDocument,
	EngineOptions,
	FlowDocuments,
	KeyStoreKind,
	MoveRows,
	PersonalSecrets,
	ProjectSecrets,
	SpaceArchive,
	SpaceDocuments,
	SyncedDocuments,
} from "@nightshift/engine";
import type { ProfileStore, SettingsStore } from "@nightshift/engine/settings";
import type { HostClient, HostRelay } from "./contract";
import type { Devices, Host, Offers } from "./devices";
import type { HostExchange } from "./exchange";
import type { KeptDevices } from "./handover";
import type { LinkOptions, OpenDocumentChannel } from "./links";
import type { Reach } from "./reach";
import type { OwnSecrets } from "./secrets";
import type {
	createPeerEngine,
	PeerEngine,
	PeerEngineOptions,
} from "./wire-peers-engine";

/**
 * What the devices runtime gives the daemon (`DevicesRuntime`) and what it
 * takes (`DevicesDeps`). `startDevices` (`wire.ts`) builds the one from the
 * other.
 */

/** This computer among Devices, as the daemon uses it (`startDevices`). */
export type DevicesRuntime = {
	/** This computer's engine, wired to its peers (`createPeerEngine`). */
	engine: PeerEngine;
	/** This computer as a Host: the Device key of a request, and of a relay connection. */
	host: Pick<Host, "keyOf" | "syncKey">;
	/** The API's ports: the Devices page, the Host's exchange of run history, the Offers. */
	devices: Devices;
	hostExchange: HostExchange;
	offers: Offers;
	/** Whom this daemon answers since it started: this computer, or the network. */
	reach: Reach;
	/** How Bun serves this daemon: the hostname of its reach, and its own TLS. */
	serve: { hostname: string; tls?: { cert: string; key: string } };
	/** Waits until this Replica's documents of a Space are in step with its Host's. */
	inStep: HostRelay["inStep"];
	/**
	 * This computer's owner's Personal secrets (ADR 13), for the engine's
	 * connection store: at the Home Host, else kept here.
	 */
	personalSecrets: PersonalSecrets;
	/**
	 * The secrets of the Projects (ADR 13), for the engine's connection
	 * store: at the Host that keeps their Space, else kept here.
	 */
	projectSecrets: ProjectSecrets;
};

export type DevicesDeps = {
	/** This computer runs a development install of Night Shift (ADR 17). */
	dev?: boolean;
	/** A development install may connect to a Host on another computer (ADR 20). */
	devLinkHost?: boolean;
	/** The fingerprint of this computer (ADR 20). Default: none. */
	machine?: string | null;
	auth: Auth;
	db: Database;
	/**
	 * Read at start: the certificate this daemon serves itself
	 * (NIGHTSHIFT_TLS_CERT, NIGHTSHIFT_TLS_KEY), the hostname a Host binds
	 * (NIGHTSHIFT_LISTEN), and the web app, whose Devices page pairing
	 * codes link to (CORS_ORIGIN).
	 */
	env: {
		CORS_ORIGIN: string;
		NIGHTSHIFT_LISTEN?: string;
		NIGHTSHIFT_TLS_CERT?: string;
		NIGHTSHIFT_TLS_KEY?: string;
	};
	settings: SettingsStore;
	/** Moments for the anonymous usage export. The engine notes them. */
	usage?: EngineOptions["usage"];
	profiles: ProfileStore;
	document: DeviceDocument;
	/** The documents this Replica syncs, by name: the views below are over them. */
	documents: SyncedDocuments;
	spaces: SpaceDocuments;
	/** The flow documents of the Projects: this Device keeps a copy of each. */
	flows: FlowDocuments;
	/** This computer's Device. */
	self: { id: string; name: string };
	/** The Person who owns this computer. */
	ownerId: string;
	/** This computer as a Device: every computer-touching piece of a step. */
	local: Device;
	dataDir: string;
	/**
	 * This Replica's Space archive, which the knowledge shares: the
	 * runtime connects it to the Hosts this computer links to.
	 */
	archive: SpaceArchive;
	/** Where the Device keys go: the keychain, else a file (`prefer: "file"`). */
	keyStore: { prefer?: KeyStoreKind };
	/**
	 * The key this computer seals the Personal secrets it keeps with
	 * (ADR 13): NIGHTSHIFT_SECRETS_KEY, else a file. At least 32 characters.
	 */
	secretsKey: string;
	/**
	 * This computer's own secrets (its connection store): what it moves
	 * when its Home Host asks for its owner (ADR 13, decision 7). Without
	 * them, it moves none.
	 */
	ownSecrets?: OwnSecrets;
	/** The engine's scheduler: off, or on until the signal aborts. */
	scheduler: PeerEngineOptions["scheduler"];
	/** A secret's value by name: the secret a webhook schedule names. */
	secret?: PeerEngineOptions["secret"];
	/** Ends the relay connections of a Device whose access was removed. */
	disconnect(deviceId: string): void;
	/**
	 * What a Space move moves beside the rows of the engine and of
	 * `devices`, in the same batch: the notifier's deliveries of the moved
	 * runs, which this package does not import.
	 */
	moveRows?: readonly MoveRows[];
	/**
	 * What follows the Projects of a Space move outside the rows: their
	 * knowledge, which this package does not keep.
	 */
	projectsMoved?: PeerEngineOptions["projectsMoved"];
	/** Kept across `bun --hot` reloads: what the runtime before this one hands over. */
	kept: KeptDevices;
	/**
	 * The Host at an address, as this computer's Links call it. Default:
	 * over HTTPS, with the Link's key and its pinned certificate. A test
	 * gives a Host in memory.
	 */
	hostClient?(address: string): HostClient;
	/**
	 * The document channel of this computer's Links. Default: Hocuspocus
	 * to the Host's relay. A test gives a Host in memory.
	 */
	documentChannel?: OpenDocumentChannel;
	/** Knobs for tests only. */
	internals?: {
		engine?: Parameters<typeof createPeerEngine>[1];
		links?: LinkOptions;
		/** How often the presence sweep runs. Default 5 s. */
		presenceMs?: number;
	};
};
