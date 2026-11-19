import type { Actor, Relay, RunCommandInput } from "../contract";
import type { RunRow } from "../log";
import { RunRefusal } from "../run-status";

/**
 * Runs another Device walks. The Walker is the only writer of its run's
 * events, so an action on such a run travels to it as a command through
 * the Host (`Relay.command`), and the Walker applies it.
 */
export function createCommandRelay(deps: { relay?: Relay }) {
	const { relay } = deps;

	return {
		/** Hands an action on a run walked elsewhere to its Walker, in the actor's name. */
		async send(
			row: RunRow,
			actor: Actor | undefined,
			command: RunCommandInput,
		): Promise<void> {
			if (!relay) {
				throw new RunRefusal(
					"walker-unreachable",
					"Another device runs this run, and this computer cannot reach it.",
				);
			}
			if (!actor) {
				throw new RunRefusal("signed-out", "Sign in to act on this run.");
			}
			await relay.command({
				...command,
				spaceId: row.spaceId,
				runId: row.id,
				walkerId: row.walkerId,
				personId: actor.personId,
			});
		},
	};
}

export type CommandRelay = ReturnType<typeof createCommandRelay>;
