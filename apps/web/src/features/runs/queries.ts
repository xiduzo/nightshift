/**
 * The query options of runs, and how often each run list polls
 * (`@nightshift/client`, on this app's client), and their mutations.
 *
 * Flows (start a run) sits below runs and uses these too. It imports them
 * through its peer port, `flows-port.ts` (`scripts/check-verticals.ts`),
 * because the runs vertical imports flows.
 */

import { createRunQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const runQueries = createRunQueries(orpc);

export const runMutations = {
	start: orpc.runs.start.mutationOptions,
	stop: orpc.runs.stop.mutationOptions,
	resume: orpc.runs.resume.mutationOptions,
	signal: orpc.runs.signal.mutationOptions,
	restartStep: orpc.runs.restartStep.mutationOptions,
	rerun: orpc.runs.rerun.mutationOptions,
	move: orpc.runs.move.mutationOptions,
	releaseLease: orpc.runs.releaseLease.mutationOptions,
	useful: orpc.runs.useful.mutationOptions,
	takeOver: orpc.runs.takeOver.mutationOptions,
};
