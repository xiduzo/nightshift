/**
 * The query options of runs, and how often each run list polls
 * (`@nightshift/client`, on this app's client), and their mutations.
 *
 * Flows (start a run) and gates (the inbox) sit below runs and use these
 * too. They import this file through a peer port
 * (`scripts/check-verticals.ts`), because the runs vertical imports them.
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
};
