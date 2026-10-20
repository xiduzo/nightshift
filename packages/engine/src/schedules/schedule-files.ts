import type { Database } from "@nightshift/db";
import type { FlowNode, Schedule } from "@nightshift/flows";
import {
	readFlowSources,
	readSchedulesFile,
	writeSchedulesFile,
} from "@nightshift/flows/files";
import type { Actor } from "../contract";
import { flowsForRun } from "../flows";
import type { RunStatus } from "../log";
import {
	type DeviceOffer,
	type OwnDevice,
	offerRefusal,
	personOnHost,
	spaceOffers,
} from "../peers";
import type { SpaceDocuments } from "../projects";
import type {
	ScheduleList,
	ScheduleRecord,
	ScheduleResult,
	Scheduler,
} from "./scheduler";

/**
 * A project's schedules file as a person reads and saves it: each
 * schedule with its next start and how its last cron time went, and on a
 * save the Person each schedule on another Person's Device runs for.
 */
export type ScheduleFilesDeps = {
	db: Database;
	now(): number;
	scheduler: Pick<Scheduler, "refresh" | "nextAt" | "last">;
	/** The run's status, or null when the log knows no such run. */
	runStatus(runId: string): Promise<RunStatus | null>;
	documents: SpaceDocuments;
	/** The Devices a Person may place a run of the project on (`Placement.devicesFor`). */
	devicesFor(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<OwnDevice[]>;
	/** This computer's Offers into the Space that are in force. */
	offersHere(spaceId: string): Promise<DeviceOffer[]>;
	/** Whether the Person's role in the Space lets them use Offers. */
	mayUseOffers?: (spaceId: string, personId: string) => Promise<boolean>;
};

export type ScheduleFiles = ReturnType<typeof createScheduleFiles>;

export function createScheduleFiles(deps: ScheduleFilesDeps) {
	const { db, scheduler } = deps;

	/** A logged schedule fact, with the status of the run it started. */
	async function scheduleResult(
		record: ScheduleRecord | null,
	): Promise<ScheduleResult | null> {
		if (!record) return null;
		if (record.kind !== "fired") return record;
		return { ...record, runStatus: await deps.runStatus(record.runId) };
	}

	/**
	 * A schedule that fires on another Person's Device starts the saver's
	 * runs there, through that Device's Offers: each such schedule gets the
	 * saver as its `person`, and is refused unless the Offers in the Space
	 * cover what its flow runs on that Device now. A schedule on one of the
	 * saver's own Devices names no Person.
	 */
	async function schedulesWithOffers(
		project: { id: string; repoPath: string },
		spaceId: string,
		actor: Actor | undefined,
		schedules: readonly Schedule[],
	): Promise<Schedule[]> {
		if (!actor || !schedules.some((s) => s.device !== undefined)) {
			return [...schedules];
		}
		const personId = (await personOnHost(db, spaceId)) ?? actor.personId;
		const devices = await deps.devicesFor(spaceId, personId, project.id);
		const document = await deps.documents.open(spaceId);
		const out: Schedule[] = [];
		for (const schedule of schedules) {
			const { person: _old, ...rest } = schedule;
			const named = devices.filter((d) => d.name === schedule.device);
			const own = named.find((d) => d.offers === undefined);
			const theirs = named.find((d) => d.offers !== undefined);
			if (schedule.device === undefined || own || !theirs) {
				out.push(rest);
				continue;
			}
			let nodes: FlowNode[] = [];
			try {
				const loaded = flowsForRun(await readFlowSources(project.repoPath), {
					projectId: project.id,
					flowName: schedule.flow,
				});
				nodes = [loaded.flow, ...Object.values(loaded.calledFlows)]
					.flatMap((f) => f.nodes)
					// The schedule's run starts on that Device: its nodes run there
					// unless they name another.
					.filter(
						(n) => !("device" in n) || !n.device || n.device === theirs.name,
					);
			} catch {
				// A flow that does not load is the schedule's own issue.
			}
			const refusal = offerRefusal(nodes, {
				deviceName: theirs.name,
				offers: theirs.thisDevice
					? await deps.offersHere(spaceId)
					: spaceOffers(document, theirs.deviceId),
				mayUse: (await deps.mayUseOffers?.(spaceId, personId)) ?? false,
			});
			if (refusal !== null) {
				throw new Error(
					`The schedule "${schedule.id}" fires on another person's device. ${refusal}`,
				);
			}
			out.push({ ...rest, person: personId });
		}
		return out;
	}

	return {
		/** The project's schedules, each with its next start, its last result and its issues. */
		async list(project: {
			id: string;
			repoPath: string;
		}): Promise<ScheduleList> {
			const loaded = await readSchedulesFile(project.repoPath);
			await scheduler.refresh();
			const at = deps.now();
			const schedules = [];
			for (const schedule of loaded.schedules) {
				schedules.push({
					...schedule,
					nextAt: scheduler.nextAt(project.id, schedule, at),
					last: await scheduleResult(scheduler.last(project.id, schedule.id)),
					issues: loaded.issues.filter(
						(issue) => issue.scheduleId === schedule.id,
					),
				});
			}
			return {
				path: loaded.path,
				schedules,
				issues: loaded.issues.filter((issue) => issue.scheduleId === undefined),
			};
		},

		/** Writes the project's schedules file, with the Person of each schedule on another Person's Device. */
		async save(
			project: { id: string; repoPath: string },
			spaceId: string,
			actor: Actor | undefined,
			schedules: readonly Schedule[],
		) {
			return writeSchedulesFile(
				project.repoPath,
				await schedulesWithOffers(project, spaceId, actor, schedules),
			);
		},
	};
}
