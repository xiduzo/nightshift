import type { WorkRelay } from "../../contract";

/** A session under an Offer, on a run this computer walks. */
type OfferedSession = {
	runId: string;
	deviceId: string;
	spaceId: string;
	/** The profile as the node names it: its id, or its name for a run from before ids. */
	profile: string;
};

/** An Offer whose sessions withdrawing it stops: its profile's id and name. */
export type OfferRef = {
	spaceId: string;
	deviceId: string;
	profile: string;
	profileName: string;
};

/**
 * The offered sessions running now, of the runs this computer walks: what
 * withdrawing an Offer stops. A session is under an Offer when it names an
 * offered profile. The wire makes one and hands it to the admission.
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
				...(work.stops ? { stops: true } : {}),
				async *call(deviceId, request, signal, stop) {
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
						yield* work.call(deviceId, request, signal, stop);
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
