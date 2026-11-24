import type { Access } from "../../../access";
import { type Actor, commandOf, permissionOf } from "../../../contract";
import { isTestRun } from "../../../run-status";
import type { UsageNotes } from "../../../usage";
import type { RunFacts, Walkers } from "../../walk";

export type MarkRunUsefulPorts = {
	openRun: Access["openRun"];
	facts: Pick<RunFacts, "state" | "append">;
	walkers: Pick<Walkers, "send">;
	/** Anonymous usage, when this computer records it. */
	usage?: Pick<UsageNotes, "note">;
};

/** Which run, in which Space when the caller holds one, and whether it was useful. */
export type MarkRunUseful = {
	runId: string;
	spaceId?: string;
	useful: boolean;
};

/**
 * Records whether a person found the run useful: the score `useful` on
 * the run. A later answer replaces it. The actor's role must allow
 * `run.stop` in the run's Space. A run another Device walks: the answer
 * travels to its Walker as a Command. A run this computer walks: `Scored`
 * in its log, and a usage note unless it is a test run (ADR 27).
 */
export const markRunUseful =
	(ports: MarkRunUsefulPorts) =>
	async (actor: Actor, request: MarkRunUseful): Promise<void> => {
		const { facts, usage } = ports;
		const { runId: _, spaceId, ...fields } = request;
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId,
			need: permissionOf("useful"),
		});
		if (!walkedHere) {
			const command = commandOf({ kind: "useful", ...fields });
			if (command) await ports.walkers.send(run, actor, command);
			return;
		}
		const value = request.useful ? 1 : 0;
		await facts.append({
			type: "Scored",
			runId: run.id,
			stepId: null,
			payload: { score: "useful", value, label: null },
		});
		// A test run sends no usage event (ADR 27): its answer counts nowhere.
		if (usage && !isTestRun(await facts.state(run.id))) {
			usage.note({ kind: "run-scored", runId: run.id, score: "useful", value });
		}
	};
