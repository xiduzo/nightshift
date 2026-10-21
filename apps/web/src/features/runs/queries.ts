/**
 * The query and mutation options of runs, and how often each run list polls
 * (`@nightshift/client`, on this app's client).
 *
 * Flows (start a run) and gates (the inbox) sit below runs and use these
 * too. They import this file through a peer port
 * (`scripts/check-verticals.ts`), because the runs vertical imports them.
 */

import { createRunMutations, createRunQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const runQueries = createRunQueries(orpc);

export const runMutations = createRunMutations(orpc);
