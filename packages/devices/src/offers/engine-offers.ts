import {
	HostUnreachableError,
	type RunLog,
	type SpaceDocuments,
} from "@nightshift/engine";
import type { HostRelay, OfferCaps, WorkRelay } from "../contract";
import {
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
	/** The profile as the node names it: its id, or its name for a run from before ids. */
	profile: string;
};

/** An Offer whose sessions withdrawing it stops: its profile's id and name. */
type OfferRef = {
	spaceId: string;
	deviceId: string;
	profile: string;
	profileName: string;
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
		/**
		 * A work relay, noting the offered sessions it carries: to other
		 * Devices, and to this one through its admission.
		 */
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
		runsUnder(offer: OfferRef): string[] {
			return [
				...new Set(
					[...running.values()]
						.filter(
							(e) =>
								e.spaceId === offer.spaceId &&
								e.deviceId === offer.deviceId &&
								(e.profile === offer.profile ||
									e.profile === offer.profileName),
						)
						.map((e) => e.runId),
				),
			];
		},
	};
}

export type OfferedSessions = ReturnType<typeof createOfferedSessions>;

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
			/** The profile's id. */
			profile: string;
			profileName: string;
			by: string | null;
		},
	): Promise<void>;
	/**
	 * Takes an Offer off the Space's document, logs `OfferWithdrawn`, and
	 * stops the runs walked here whose running step is a session under it:
	 * the step ends as stopped. A Space a Host keeps: through that Host,
	 * and the runs walked here stop also when it cannot be reached. A run
	 * walked elsewhere is its Walker's to stop: the offering Device aborts
	 * its session (`OfferAdmission.withdrawn`). Nothing to withdraw is no
	 * error.
	 */
	withdraw(input: {
		spaceId: string;
		deviceId: string;
		/** The profile's id. */
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
	stopUnder(offer: OfferRef): Promise<void>;
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
					profileName: offer.profileName,
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
					profileName: offer.profileName,
					permissionCap: offer.permissionCap,
					sessionCap: offer.sessionCap,
					by,
				},
			});
		},

		async withdraw(input) {
			await deps.ready;
			const { spaceId, deviceId, profile, by } = input;
			const document = await documents.open(spaceId);
			// A session names the profile by its id, one from before ids by
			// its name, as the Space lists it.
			const listed = spaceOffers(document, deviceId).find(
				(o) => o.profile === profile,
			);
			const stop = {
				spaceId,
				deviceId,
				profile,
				profileName: listed?.profileName ?? profile,
			};
			if ((await deps.hostOf(spaceId)) !== null) {
				if (!relay || deviceId !== deps.deviceId) {
					throw new HostUnreachableError();
				}
				try {
					await relay.withdrawOffer({ spaceId, profile });
				} finally {
					// The runs this computer walks stop their steps under it too,
					// also when the Host cannot be reached.
					await deps.stopUnder(stop);
				}
				return;
			}
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
			await deps.stopUnder(stop);
		},
	};
}
