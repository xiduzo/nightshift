import { Refusal } from "@nightshift/refusal";
import type { Access } from "../../../access";
import { NIGHT_SHIFT } from "../../../contract";
import type { RunFacts, StartHolds, Turns } from "../../walk";
import type { checkResume } from "./check-resume";
import type { OpenWork } from "./ports";

export type ResumeInterruptedRunPorts = {
	/** Whether the engine stopped: a stopped engine resumes nothing. */
	stopped(): boolean;
	/** Startup recovery: a resume waits for it first. */
	recovered(): Promise<unknown>;
	/** Opens the run as Night Shift: its row, or not found. */
	openRun: Access["openRun"];
	/** A resume makes a run active: it waits while the Projects of the run's Space move. */
	holds: Pick<StartHolds, "start">;
	facts: Pick<RunFacts, "state">;
	turns: Pick<Turns, "isActive" | "take">;
	/** Why a run does not continue on its own, or null. */
	checkResume: ReturnType<typeof checkResume>;
	openWork: Pick<OpenWork, "letGo">;
};

/**
 * Resumes a run that startup recovery interrupted, in the same Turn as a
 * person's resume. While the Projects of its Space move, it waits for the
 * move, as a schedule that came due does. It checks again first: a person
 * may have resumed it, or its stop time came meanwhile. A full run cap
 * queues it: a freed slot asks again from the top. It never throws: a
 * failure is logged.
 */
export const resumeInterruptedRun = (ports: ResumeInterruptedRunPorts) => {
	const resume = async (runId: string): Promise<void> => {
		if (ports.stopped()) return;
		try {
			await ports.recovered();
			const spaceId = await ports.openRun(NIGHT_SHIFT, { runId }).then(
				({ run }) => run.spaceId,
				(error: unknown) => {
					if (error instanceof Refusal && error.kind === "not-found") {
						return null;
					}
					throw error;
				},
			);
			if (spaceId === null) return;
			await ports.holds.start(
				spaceId,
				async () => {
					if (ports.stopped()) return;
					const runState = await ports.facts.state(runId);
					if (
						ports.turns.isActive(runId) ||
						runState.status !== "interrupted"
					) {
						return;
					}
					const why = await ports.checkResume(runId, runState);
					if (why) {
						console.warn(
							`[engine] run ${runId} did not continue on its own: ${why}`,
						);
						await letGo(ports.openWork, runId);
						return;
					}
					await ports.turns.take(
						runId,
						{ kind: "resume", by: "daemon" },
						{ whenFull: "queue", retry: () => void resume(runId) },
					);
				},
				"wait",
			);
		} catch (error) {
			console.error(`[engine] could not resume run ${runId}`, error);
		}
	};
	return resume;
};

/** An interrupted run that does not continue lets go of what it holds. A failure is logged: a lease expires. */
async function letGo(
	openWork: Pick<OpenWork, "letGo">,
	runId: string,
): Promise<void> {
	try {
		await openWork.letGo(runId);
	} catch (error) {
		console.warn(`[engine] could not let go of what run ${runId} holds`, error);
	}
}
