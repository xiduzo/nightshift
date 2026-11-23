import { Refusal } from "@nightshift/refusal";

/** Why a session that waited for a free one of the Offer did not start: it was stopped. */
const SESSION_STOPPED = "The session was stopped.";

/** The key of an Offer's sessions and calls. */
export const offerKey = (spaceId: string, profile: string) =>
	`${spaceId}/${profile}`;

/**
 * The Offers in use on this computer: the sessions running under each
 * Offer (`slots`, at most its cap at once) and the calls under each
 * (`calls`, to abort when it is withdrawn). They outlive an admission: a
 * `bun --hot` reload hands them to the next engine's, so a session that
 * runs on through the reload still counts against its Offer. Keyed by the
 * Space and the profile's id.
 */
export type OfferUse = {
	slots: {
		/**
		 * Waits for a free session of the Offer, first come first served, and
		 * resolves to its release. A session over the cap waits; it is not
		 * refused. Rejects when `signal` aborts while it waits.
		 */
		take(key: string, cap: number, signal: AbortSignal): Promise<() => void>;
		/** The sessions running under the Offer now. */
		running(key: string): number;
	};
	calls: {
		/** Notes a call under an Offer; the returned function forgets it. */
		add(spaceId: string, profile: string, abort: () => void): () => void;
		/** Aborts the calls under a withdrawn Offer. */
		withdrawn(spaceId: string, profile: string): void;
	};
};

export function createOfferUse(): OfferUse {
	return { slots: createOfferSlots(), calls: createOfferCalls() };
}

function createOfferSlots(): OfferUse["slots"] {
	const running = new Map<string, number>();
	const waiting = new Map<string, (() => void)[]>();

	function release(key: string) {
		running.set(key, (running.get(key) ?? 1) - 1);
		waiting.get(key)?.shift()?.();
	}

	return {
		running: (key) => running.get(key) ?? 0,
		async take(key, cap, signal) {
			while ((running.get(key) ?? 0) >= cap) {
				if (signal.aborted) throw new Refusal("conflict", SESSION_STOPPED);
				await new Promise<void>((resolve, reject) => {
					const queue = waiting.get(key) ?? [];
					waiting.set(key, queue);
					const wake = () => {
						signal.removeEventListener("abort", stop);
						resolve();
					};
					const stop = () => {
						const at = queue.indexOf(wake);
						if (at >= 0) queue.splice(at, 1);
						reject(new Refusal("conflict", SESSION_STOPPED));
					};
					queue.push(wake);
					signal.addEventListener("abort", stop, { once: true });
				});
			}
			running.set(key, (running.get(key) ?? 0) + 1);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				release(key);
			};
		},
	};
}

function createOfferCalls(): OfferUse["calls"] {
	const running = new Map<symbol, { key: string; abort: () => void }>();
	return {
		add(spaceId, profile, abort) {
			const id = Symbol(profile);
			running.set(id, { key: offerKey(spaceId, profile), abort });
			return () => running.delete(id);
		},
		withdrawn(spaceId, profile) {
			const key = offerKey(spaceId, profile);
			for (const call of running.values()) if (call.key === key) call.abort();
		},
	};
}
