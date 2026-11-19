import type { WaitReason } from "../../../log";
import type { Turns } from "../../walk";
import type { Waits } from "./ports";

export type WakeSleepingRunsPorts = {
	waits: Pick<Waits, "sleeping">;
	turns: Pick<Turns, "take">;
};

/**
 * Wakes the steps of the runs this computer walks that sleep for
 * `reason`: a Device is back (`device-offline`), or a lease of this
 * computer's store went (`lease`). Each looks again now. One whose Device
 * is still away, or whose lease is still busy, sleeps again. It does not
 * wait for the wakes, and a wake that fails changes nothing.
 */
export const wakeSleepingRuns =
	(ports: WakeSleepingRunsPorts) =>
	async (reason: WaitReason): Promise<void> => {
		for (const [runId, sleep] of await ports.waits.sleeping()) {
			if (sleep?.reason !== reason) continue;
			ports.turns
				.take(runId, { kind: "wake", early: true, by: "daemon" })
				.catch(() => {});
		}
	};
