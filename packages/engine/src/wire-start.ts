import type { Database } from "@nightshift/db";
import type { Access } from "./access";
import type { DeviceDirectory, Relay, StartRunInput } from "./contract";
import { addressKey } from "./device";
import { capabilitiesFor, kindOf, unfit } from "./graph";
import type { RunLog, RunTrigger } from "./log";
import type { Projects } from "./projects";
import type { RunSummary } from "./read";
import {
	type PlacementPort,
	wirePlacement,
	wireStart,
	type wireWalk,
} from "./runs";

type StartDeps = Parameters<typeof wireStart>[0];

/**
 * The plan a run starts with (`placement/`), bound to the fit check of the
 * walk (`graph/fit/`) and to what a Device has (`device/`). The devices'
 * planner calls it from the engine root (`PlacementPort.plan`), and so
 * does the engine's own fake of a computer alone. Lane PL of the hexagon
 * series owns this block.
 */
export const { planNodes } = wirePlacement({
	fit: {
		capabilitiesFor,
		unfit,
		works: (node) => kindOf(node).works(node),
		profilesOn: async (device, ids) =>
			(await device.capabilities({ profiles: ids })).profiles,
		addressesOn: (device, checks) =>
			device.capabilities({ addresses: checks }).then((has) => has.addresses),
		addressKey,
	},
});

/**
 * The start block of the engine's composition (`wire.ts`): a run's start
 * (`runs/start/`), by a person, by Night Shift in this process, or by a
 * schedule. Lane R3 of the hexagon series owns this file.
 *
 * It gives `places`: the start's use cases, and for the schedules slice
 * `startForSchedule` (`ScheduledRuns.start`). The Space view reads
 * the use cases. It also gives `runs`: the run use cases of `Engine.runs`
 * this block holds (`start`).
 */
export function wireEngineStart(deps: {
	/** Resolves when the engine is ready: a schedule's start waits for it. */
	ready: Promise<unknown>;
	db: Database;
	log: RunLog;
	now(): number;
	projects: Pick<Projects, "find">;
	/** The Devices a run may use (`Peers.placement`). */
	devices: Pick<PlacementPort, "plan" | "placements" | "devicesFor">;
	/** The Hosts this computer reaches (`Peers.relay`). Absent: none. */
	hosts?: Relay;
	directory: Pick<DeviceDirectory, "hostedElsewhere" | "hostOf">;
	/** This computer's name as a Device. */
	selfName: string;
	memberName: StartDeps["starters"]["memberName"];
	/** The runs of a project in the Space, as the run list shows them (views). */
	listRuns: StartDeps["hosts"]["listRuns"];
	/** Who may act in a Space (access). */
	access: Pick<Access, "openSpace">;
	/** The start's Turn, the run's facts and the start hold of a Space move (walk). */
	walk: Pick<ReturnType<typeof wireWalk>, "turns" | "facts" | "holds">;
}) {
	const { db, log, now, hosts } = deps;
	const relay = hosts ? { relay: hosts } : {};

	const start = wireStart({
		planner: { db, devices: deps.devices },
		keeper: { directory: deps.directory, ...relay },
		hosts: { db, log, ...relay, now, listRuns: deps.listRuns },
		runs: { db, log },
		starters: { db, log, selfName: deps.selfName, memberName: deps.memberName },
		projects: deps.projects,
		openSpace: deps.access.openSpace,
		turns: deps.walk.turns,
		facts: deps.walk.facts,
		holds: deps.walk.holds,
		now,
	});

	const places = {
		...start,
		/** A schedule's or a webhook's start, once the engine is ready (`ScheduledRuns.start`). */
		startForSchedule: async (
			input: StartRunInput,
			trigger: RunTrigger,
		): Promise<RunSummary> => {
			await deps.ready;
			return start.startScheduledRun({ input, trigger });
		},
	};

	return { places, runs: { start: start.startRun } };
}
