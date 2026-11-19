import type { Relay, RunCommandKind } from "../../../../contract";
import { inMemoryWalkers } from "./in-memory-walkers";
import { relayWalkers } from "./relay-walkers";
import { type CarriedCommand, walkersContract } from "./walkers.contract";

/**
 * The contract of `Walkers`, on both adapters. The real side is the
 * adapter over a Host's relay (`Relay.command`) and the Commands that
 * wait (`RunsPort.pendingCommands`). `devices` gives both in a daemon:
 * here a Host in memory keeps the Commands it took until their Walker
 * applies them.
 */

walkersContract("in memory", async (reachable) => {
	const walkers = inMemoryWalkers({ reachable });
	return {
		walkers,
		carried: () => walkers.sent as CarriedCommand[],
		done: async (runId) => walkers.done(runId),
		close: async () => {},
	};
});

walkersContract("over a Host's relay", async (reachable) => {
	const carried: CarriedCommand[] = [];
	const waiting: { runId: string; kind: RunCommandKind }[] = [];
	const relay: Pick<Relay, "command"> = {
		async command(command) {
			carried.push(command);
			waiting.push({ runId: command.runId, kind: command.kind });
		},
	};
	return {
		walkers: relayWalkers({
			...(reachable ? { relay } : {}),
			async pendingCommands(runIds) {
				return new Map(
					runIds.map((id) => [id, waiting.filter((c) => c.runId === id)]),
				);
			},
		}),
		carried: () => carried,
		async done(runId) {
			for (let i = waiting.length - 1; i >= 0; i--) {
				if (waiting[i]?.runId === runId) waiting.splice(i, 1);
			}
		},
		close: async () => {},
	};
});
