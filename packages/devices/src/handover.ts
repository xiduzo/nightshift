import type { DevicePresence, PendingPairings } from "./devices";
import { createOfferUse, type OfferUse } from "./devices";
import type { AppliedCommands } from "./exchange";
import { createWorkHub, type ServedCalls, type WorkHub } from "./work";

/**
 * The reload of the devices runtime: what `bun --hot` keeps of it, what
 * one runtime hands the next, and how the next one takes over
 * (`startDevices` in `wire.ts`).
 */

/**
 * What `bun --hot` keeps of the devices: one slot, the handover of the
 * newest runtime.
 */
export type KeptDevices = {
	nightshiftDevices?: Handover;
	/** The latest start, ended or failed: the next start waits for it (`startDevices`). */
	nightshiftDevicesStart?: Promise<void>;
};

/**
 * What one runtime hands the next across a reload. The parts outlive the
 * runtime that made them; each runtime binds them to its own engine.
 */
export type Handover = {
	/**
	 * On a Host: the calls of the runs it walks, for the Devices they are
	 * placed on. A Device's stream outlives a reload.
	 */
	readonly hub: WorkHub;
	/**
	 * The sessions and the calls under each of this computer's Offers, by
	 * either path: the engine's Offer admission counts them in one slot map
	 * per Offer, so a session that runs on through a reload still counts.
	 */
	readonly offerUse: OfferUse;
	/**
	 * On a Host: the Devices online now, and the pairings in progress. A
	 * Device's link outlives a reload, and so does a code it asked for.
	 */
	readonly presence: DevicePresence;
	readonly pending: PendingPairings;
	/** Per Host: the commands this computer applied, and the calls it serves as a placed Device. */
	readonly hosts: Map<
		string,
		{ applied: AppliedCommands; served: ServedCalls }
	>;
	/** A Device took work again: the newest engine's steps that wait for it look again. */
	wake(deviceId: string): void;
	/** Stops what the next runtime replaces: the Links, the presence sweep, then the engine. */
	release(): Promise<void>;
};

/**
 * The handover of the runtime before this one, once it let go. Fresh on
 * the first start.
 */
export async function takeOver(kept: KeptDevices): Promise<Handover> {
	const before = kept.nightshiftDevices;
	if (before) {
		await before.release();
		// Nothing keeps the runtime before: a Device back meanwhile waits for its minute.
		before.wake = () => {};
		before.release = async () => {};
		return before;
	}
	const handover: Handover = {
		hub: createWorkHub({ onBack: (deviceId) => handover.wake(deviceId) }),
		offerUse: createOfferUse(),
		presence: new Map(),
		pending: new Map(),
		hosts: new Map(),
		wake: () => {},
		release: async () => {},
	};
	return handover;
}

/** The engine before a reload lets go of its runs: else its drives run on beside the next engine's. */
export async function letGo(engine: {
	dispose(): Promise<void>;
}): Promise<void> {
	await engine.dispose().catch((error) => {
		console.error(
			"The engine before the reload did not let go of its runs:",
			error,
		);
	});
}
