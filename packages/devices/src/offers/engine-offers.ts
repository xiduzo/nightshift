import type { Database } from "@nightshift/db";
import {
	type Device,
	HostUnreachableError,
	type RunLog,
	type RunRow,
	type SpaceDocuments,
} from "@nightshift/engine";
import type { AgentProfileSettings } from "@nightshift/flows";
import type { HostRelay, OfferCaps, WorkRelay } from "../contract";
import { personOnHost } from "../links";
import {
	createOfferSlots,
	type DeviceOffer,
	inForce,
	offeredDevice,
	publishOffer,
	type SpaceOffer,
	spaceOffers,
	unpublishOffer,
} from "./offers";

/** A session under an Offer, on a run this computer walks. */
type OfferedSession = {
	runId: string;
	deviceId: string;
	spaceId: string;
	profile: string;
};

/**
 * The offered sessions running now, of the runs this computer walks: what
 * withdrawing an Offer stops. A session is under an Offer when it names an
 * offered profile (`OfferedSessionInput`).
 */
export function createOfferedSessions() {
	const running = new Map<symbol, OfferedSession>();

	/** Notes a session under an Offer. The function it returns forgets it. */
	function track(entry: OfferedSession): () => void {
		const key = Symbol(entry.runId);
		running.set(key, entry);
		return () => running.delete(key);
	}

	return {
		track,

		/** The work relay, noting the offered sessions it carries. */
		relay(work: WorkRelay): WorkRelay {
			return {
				online: (deviceId, spaceId) => work.online(deviceId, spaceId),
				async *call(deviceId, request, signal) {
					const { call } = request;
					const untrack =
						call.kind === "session" &&
						"offered" in call.input &&
						request.runId !== null
							? track({
									runId: request.runId,
									deviceId,
									spaceId: request.spaceId,
									profile: call.input.offered.profile,
								})
							: null;
					try {
						yield* work.call(deviceId, request, signal);
					} finally {
						untrack?.();
					}
				},
			};
		},

		/** The runs whose running step is a session under the Offer. */
		runsUnder(offer: {
			spaceId: string;
			deviceId: string;
			profile: string;
		}): string[] {
			return [
				...new Set(
					[...running.values()]
						.filter(
							(e) =>
								e.spaceId === offer.spaceId &&
								e.deviceId === offer.deviceId &&
								e.profile === offer.profile,
						)
						.map((e) => e.runId),
				),
			];
		},
	};
}

export type OfferedSessions = ReturnType<typeof createOfferedSessions>;

/**
 * This computer as the Device of the runs it walks: as it is for its
 * owner's runs and a schedule's, else through its Offers only
 * (`offeredDevice`), at most each Offer's session cap at once.
 */
export function createOffersHere(deps: {
	db: Database;
	device: Device;
	documents: SpaceDocuments;
	/** This computer's own Offers (its Device document). Without it, none. */
	ownOffers?: () => readonly DeviceOffer[];
	profileFor?: (name: string) => AgentProfileSettings | null;
	/** The Person who owns this computer, or null before the engine knows. */
	ownerId(): string | null;
	sessions: OfferedSessions;
}) {
	const { db, device, documents } = deps;
	const slots = createOfferSlots();

	/** This computer's Offers into a Space that are in force: its own, and the Space lists them. */
	async function offersHere(spaceId: string): Promise<DeviceOffer[]> {
		return inForce(
			deps.ownOffers?.() ?? [],
			spaceOffers(await documents.open(spaceId), device.id),
			spaceId,
		);
	}

	/**
	 * Whether a run is this computer's owner's own (as the Space's Host
	 * knows them), or a schedule's without a Person. Another Person's run
	 * uses this computer through its Offers only.
	 */
	const ownRun = async (row: Pick<RunRow, "startedBy" | "spaceId">) =>
		row.startedBy === null ||
		row.startedBy === ((await personOnHost(db, row.spaceId)) ?? deps.ownerId());

	return {
		offersHere,
		/** This computer as the Device of the run (`PlacementDeps.localFor`). */
		localFor(row: RunRow): Device {
			if (row.startedBy === null) return device;
			return offeredDevice(device, {
				own: () => ownRun(row),
				inForce: () => offersHere(row.spaceId),
				profileFor: deps.profileFor ?? (() => null),
				slots,
				spaceId: row.spaceId,
				track: (profile) =>
					deps.sessions.track({
						runId: row.id,
						deviceId: device.id,
						spaceId: row.spaceId,
						profile,
					}),
			});
		},
	};
}

/**
 * The Offers as the Space documents publish them. Who may make or
 * withdraw one is the caller's check (the Device's owner, a role that
 * allows `offer.make`); the Device's own entry is the daemon's (its
 * Device document).
 */
export type EngineOffers = {
	/** The Offers a Space lists, every Device's. */
	list(spaceId: string): Promise<SpaceOffer[]>;
	/**
	 * Publishes an Offer (or its new caps) in the Space's document and logs
	 * `OfferMade` there. A Space a Host keeps: through that Host, which
	 * logs it in the name of this Device's owner.
	 */
	publish(
		input: OfferCaps & {
			spaceId: string;
			deviceId: string;
			deviceName: string;
			profile: string;
			by: string | null;
		},
	): Promise<void>;
	/**
	 * Takes an Offer off the Space's document, logs `OfferWithdrawn`, and
	 * stops the runs walked here whose running step is a session under it:
	 * the step ends as stopped. A Space a Host keeps: through that Host.
	 * Nothing to withdraw is no error.
	 */
	withdraw(input: {
		spaceId: string;
		deviceId: string;
		profile: string;
		by: string | null;
	}): Promise<void>;
};

/**
 * The Offers of the Spaces: published in their documents, with their
 * audit (`OfferMade`, `OfferWithdrawn`). In a Space a Host keeps, this
 * computer publishes and withdraws its own Offers through that Host.
 */
export function createEngineOffers(deps: {
	/** Every method waits for the engine to be ready. */
	ready: Promise<unknown>;
	documents: SpaceDocuments;
	log: Pick<RunLog, "append">;
	deviceId: string;
	now(): number;
	/** The Host that keeps the Space, or null for a Space of this Replica's own. */
	hostOf(spaceId: string): Promise<string | null>;
	relay?: Pick<HostRelay, "offer" | "withdrawOffer">;
	/** Stops the runs walked here whose running step is a session under the Offer. */
	stopUnder(offer: {
		spaceId: string;
		deviceId: string;
		profile: string;
	}): Promise<void>;
}): EngineOffers {
	const { documents, log, relay } = deps;
	return {
		async list(spaceId) {
			await deps.ready;
			return spaceOffers(await documents.open(spaceId));
		},

		async publish(input) {
			await deps.ready;
			const { spaceId, by, ...offer } = input;
			if ((await deps.hostOf(spaceId)) !== null) {
				if (!relay || offer.deviceId !== deps.deviceId) {
					throw new HostUnreachableError();
				}
				await relay.offer({
					spaceId,
					profile: offer.profile,
					deviceName: offer.deviceName,
					permissionCap: offer.permissionCap,
					sessionCap: offer.sessionCap,
				});
				return;
			}
			const document = await documents.open(spaceId);
			await document.change(() =>
				publishOffer(document, { ...offer, offeredAt: deps.now(), by }),
			);
			await log.append({
				type: "OfferMade",
				spaceId,
				payload: {
					deviceId: offer.deviceId,
					deviceName: offer.deviceName,
					profile: offer.profile,
					permissionCap: offer.permissionCap,
					sessionCap: offer.sessionCap,
					by,
				},
			});
		},

		async withdraw(input) {
			await deps.ready;
			const { spaceId, deviceId, profile, by } = input;
			if ((await deps.hostOf(spaceId)) !== null) {
				if (!relay || deviceId !== deps.deviceId) {
					throw new HostUnreachableError();
				}
				await relay.withdrawOffer({ spaceId, profile });
				// The runs this computer walks stop their steps under it too.
				await deps.stopUnder({ spaceId, deviceId, profile });
				return;
			}
			const document = await documents.open(spaceId);
			let removed = false;
			await document.change(() => {
				removed = unpublishOffer(document, deviceId, profile);
			});
			if (removed) {
				await log.append({
					type: "OfferWithdrawn",
					spaceId,
					payload: { deviceId, profile, by },
				});
			}
			await deps.stopUnder({ spaceId, deviceId, profile });
		},
	};
}
