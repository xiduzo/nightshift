import { randomUUID } from "node:crypto";
import { wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import {
	type DeviceRows,
	deviceDocumentName,
	type PeerContext,
} from "@nightshift/engine";
import { now as timeNow } from "@nightshift/time";
import type { BatchItem } from "drizzle-orm/batch";
import { thisComputer } from "../../machine";
import { drizzleDeviceStore } from "./adapters/out/drizzle-device-store";
import { adoptSelfDevice } from "./application/adopt-self-device";
import { closeStalePresence } from "./application/close-stale-presence";
import { describeDevice } from "./application/describe-device";
import { ensureSelfDevice } from "./application/ensure-self-device";
import { findDevice } from "./application/find-device";
import { findKeptDocumentOwner } from "./application/find-kept-document-owner";
import { findSameMachine } from "./application/find-same-machine";
import { forgetDevice } from "./application/forget-device";
import { joinDevice } from "./application/join-device";
import { listDeviceNames } from "./application/list-device-names";
import { listDevices } from "./application/list-devices";
import { markDeviceSeen } from "./application/mark-device-seen";
import type {
	DeviceFacts,
	DeviceStore,
	PersonalSpaces,
} from "./application/ports";
import { revokeDevice } from "./application/revoke-device";
import { setSelfOwner } from "./application/set-self-owner";
import { sweepPresence } from "./application/sweep-presence";
import type { DevicePresence, PairedDevice } from "./domain/paired-device";

/**
 * The wiring of registry: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the package gives registry: the database of its rows. */
export type RegistryDeps = {
	db: Database;
	/** A new random id. Default: a UUID. */
	newId?: () => string;
};

/** What the engine gives the Devices paired with this Host (`PeerContext`). */
export type PairedDeps = {
	/** Logs a Device's facts (`PeerContext.logFact`). */
	logFact: PeerContext["logFact"];
	/** The engine's event log: the latest presence of each Device, and the last count of a Walker. */
	history: Pick<PeerContext["history"], "devicePresence" | "lastWalkerSeq">;
	/** The engine's rows of a Device, for the batch that forgets or adopts it (`PeerContext.deviceRows`). */
	deviceRows: DeviceRows;
	/** The presence of the registry before a reload. Default: every Device offline. */
	presence?: DevicePresence;
	now?: () => number;
};

/**
 * The Devices that paired with this Host: their rows, whether they are
 * online, and the audit of it in their owner's personal Space
 * (`DeviceJoined`, `DeviceRevoked`, `DeviceOnline`, `DeviceOffline`). Also
 * this computer's own Device as the peers ask it. The Host, Offers,
 * Placement and the membership take it (the `Registry` of their ports).
 */
export type DeviceRegistry = {
	/**
	 * What a paired Device says of itself when it links: its name, whether
	 * it is a development install, and the fingerprint of its computer. A
	 * Device that says no fingerprint keeps the one it has. A development
	 * install has none. Two Devices with one fingerprint stay as they are.
	 */
	describe(
		id: string,
		facts: { name: string; dev: boolean; machine?: string | undefined },
	): Promise<void>;
	/**
	 * The Person's Device on the computer of this fingerprint, other than
	 * `exceptId`: the one with access first, then the one seen last. A
	 * removed Device counts: pairing again brings it back. Never another
	 * Person's, a development install or this Host's own.
	 */
	sameMachine(
		ownerId: string,
		machine: string,
		exceptId: string,
	): Promise<PairedDevice | null>;
	/**
	 * Records a Device that paired with this Host, or paired again: its row
	 * (access back on), and `DeviceJoined`. A Device id that is this Host's
	 * own is refused.
	 */
	join(input: {
		id: string;
		name: string;
		platform: string;
		ownerId: string;
		homeHost: string | null;
		machine?: string | undefined;
	}): Promise<PairedDevice>;
	get(id: string): Promise<PairedDevice | null>;
	/** The Person's paired Devices, revoked ones last. */
	list(ownerId: string): Promise<PairedDevice[]>;
	/** Its link answered: last seen now, and `DeviceOnline` when it was offline. */
	seen(id: string): Promise<void>;
	/** `DeviceOffline` for each Device silent for longer than `offlineAfterMs`. */
	sweep(offlineAfterMs: number): Promise<void>;
	/** Access removed: `DeviceRevoked`, and `DeviceOffline` when it was online. */
	revoke(id: string): Promise<void>;
	/**
	 * Removes a Device whose access is gone, for good: its row, its Clones
	 * here and the Device document this Host kept for it. Refused while it
	 * still has access. The runs it walked keep its name.
	 */
	forget(id: string): Promise<void>;
	/**
	 * The owner of a Device document this Host keeps for a paired Device:
	 * one whose home Host it is, with access. Null for any other name.
	 */
	keptDocumentOwner(documentName: string): Promise<string | null>;
	/** The last event count this Replica has of a Device as a Walker: 0 for none (ADR 20). */
	lastWalkerSeq(deviceId: string): Promise<number>;
	/** This install becomes the Device its home Host knows this computer as (ADR 20). */
	adopt(deviceId: string, lastSeq?: number): Promise<void>;
	/** The Person who owns this computer's Device, or null before one does. */
	selfOwnerId(): Promise<string | null>;
	/** The Persons whose home Host this computer is. */
	homePersons(): Promise<string[]>;
};

/** The use cases of registry, bound to their ports. */
export type Registry = {
	/** Gives this computer's Device, made when there is none. */
	ensureSelfDevice: ReturnType<typeof ensureSelfDevice>;
	/** Reads the Person who owns this computer's Device. */
	readSelfOwner: DeviceStore["selfOwnerId"];
	/** Names the Person who owns this computer's Device. */
	setSelfOwner: ReturnType<typeof setSelfOwner>;
	/** Lists the names of Devices by id. */
	listDeviceNames: ReturnType<typeof listDeviceNames>;
	/** Lists the Persons whose home Host this computer is. */
	listHomePersons: DeviceStore["homePersons"];
	/**
	 * The Devices paired with this Host, over the engine's log. Made once
	 * per engine: it starts by marking offline the Devices the log still
	 * says are online (`closeStalePresence`).
	 */
	paired(engine: PairedDeps): DeviceRegistry;
};

export function wireRegistry(deps: RegistryDeps): Registry {
	const { db } = deps;
	const bound = wireSpaces({ db });
	const spaces: PersonalSpaces = {
		idOf: (personId) => bound.personal.findPersonalSpaceBySlug({ personId }),
	};
	const store = drizzleDeviceStore(db);
	const ports = {
		store,
		spaces,
		computer: thisComputer,
		newId: deps.newId ?? randomUUID,
		documentPrefix: deviceDocumentName(""),
	};

	function paired(engine: PairedDeps): DeviceRegistry {
		const facts: DeviceFacts = {
			log: (fact, before) =>
				before
					? engine.logFact(fact, {
							before: before as unknown as BatchItem<"sqlite">[],
						})
					: engine.logFact(fact),
		};
		const withEngine = {
			...ports,
			facts,
			history: engine.history,
			engineRows: engine.deviceRows,
			online: engine.presence ?? new Map<string, number>(),
			now: engine.now ?? timeNow,
		};
		const ready = closeStalePresence(withEngine)().catch((error) => {
			console.error("Device presence was not tidied up:", error);
		});
		const join = joinDevice(withEngine);
		const describe = describeDevice(withEngine);
		const sameMachine = findSameMachine(withEngine);
		const get = findDevice(withEngine);
		const list = listDevices(withEngine);
		const seen = markDeviceSeen(withEngine);
		const sweep = sweepPresence(withEngine);
		const revoke = revokeDevice(withEngine);
		const forget = forgetDevice(withEngine);
		const keptOwner = findKeptDocumentOwner(withEngine);
		const adopt = adoptSelfDevice(withEngine);
		return {
			async join(input) {
				await ready;
				return join(input);
			},
			describe: (id, said) => describe({ id, ...said }),
			sameMachine: (ownerId, machine, exceptId) =>
				sameMachine({ ownerId, machine, exceptId }),
			get: (id) => get({ id }),
			list: (ownerId) => list({ ownerId }),
			async seen(id) {
				await ready;
				return seen({ id });
			},
			async sweep(offlineAfterMs) {
				await ready;
				return sweep({ offlineAfterMs });
			},
			async revoke(id) {
				await ready;
				return revoke({ id });
			},
			async forget(id) {
				await ready;
				return forget({ id });
			},
			keptDocumentOwner: (documentName) => keptOwner({ documentName }),
			lastWalkerSeq: (deviceId) => engine.history.lastWalkerSeq(deviceId),
			adopt: (deviceId, lastSeq) =>
				adopt(lastSeq === undefined ? { deviceId } : { deviceId, lastSeq }),
			selfOwnerId: () => store.selfOwnerId(),
			homePersons: () => store.homePersons(),
		};
	}

	return {
		ensureSelfDevice: ensureSelfDevice(ports),
		readSelfOwner: () => store.selfOwnerId(),
		setSelfOwner: setSelfOwner(ports),
		listDeviceNames: listDeviceNames(ports),
		listHomePersons: () => store.homePersons(),
		paired,
	};
}
