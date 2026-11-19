import type { Database } from "@nightshift/db";
import { createArtifactStore } from "./artifacts";
import type { EngineOptions } from "./engine-options";
import type { ProjectFlows } from "./flows";
import {
	createRecorders,
	createRunner,
	kindOf,
	type StepShared,
} from "./graph";
import { readMemory } from "./memory";
import { gitAuthorOf, parseCalledFlows, parseRunFlow } from "./read";
import { keptValues } from "./variables";

type RunnerDeps = Parameters<typeof createRunner>[0];

/**
 * The walk block of the engine's composition (`wire.ts`): what a step may
 * touch on this computer (`StepShared`, the same for every run) and the
 * runner that drives the runs (`graph/runner/`). The files runs keep for
 * the person are made here too.
 *
 * It gives `artifacts` and `runner`.
 */
export function wireEngineRunner(deps: {
	db: Database;
	dataDir: string;
	log: StepShared["log"];
	bus: StepShared["bus"];
	placement: StepShared["placement"];
	now(): number;
	minuteMs: number;
	settings: StepShared["settings"];
	leases: StepShared["leases"];
	services: StepShared["services"];
	flows: Pick<ProjectFlows, "keepShapes" | "keepOutputTypes">;
	usage: EngineOptions["usage"];
	/** The engine's lifetime. */
	signal: AbortSignal;
	holds: NonNullable<RunnerDeps["holds"]>;
	/** How often the runner looks for overdue steps (`EngineInternals.overdueSweepMs`). */
	overdueSweepMs: number | undefined;
}) {
	const { db, log: runLog, bus, flows } = deps;
	/** The files runs keep for the person: an agent's artifacts, the answers' files. */
	const artifacts = createArtifactStore(deps.dataDir);
	/** What a step may touch on this computer, the same for every run. */
	const shared: StepShared = {
		log: runLog,
		bus,
		recorders: createRecorders({ db, bus, log: runLog }),
		placement: deps.placement,
		now: deps.now,
		minuteMs: deps.minuteMs,
		settings: deps.settings,
		kindOf,
		leases: deps.leases,
		services: deps.services,
		artifacts,
		keptValues: (flow) => keptValues(db, flow),
		remembered: (at) => readMemory(db, at),
		// The Walker keeps the shape of a step's data on its node (Q40).
		keepShapes: async (flow, node, shapes) => {
			await flows.keepShapes(flow.projectId, flow.flowName, node, shapes);
		},
		// And the type of a called flow's output (Q40).
		keepOutputTypes: async (flow, types) => {
			await flows.keepOutputTypes(flow.projectId, flow.flowName, types);
		},
		gitAuthor: (personId) => gitAuthorOf(db, personId),
		...(deps.usage ? { usage: deps.usage } : {}),
	};
	const runner = createRunner({
		shared,
		db,
		flowOf: parseRunFlow,
		calledFlowsOf: parseCalledFlows,
		signal: deps.signal,
		holds: deps.holds,
		...(deps.overdueSweepMs !== undefined
			? { overdueSweepMs: deps.overdueSweepMs }
			: {}),
	});
	return { artifacts, runner };
}
