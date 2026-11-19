import type { Turns } from "../../walk";

export type StopRunForNightShiftPorts = { turns: Pick<Turns, "take"> };

/**
 * Night Shift stops a run, not a person: the Offer the run's step ran
 * under ended. The stop is a Turn of the run, by the daemon.
 */
export const stopRunForNightShift =
	(ports: StopRunForNightShiftPorts) =>
	async (runId: string): Promise<void> => {
		await ports.turns.take(runId, { kind: "stop", by: "daemon" });
	};
