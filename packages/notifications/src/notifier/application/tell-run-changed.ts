import type { GateTracker } from "../domain/gate-tracker";
import type { CloseNotice } from "./close-notice";

export type TellRunChangedPorts = {
	gates: Pick<GateTracker, "recheck">;
	/** `closeNotice`, bound by the wire. */
	close(notice: CloseNotice): Promise<void>;
};

/** The run whose commands changed. */
export type TellRunChanged = { spaceId: string; runId: string };

/**
 * A command of the run was kept for the Device that walks it, or that
 * Device applied or refused it. Reads the run's Gates again: a Gate with
 * an answer on its way closes everywhere now.
 */
export const tellRunChanged =
	(ports: TellRunChangedPorts) =>
	async ({ spaceId, runId }: TellRunChanged): Promise<void> => {
		const { closed } = await ports.gates.recheck(spaceId, runId);
		for (const key of closed) await ports.close({ spaceId, key });
	};
