import type { Database } from "@nightshift/db";
import {
	defaultSelfDeviceHost,
	deviceDirectory,
	machineFingerprint,
	selfDevice,
	selfOwnerId,
	servedDocuments,
	setSelfOwner,
	startDevices,
} from "@nightshift/devices";
import { documentRows } from "@nightshift/engine";
import { isThisComputer } from "./http";
import {
	type DaemonEnv,
	type HotRegistry,
	type HotSlots,
	hot,
	secretsKey,
} from "./runtime";
import { keepSync } from "./sync";

type DevicesDeps = Parameters<typeof startDevices>[0];
type DevicesRuntime = Awaited<ReturnType<typeof startDevices>>;
type Sessions = Parameters<typeof servedDocuments>[0]["sessions"];

/**
 * The Device rows of this Replica, as the daemon reads them before the
 * devices start. Nothing is read until a call asks.
 */
export function openRegistry(db: Database, options: { dev: boolean }) {
	return {
		/** Every Device this Replica knows, by id. */
		directory: deviceDirectory(db),
		/** This computer's Device: the Walker of its runs, the owner of its Clones. */
		self: () => selfDevice(db, defaultSelfDeviceHost({ dev: options.dev })),
		/** The Person this computer's Device names, and how to name another. */
		owner: {
			ownerId: () => selfOwnerId(db),
			setOwner: (personId: string) => setSelfOwner(db, personId),
		},
	};
}

/**
 * The devices block of the daemon's composition (`daemon.ts`): this
 * computer among Devices, and the relay's document half. The lanes of
 * package `devices` edit this file, not `daemon.ts`.
 *
 * This computer among Devices: the engine with its peers, the Host it may
 * be, its Offers and its Links to its Hosts. Secure by default: it answers
 * this computer only until it is a Host with an https:// address (read at
 * start). On a `bun --hot` reload the runtime before hands over to this
 * one: its engine lets go of its runs first, and the work of placed steps
 * goes on.
 */
export async function wireDaemonDevices(
	deps: Omit<
		DevicesDeps,
		| "dev"
		| "devLinkHost"
		| "machine"
		| "scheduler"
		| "secret"
		| "disconnect"
		| "kept"
		| "ownSecrets"
		| "secretsKey"
		| "hostClient"
		| "documentChannel"
	> & {
		dev: boolean;
		env: DaemonEnv;
		slots: Pick<HotSlots<HotRegistry>, "handOver" | "keep">;
		/** This computer's secrets: its own to move, and those a webhook schedule names. */
		connections: DevicesDeps["ownSecrets"] & {
			webhookSecret: NonNullable<DevicesDeps["secret"]>;
		};
		/** Only the newest engine may start scheduled runs. */
		scheduler: AbortController;
		hosts?: DevicesDeps["hostClient"];
		documentChannel?: DevicesDeps["documentChannel"];
		/** The sessions the relay accepts, without whether a peer is this computer. */
		sessions: Omit<Sessions, "isThisComputer">;
		trustedOrigins: ReadonlySet<string>;
		/** Called once the devices started, before the relay serves documents. */
		started: (devices: DevicesRuntime) => void;
	},
) {
	const { dev, env, db, documents, connections } = deps;
	deps.slots.handOver("nightshiftDevices", (handover) => handover.release());
	const devices = await startDevices({
		...(dev ? { dev: true } : {}),
		...(env.NIGHTSHIFT_DEV_LINK_HOST === "true" ? { devLinkHost: true } : {}),
		// Test daemons on one computer are Devices of their own.
		machine: env.NODE_ENV === "test" ? null : await machineFingerprint({ dev }),
		auth: deps.auth,
		db,
		env,
		settings: deps.settings,
		profiles: deps.profiles,
		document: deps.document,
		documents,
		spaces: deps.spaces,
		flows: deps.flows,
		self: deps.self,
		ownerId: deps.ownerId,
		local: deps.local,
		dataDir: deps.dataDir,
		archive: deps.archive,
		keyStore: deps.keyStore,
		// What seals the Personal secrets this computer keeps (ADR 13).
		secretsKey: secretsKey({ ...process.env, ...env }, deps.dataDir),
		// What this computer moves of its own secrets when its Home Host
		// asks for its owner: saved in the new scope, then removed here.
		ownSecrets: connections,
		// NIGHTSHIFT_SCHEDULER=off: no scheduler at all, whatever Settings says.
		// Otherwise the Settings switch is read on every tick.
		scheduler:
			env.NIGHTSHIFT_SCHEDULER === "off"
				? false
				: { signal: deps.scheduler.signal },
		usage: deps.usage,
		// The secret a webhook schedule names: its project's first.
		secret: (name, project) => connections.webhookSecret(name, project),
		// The relay below is made once per process, before any access is removed.
		disconnect: (deviceId) =>
			hot.nightshiftSync?.disconnect(
				(context) => context.deviceId === deviceId,
			),
		moveRows: deps.moveRows,
		projectsMoved: deps.projectsMoved,
		kept: hot,
		...(deps.hosts ? { hostClient: deps.hosts } : {}),
		...(deps.documentChannel ? { documentChannel: deps.documentChannel } : {}),
	});
	deps.started(devices);

	/**
	 * The relay's document half: the owner's clients sync this Device's
	 * document here. Kept across `bun --hot` reloads with its connections,
	 * like the document, and bound to this daemon's closures.
	 */
	const sync = await keepSync(
		deps.slots,
		servedDocuments({
			db,
			documents,
			rows: documentRows(db),
			registry: devices.engine.devices,
			deviceKey: (token) => devices.host.syncKey(token),
			sessions: {
				...deps.sessions,
				isThisComputer: (peer, request) =>
					isThisComputer(peer, request, deps.trustedOrigins),
			},
		}),
	);
	return { devices, sync };
}
