/**
 * What the flows vertical uses of runs, through one peer port
 * (`scripts/check-verticals.ts`): the run queries, to start a run and read
 * a project's runs, the run bars, for a flow's last runs, and how
 * long a step worked and what it did, for a step the chat cites. The run
 * page imports the flow canvas, so the runs barrel would close a cycle.
 * These files import only `shared/*` and the packages.
 */

export { WorkTime } from "./components/elapsed";
export { RunBars } from "./components/run-bars";
export { stepGist } from "./lib/step-gist";
export { runMutations, runQueries } from "./queries";
