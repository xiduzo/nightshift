import {
	personOf,
	type Relay,
	type RunCommandKind,
} from "../../../../contract";
import { RunRefusal } from "../../../../run-status";
import type { Walkers } from "../../application/ports";

export type RelayWalkersDeps = {
	/** The Hosts this computer reaches (`Peers.relay`). Absent: none. */
	relay?: Pick<Relay, "command">;
	/** The Commands that wait for the Walkers of runs (`RunsPort.pendingCommands`). */
	pendingCommands(
		runIds: readonly string[],
	): Promise<Map<string, readonly { kind: RunCommandKind }[]>>;
};

/**
 * The Walkers of the runs another Device walks. The Walker is the only
 * writer of its run's events, so an action on such a run travels to it
 * as a Command through the Host (`Relay.command`), and the Walker applies
 * it.
 */
export function relayWalkers(deps: RelayWalkersDeps): Walkers {
	const { relay } = deps;
	return {
		async send(run, actor, command) {
			if (!relay) {
				throw new RunRefusal(
					"walker-unreachable",
					"Another device runs this run, and this computer cannot reach it.",
				);
			}
			const personId = personOf(actor);
			if (personId === null) {
				throw new RunRefusal("signed-out", "Sign in to act on this run.");
			}
			await relay.command({
				...command,
				spaceId: run.spaceId,
				runId: run.id,
				walkerId: run.walkerId,
				personId,
			});
		},
		async pending(runId) {
			const pending = (await deps.pendingCommands([runId])).get(runId) ?? [];
			return pending.map((command) => command.kind);
		},
	};
}
