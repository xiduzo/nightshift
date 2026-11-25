import type { Access } from "../../access";
import { rerunNodeRefusal } from "../../graph";
import {
	deriveSteps,
	lastHarnessSession,
	parseRunFlow,
	takesPrompt,
} from "../../read";
import type { UsageNotes } from "../../usage";
import type { Walk } from "../walk";
import {
	type KeeperRunLeasesDeps,
	keeperRunLeases,
} from "./adapters/out/keeper-run-leases";
import { type ActOnRunPorts, actOnRun } from "./application/act-on-run";
import { markRunUseful } from "./application/mark-run-useful";
import { recordTakeOver } from "./application/record-take-over";
import { releaseLease } from "./application/release-lease";
import { rerunFromNode } from "./application/rerun-from-node";
import { restartStep } from "./application/restart-step";
import { resumeRun } from "./application/resume-run";
import { sendSignal } from "./application/send-signal";
import { stopRun } from "./application/stop-run";

/**
 * The wiring of the actions: the one place that builds their real adapter
 * (the leases over the lease keeper) and binds each use case to its ports.
 * The ports every action shares come from `runs/walk`, the check of who
 * may act from `access`.
 */

/** What the engine gives the actions: the sibling sub-verticals, and what the real adapter stands on. */
export type ActionsDeps = {
	access: Pick<Access, "openRun">;
	walk: Pick<Walk, "facts" | "turns" | "walkers" | "holds">;
	/** The lease keeper (`leases/`). */
	leases: KeeperRunLeasesDeps;
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
	/** The answer to a Gate (`gates/`), and the move of a run (`runs/move/`). */
	answer: ActOnRunPorts["answer"];
	move: ActOnRunPorts["move"];
};

/** The use cases of the actions, bound to their ports. */
export type Actions = {
	/** Does what an action asks of a run: hands it to the use case of its kind. */
	actOnRun: ReturnType<typeof actOnRun>;
	/** Stops a run, now or after its running step. */
	stopRun: ReturnType<typeof stopRun>;
	/** Continues a run at its last step, or wakes it. */
	resumeRun: ReturnType<typeof resumeRun>;
	/** Stops the running step and continues it at once. */
	restartStep: ReturnType<typeof restartStep>;
	/** Walks a run again from a node of its flow. */
	rerunFromNode: ReturnType<typeof rerunFromNode>;
	/** Sends a run the Signal its Wait node waits for. */
	sendSignal: ReturnType<typeof sendSignal>;
	/** Lets go of a lease the run holds. */
	releaseLease: ReturnType<typeof releaseLease>;
	/** Records whether a person found the run useful. */
	markRunUseful: ReturnType<typeof markRunUseful>;
	/** Records that a person took the run over by hand. */
	recordTakeOver: ReturnType<typeof recordTakeOver>;
};

export function wireActions(deps: ActionsDeps): Actions {
	const { openRun } = deps.access;
	const { facts, turns, walkers, holds } = deps.walk;
	const shared = { openRun, facts, turns, walkers };
	const cases = {
		stopRun: stopRun(shared),
		resumeRun: resumeRun({ ...shared, holds, takesPrompt }),
		restartStep: restartStep({ ...shared, holds, deriveSteps }),
		rerunFromNode: rerunFromNode({
			...shared,
			holds,
			flowOf: parseRunFlow,
			rerunNodeRefusal,
		}),
		sendSignal: sendSignal(shared),
		releaseLease: releaseLease({
			...shared,
			leases: keeperRunLeases(deps.leases),
		}),
		markRunUseful: markRunUseful({
			...shared,
			...(deps.usage ? { usage: deps.usage } : {}),
		}),
		recordTakeOver: recordTakeOver({ ...shared, lastHarnessSession }),
	};
	return {
		...cases,
		actOnRun: actOnRun({
			stop: cases.stopRun,
			useful: cases.markRunUseful,
			signal: cases.sendSignal,
			releaseLease: cases.releaseLease,
			resume: cases.resumeRun,
			restart: cases.restartStep,
			rerun: cases.rerunFromNode,
			takeOver: cases.recordTakeOver,
			answer: deps.answer,
			move: deps.move,
		}),
	};
}
