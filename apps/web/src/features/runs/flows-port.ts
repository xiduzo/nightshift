/**
 * What the flows vertical uses of runs, through one peer port
 * (`scripts/check-verticals.ts`): the run queries, to start a run and read
 * a project's runs, and the run status icon, for a flow's last runs. The
 * run page imports the flow canvas, so the runs barrel would close a cycle.
 * Both files import only `shared/api` and the packages.
 */

export { RunStatusIcon } from "./components/run-status-badge";
export { runMutations, runQueries } from "./queries";
