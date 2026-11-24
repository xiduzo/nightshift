import { randomUUID } from "node:crypto";
import type { Access } from "../../access";
import { kindOf, resolveInputs, runFolderOn } from "../../graph";
import { runDueAt } from "../../log";
import type { Projects } from "../../projects";
import type { StartHolds, wireWalk } from "../walk";
import {
	type DirectorySpaceKeeperDeps,
	directorySpaceKeeper,
} from "./adapters/out/directory-space-keeper";
import { type LogNewRunsDeps, logNewRuns } from "./adapters/out/log-new-runs";
import {
	type PlacementRunPlannerDeps,
	placementRunPlanner,
} from "./adapters/out/placement-run-planner";
import {
	type ReadStartersDeps,
	readStarters,
} from "./adapters/out/read-starters";
import {
	type RelayHostStartsDeps,
	relayHostStarts,
} from "./adapters/out/relay-host-starts";
import { listDevices } from "./application/list-devices";
import { listPlacements } from "./application/list-placements";
import { startRun } from "./application/start-run";
import { startRunHere } from "./application/start-run-here";
import { startRunOnHost } from "./application/start-run-on-host";
import { startScheduledRun } from "./application/start-scheduled-run";
import { START_DEADLINE_MS } from "./domain/start-deadline";

/**
 * The wiring of the start: the one place that builds its real adapters
 * (the plan over Placement, who keeps a Space, the starts on a Host, the
 * new runs over the run log, the starters over the Persons of this
 * Replica) and binds each use case to its ports.
 */

/** The walk's ports, as `wireWalk` builds them. */
type Walk = ReturnType<typeof wireWalk>;

/** What the engine gives the start: what its real adapters stand on, and what it takes of its neighbours. */
export type StartDeps = {
	planner: PlacementRunPlannerDeps;
	keeper: DirectorySpaceKeeperDeps;
	hosts: RelayHostStartsDeps;
	runs: LogNewRunsDeps;
	starters: ReadStartersDeps;
	/** The projects of this Replica (`projects/`). */
	projects: Pick<Projects, "find">;
	/** Who may act in a Space (`access`). */
	openSpace: Access["openSpace"];
	/** The walk: the start's Turn, the run's facts, and the start holds of a Space move. */
	turns: Pick<Walk["turns"], "take">;
	facts: Pick<Walk["facts"], "append" | "walkerId">;
	holds: Pick<StartHolds, "start">;
	now(): number;
};

/** The use cases of the start, bound to their ports. */
export type Start = {
	/** A start by a person, or by Night Shift in this process. */
	startRun: ReturnType<typeof startRun>;
	/** A schedule's or a webhook's start. */
	startScheduledRun: ReturnType<typeof startScheduledRun>;
	/** The Devices a person chooses from to start a run. */
	listPlacements: ReturnType<typeof listPlacements>;
	/** The Devices a person may place a run's steps on. */
	listDevices: ReturnType<typeof listDevices>;
};

export function wireStart(deps: StartDeps): Start {
	const planner = placementRunPlanner(deps.planner);
	const keeper = directorySpaceKeeper(deps.keeper);
	const runs = logNewRuns(deps.runs);
	const here = startRunHere({
		projects: deps.projects,
		planner,
		runs,
		starters: readStarters(deps.starters),
		turns: deps.turns,
		facts: deps.facts,
		holds: deps.holds,
		now: deps.now,
		newRunId: () => randomUUID(),
		deadlineMs: START_DEADLINE_MS,
		rules: {
			works: (node) => kindOf(node).works(node),
			resolveInputs,
			runFolderOn,
			dueAt: runDueAt,
		},
	});
	const onHost = startRunOnHost({ runs, hosts: relayHostStarts(deps.hosts) });
	const placing = {
		projects: deps.projects,
		keeper,
		facts: deps.facts,
		here,
		onHost,
	};
	return {
		startRun: startRun({ ...placing, openSpace: deps.openSpace }),
		startScheduledRun: startScheduledRun(placing),
		listPlacements: listPlacements({ planner, openSpace: deps.openSpace }),
		listDevices: listDevices({ planner, openSpace: deps.openSpace }),
	};
}
