import type { Flow, FlowNode } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { Device, RunRef, Worktree } from "../../../../device";
import type { Intent, Taken } from "../../../../graph";
import type { RunTrigger } from "../../../../log";
import type { ListedProject } from "../../../../projects";
import { PROJECT_NOT_FOUND } from "../../../../projects/keep";
import type { PlacedDevice, PlannedRun } from "../../..";
import { inMemoryAccessPorts } from "../../../access/adapters/out/in-memory-space-members";
import { openSpace } from "../../../access/application/open-space";
import { inMemoryRunFacts } from "../../../walk/adapters/out/in-memory-run-facts";
import { createStartHolds } from "../../../walk/domain/start-holds";
import type { StartRunHerePorts } from "../../application/start-run-here";
import type { Works } from "../../domain/service-devices";
import { inMemoryHostStarts } from "./in-memory-host-starts";
import { inMemoryNewRuns } from "./in-memory-new-runs";
import { inMemoryRunPlanner } from "./in-memory-run-planner";
import { inMemorySpaceKeeper } from "./in-memory-space-keeper";
import { inMemoryStarters } from "./in-memory-starters";

/**
 * What a use-case test of the start starts from: every port of the start
 * in memory, with the twins of its neighbours (the projects, the Members of
 * a Space, the walk's facts and start holds) and a start's Turn that
 * prepares the run with its slot held. Test code: production code never
 * imports this file.
 */

/** This computer, as the twins name it: the Walker of the runs it starts. */
export const HERE = "this-computer";

/** The run cap's words, as the twin of the start's Turn says them. */
export const CAP_FULL =
	"Night Shift runs as many runs as it may. Try again later.";

/**
 * The start's Turn in memory: it holds a slot, runs `prepare` and keeps
 * what it gave. A full run cap (`fill`) refuses a start before `prepare`.
 */
export function inMemoryStartTurns() {
	let full = false;
	const twin = {
		/** Each start's run id, once its slot was held, in order. */
		taken: [] as string[],
		/** What each start's `prepare` gave, in order. */
		prepared: [] as unknown[],
		/** How many starts let go of their slot, after `prepare` settled. */
		settled: 0,
		/** From now on the run cap is full. */
		fill() {
			full = true;
		},
		async take(runId: string, intent: Intent): Promise<Taken> {
			if (intent.kind !== "start") {
				throw new Error("The twin of the start's Turn takes starts only.");
			}
			if (full) throw new Refusal("conflict", CAP_FULL);
			twin.taken.push(runId);
			try {
				twin.prepared.push(await intent.prepare());
			} finally {
				twin.settled++;
			}
			return { kind: "driving" };
		},
	};
	return twin;
}

/** The projects of a test, each in its Space. */
export function inMemoryProjects() {
	const projects = new Map<string, ListedProject>();
	return {
		/** Adds a project with a Clone here, unless it has no folder. */
		add(project: { id: string; spaceId: string; folder?: boolean }) {
			const folder = project.folder ?? true;
			projects.set(project.id, {
				id: project.id,
				spaceId: project.spaceId,
				name: project.id,
				folder,
				repoPath: folder ? `/projects/${project.id}` : null,
			} as unknown as ListedProject);
		},
		async find(projectId: string, spaceId?: string) {
			const found = projects.get(projectId);
			if (!found || (spaceId !== undefined && found.spaceId !== spaceId)) {
				throw new Refusal("not-found", PROJECT_NOT_FOUND);
			}
			return found;
		},
	};
}

/** A Device of a test: it makes worktrees and run folders, and records each. */
export function fakeDevice(id = HERE, name = "This computer") {
	const made: RunRef[] = [];
	let warning: string | undefined;
	const device = {
		id,
		name,
		made,
		/** The next worktree comes with this warning about its base. */
		warn(words: string) {
			warning = words;
		},
		async worktree(run: RunRef): Promise<Worktree> {
			made.push(run);
			const short = run.id.slice(0, 8);
			return {
				worktreePath: `/worktrees/${short}`,
				branch: `nightshift/${short}`,
				baseRef: run.baseRef ?? "main",
				...(warning ? { warning } : {}),
			};
		},
		async runFolder(run: RunRef) {
			made.push(run);
			return {
				worktreePath: `/run-folders/${run.id.slice(0, 8)}`,
				branch: "",
				baseRef: "",
				made: true,
			};
		},
	};
	return device;
}

export type FakeDevice = ReturnType<typeof fakeDevice>;

/** Where each node works, as the walk says it: an Agent or a Command in the worktree, a Gate and an End nowhere. */
export const works: Works = (node: FlowNode) =>
	node.type === "agent" || node.type === "command" || node.type === "service"
		? "worktree"
		: null;

/**
 * A run's plan on one Device: the flow, the Person it runs for, and every
 * node on `device`. `at` overrides what the plan says of the Device.
 */
export function plannedOn(
	device: FakeDevice,
	flow: Flow,
	options: {
		personId?: string | null;
		flowName?: string | null;
		at?: Partial<PlacedDevice>;
		notes?: string[];
		calledFlows?: Record<string, Flow>;
		groups?: PlannedRun["groups"];
	} = {},
): PlannedRun {
	const at: PlacedDevice = {
		device: device as unknown as Device,
		id: device.id,
		name: device.name,
		thisDevice: device.id === HERE,
		hasClone: true,
		...options.at,
	};
	const planned = { id: device.id, name: device.name };
	return {
		plan: {
			device: planned,
			named: {},
			devices: { [device.id]: planned },
			personId:
				options.personId === undefined ? "person-ada" : options.personId,
		},
		notes: options.notes ?? [],
		run: at,
		flow,
		flowName: options.flowName === undefined ? "nightly" : options.flowName,
		flowRevision: null,
		calledFlows: options.calledFlows ?? {},
		calledFlowRevisions: {},
		groups: options.groups ?? [{ at, nodes: flow.nodes }],
	};
}

/** Every port of the start in memory, and the twins a test reads. */
export function inMemoryStartPorts() {
	const access = inMemoryAccessPorts(HERE);
	const projects = inMemoryProjects();
	const planner = inMemoryRunPlanner();
	const keeper = inMemorySpaceKeeper();
	const hosts = inMemoryHostStarts();
	const runs = inMemoryNewRuns();
	const starters = inMemoryStarters();
	const turns = inMemoryStartTurns();
	const facts = inMemoryRunFacts(HERE);
	const holds = createStartHolds();
	let now = 1_000;
	let ids = 0;
	const rules: StartRunHerePorts["rules"] = {
		works,
		// The flow's inputs as given, else "".
		resolveInputs: (declared, given) =>
			Object.fromEntries(
				declared.map((input) => [input.name, given?.[input.name] ?? ""]),
			),
		runFolderOn: async (device, run) => {
			if (!device.runFolder) throw new Error("No run folders here.");
			return device.runFolder(run);
		},
		dueAt: (trigger?: RunTrigger) =>
			trigger?.kind === "schedule" ? `due ${trigger.at}` : "",
	};
	return {
		access,
		openSpace: openSpace(access),
		projects,
		planner,
		keeper,
		hosts,
		runs,
		starters,
		turns,
		facts,
		holds,
		now: () => now,
		newRunId: () => `run-${++ids}-00000000`,
		deadlineMs: 60_000,
		rules,
		/** The time from now on. */
		at(time: number) {
			now = time;
		},
	};
}

export type InMemoryStartPorts = ReturnType<typeof inMemoryStartPorts>;
