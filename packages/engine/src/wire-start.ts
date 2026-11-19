import type { DeviceDirectory, Relay } from "./contract";
import { lastRunDevice, type RunLog } from "./log";
import type { PlacementPort } from "./placement";
import type { Projects } from "./projects";
import { createRunStart, createStartPlaces, createStartRelay } from "./run";
import type { StartHolds } from "./runs";

type RunStartDeps = Parameters<typeof createRunStart>[0];
type StartRelayDeps = Parameters<typeof createStartRelay>[0];
type StartPlacesDeps = Parameters<typeof createStartPlaces>[0];

/**
 * The start block of the engine's composition (`wire.ts`): the start of a
 * run on this computer (`run/run-start.ts`), the start on the Host that
 * keeps the Space (`run/relay-start.ts`), and who walks a new run
 * (`run/start-place.ts`). Lane R3 of the hexagon series owns this file.
 *
 * It gives `places`. The other blocks read `places.startForSchedule`
 * (schedules), `places.start` and `places.placements` (the Space view).
 */
export function wireEngineStart(deps: {
	/** Resolves when the engine is ready: a start waits for it. */
	ready: StartPlacesDeps["ready"];
	db: RunStartDeps["db"];
	log: RunLog;
	runner: RunStartDeps["runner"];
	now(): number;
	projects: Pick<Projects, "find">;
	/** The Devices a run may use (`Peers.placement`). */
	devices: Pick<PlacementPort, "plan" | "placements">;
	/** The Hosts this computer reaches (`Peers.relay`). Absent: none. */
	hosts?: Relay;
	directory: Pick<DeviceDirectory, "hostedElsewhere" | "hostOf">;
	/** This computer's name as a Device. */
	selfName: RunStartDeps["selfName"];
	memberName: RunStartDeps["memberName"];
	/** The runs of a project in the Space, as the run list shows them (views). */
	listRuns: StartRelayDeps["listRuns"];
	/** The start hold of a Space move (walk). */
	holds: Pick<StartHolds, "start">;
}) {
	const { db, log, runner, now, projects, devices, hosts, directory } = deps;

	const runStart = createRunStart({
		db,
		log,
		runner,
		now,
		projectRow: (projectId) => projects.find(projectId),
		plan: async (input) =>
			devices.plan({
				...input,
				lastRun: await lastRunDevice(db, input.project.id),
			}),
		selfName: deps.selfName,
		memberName: deps.memberName,
	});

	const relay = createStartRelay({
		db,
		log,
		...(hosts ? { relay: hosts } : {}),
		now,
		listRuns: deps.listRuns,
	});

	/** Who walks a run and its Run's Device, and the start itself, for every start (`start-place.ts`). */
	const places = createStartPlaces({
		ready: deps.ready,
		hostedElsewhere: (spaceId) => directory.hostedElsewhere(spaceId),
		hostReachable: async (spaceId) =>
			hosts ? hosts.reachable(spaceId) : false,
		hostOf: (spaceId) => directory.hostOf(spaceId),
		walkerId: () => log.walkerId(),
		placements: devices.placements,
		lastRunDevice: (projectId) => lastRunDevice(db, projectId),
		spaceOf: async (projectId) => (await projects.find(projectId)).spaceId,
		startOnHost: (input, spaceId) => relay.startOnHost(input, spaceId),
		startHere: (spaceId, input, trigger) =>
			deps.holds.start(spaceId, () => runStart.start(input, trigger)),
	});

	return { places };
}
