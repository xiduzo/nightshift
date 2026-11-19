import type { Held } from "../../../../graph";
import { olderNightShift } from "../../../../placement";
import { THIS_COMPUTER } from "../../../access/adapters/out/in-memory-run-records";
import { inMemoryActionPorts } from "../../../actions/adapters/out/in-memory-neighbours";
import { inMemoryMoveDevices } from "./in-memory-move-devices";
import { inMemoryWalkHandover } from "./in-memory-walk-handover";

export {
	ADA,
	FAR,
	SPACE,
	stateOf,
	VIC,
} from "../../../actions/adapters/out/in-memory-neighbours";

/** This computer as a Device: its id differs from its id as the Walker of its runs. */
export const THIS_DEVICE = "device-here";

/**
 * Every port of the move in memory at once: where each use-case test
 * starts. The run's facts, its Turns, its Walker and the check of who
 * may act are those of the actions' tests (`ADA` is a member of `SPACE`,
 * `VIC` a viewer, `put` puts a run in). On top: the Person's Devices,
 * the hand-over of the walk state, this computer as a Device, and the
 * words of an older Night Shift. The Turns record the options of each
 * Turn that drives nothing (`held`).
 */
export function inMemoryMovePorts() {
	const ports = inMemoryActionPorts();
	const { turns } = ports;
	const hold = turns.hold;
	const held: { runId: string; arrival: boolean }[] = [];
	return {
		...ports,
		turns: Object.assign(turns, {
			hold<T>(
				runId: string,
				work: (held: Held) => Promise<T>,
				options?: { arrival?: boolean },
			): Promise<T> {
				held.push({ runId, arrival: options?.arrival === true });
				return hold(runId, work, options);
			},
		}),
		/** Each Turn that drives nothing, with whether it is the Turn of an arrival. */
		held,
		devices: inMemoryMoveDevices(),
		handover: inMemoryWalkHandover(THIS_COMPUTER),
		device: { id: THIS_DEVICE },
		olderNightShift,
	};
}

export type InMemoryMovePorts = ReturnType<typeof inMemoryMovePorts>;
