import {
	cronError,
	deviceIdOf,
	type Flow,
	type FlowIssue,
	type KnowledgeSource,
	knowledgeKitsOf,
	legacyDeviceName,
	REVIEW_LEARNINGS_KIT,
	type Schedule,
	scheduleSchema,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now as timeNow } from "@nightshift/time";
import type { RunStatus } from "../run-status";
import { KNOWLEDGE_FILES_WARNING } from "./folder";
import type { KnowledgeFile } from "./folder-snapshot";
import type { KnowledgeListing } from "./knowledge-reader";
import {
	type FlowMap,
	foldersOf,
	foldersOthersFill,
	isSourceSchedule,
	savedSource,
	sourceOf,
	withSourceSchedule,
} from "./source-flows";

/**
 * Knowledge sources: what a person adds on the Knowledge page, over the
 * Space a person works in. A source is a flow that calls a knowledge kit
 * (ADR 4, decision 6), its cron schedule when it keeps itself up to date,
 * its folder in the knowledge and its last run. This module is the one
 * owner of those rules: the API only checks who asks and carries them.
 *
 * Flows and schedules belong to the Space. The files belong to the
 * Space's knowledge document too, but this Device changes them through
 * its own copy: the module takes this Device's knowledge as a dependency
 * (`files`), so removing a source's files removes them for every Device.
 *
 * The Space comes in as a port (`SourcesSpace`), not as `SpaceEngine`: the
 * engine that walks runs reads this knowledge, so the knowledge cannot
 * name it. `Knowledge.sources` is how a caller reaches this module.
 */

/** A run as a source reads it: what its last sync says. */
export type SourceRun = {
	id: string;
	status: RunStatus;
	/** The flow it started from. Null for a quick run. */
	flowName: string | null;
	createdAt: number;
	endedAt: number | null;
};

/** The Space as the person who asks sees it, as far as a source needs it. */
export type SourcesSpace<Run extends SourceRun = SourceRun> = {
	flows: {
		map(projectId: string): Promise<FlowMap>;
		save(projectId: string, name: string, flow: Flow): Promise<FlowIssue[]>;
		remove(projectId: string, name: string): Promise<void>;
	};
	listSchedules(projectId: string): Promise<{ schedules: readonly unknown[] }>;
	saveSchedules(
		projectId: string,
		schedules: readonly Schedule[],
		timeZone?: string,
	): Promise<unknown>;
	listRuns(input: { projectId: string; limit: number }): Promise<Run[]>;
	startRun(input: {
		projectId: string;
		flowName: string;
		startedBy: string;
	}): Promise<Run>;
	listDevices(projectId: string): Promise<{ deviceId: string; name: string }[]>;
};

/** How many of the project's latest runs `list` reads for each source's last sync. */
const LAST_RUNS = 200;

/** How long a list waits for the names of other computers, which only the Host may know. */
const NAMES_WAIT_MS = 2_000;

/** One flow that fills the knowledge, as the Knowledge page lists it. */
export type KnowledgeSync = {
	flow: string;
	/** The knowledge kits it calls, the review of learnings left out. */
	kits: string[];
	/** The source, when the flow is one the Knowledge page made and can edit. */
	source: KnowledgeSource | null;
	/**
	 * The computer a source's Subflow names, if it names one: a folder
	 * source syncs there, whoever starts the run. `here`: it is this one.
	 */
	computer: { name: string; here: boolean } | null;
	/** Its own schedule at set times, if it has one. */
	schedule: { cron: string; enabled: boolean; device?: string } | null;
	/** Its latest run among the project's recent ones: when it ended, else started. */
	lastRun: { id: string; status: RunStatus; at: number } | null;
	/** What needs a person: its last sync failed, or it has not synced in a week (`syncHealth`). */
	health: SyncHealth;
};

/**
 * What a source's last sync says to a person: `failed` (it did not end
 * well), `stale` (its last sync ended more than `STALE_AFTER_MS` ago), or
 * null: it syncs now, synced lately, or never synced.
 */
type SyncHealth = "failed" | "stale" | null;

/** A source that has not synced for this long is stale. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60_000;

/** The health of a source by its last run (`SyncHealth`). */
function syncHealth(
	lastRun: Pick<NonNullable<KnowledgeSync["lastRun"]>, "status" | "at"> | null,
	now: number,
): SyncHealth {
	if (lastRun === null) return null;
	switch (lastRun.status) {
		case "running":
		case "waiting":
		case "sleeping":
			return null;
		case "finished":
		case "stopped":
			return now - lastRun.at > STALE_AFTER_MS ? "stale" : null;
		default:
			return "failed";
	}
}

/** What the person's role allows on the sources of this project, as the API checked it. */
type SourcePermissions = {
	/** Add a source, or edit one. */
	save: boolean;
	/** Remove a source. */
	remove: boolean;
	/** Start runs: sync a source, remove its files. */
	startRuns: boolean;
	/** Change when a source syncs on its own: this computer's owner only. */
	schedules: boolean;
};

/** What the person may do with one source, as the changes below allow it. */
type SourceActions = {
	sync: boolean;
	edit: boolean;
	remove: boolean;
	removeFiles: boolean;
};

/**
 * Sync now starts a run, Edit saves its flow, Remove removes its flow and,
 * for a source with a schedule, the schedule, which is this computer's
 * owner's (`OWNER_ONLY`). A flow someone drew has no source: it only syncs.
 */
function sourceActions(
	sync: Pick<KnowledgeSync, "source" | "schedule">,
	can: SourcePermissions,
): SourceActions {
	const made = sync.source !== null;
	return {
		sync: can.startRuns,
		edit: made && can.save,
		remove: made && can.remove && (sync.schedule === null || can.schedules),
		removeFiles: can.startRuns,
	};
}

/** A project's knowledge in its Space, and the flows that fill it. */
type KnowledgeOverview = {
	/** Every file but the index and the proposed learnings, by path. */
	files: KnowledgeFile[];
	/** So many files that an agent reads it badly. */
	tooLarge: boolean;
	syncs: (KnowledgeSync & { may: SourceActions })[];
	/** How many learnings agents proposed that wait for a person. */
	proposed: number;
	/** The flows of the project that review the learnings, by name. */
	reviews: string[];
	/** The Space is not a personal one: each of its Members reads the knowledge. */
	shared: boolean;
	/** The Host that keeps the Space runs an older version of Night Shift: it cannot take this knowledge yet. */
	olderHost: boolean;
	/** Night Shift proposes learnings from the runs of the project that ended (ADR 37). */
	learnsFromRuns: boolean;
};

/** What the person who asks may do, as the API checked it. */
export type SourceRights = {
	/**
	 * Change this computer's schedules: its owner only. A save or a removal
	 * that changes a schedule refuses anyone else.
	 */
	schedules: boolean;
};

type KnowledgeSourcesDeps<Run extends SourceRun> = {
	/** The Space as the person who asks sees it. */
	space: SourcesSpace<Run>;
	/** This Device's knowledge: the files, and the removal of a folder. */
	files: {
		listing(projectId: string): Promise<KnowledgeListing>;
		removeFolder(projectId: string, folder: string): Promise<number>;
	};
	/** This computer: a source that reads a folder here syncs here. */
	device: { id: string; name: string };
};

/** What the Knowledge page calls a computer it cannot name. */
const ANOTHER_COMPUTER = "another computer";

/** The schedules of a project are this computer's owner's to change (`schedules.save`). */
const OWNER_ONLY =
	"Only the owner of this computer can change its schedules. Save it without Keep it up to date, or ask the owner.";

/** A project's knowledge sources, as one person in one Space sees them. */
export type KnowledgeSources<Run extends SourceRun = SourceRun> = ReturnType<
	typeof knowledgeSources<Run>
>;

export function knowledgeSources<Run extends SourceRun>(
	deps: KnowledgeSourcesDeps<Run>,
) {
	const { space } = deps;

	/**
	 * The project's schedules as its file holds them: what a save writes
	 * back. None for a project without a copy on this computer.
	 */
	async function savedSchedules(projectId: string): Promise<Schedule[]> {
		try {
			const list = await space.listSchedules(projectId);
			return list.schedules.map((schedule) => scheduleSchema.parse(schedule));
		} catch (error) {
			if (error instanceof Refusal) return [];
			throw error;
		}
	}

	/** A source the page made, by its flow's name, or a refusal. */
	async function sourceNamed(projectId: string, name: string) {
		const flows = await space.flows.map(projectId);
		const flow = flows[name];
		const source = flow ? sourceOf(flow) : null;
		if (!flow || !source) {
			throw new Refusal(
				"not-found",
				"This project has no such source. It may have been removed.",
			);
		}
		return { flows, flow, source };
	}

	/** The computer a source's Subflow names, if it names one. */
	function deviceOf(parsed: Flow | null) {
		const source = parsed ? sourceOf(parsed) : null;
		const node = parsed?.nodes[0];
		return source && node?.type === "call" ? node.device : undefined;
	}

	/**
	 * The names of the computers these flows name. Only the Host may know the
	 * others, so it is asked only when a source names one, and a list that does
	 * not load in time names none: the page must not wait on it.
	 */
	async function computerNames(projectId: string, flows: FlowMap) {
		const names = new Map([[deps.device.id, deps.device.name]]);
		const asks = Object.values(flows).some((flow) => {
			const id = deviceIdOf(flow ? deviceOf(flow) : undefined);
			return id !== undefined && id !== deps.device.id;
		});
		if (!asks) return names;
		const devices = await Promise.race([
			space.listDevices(projectId).catch(() => []),
			Bun.sleep(NAMES_WAIT_MS).then(() => []),
		]);
		for (const { deviceId, name } of devices) names.set(deviceId, name);
		// This computer's own name, also where the Host knows another.
		names.set(deps.device.id, deps.device.name);
		return names;
	}

	/** The project's flows that fill or review the knowledge, by name, and what each source's list says. */
	async function fillingFlows(projectId: string) {
		const now = timeNow();
		const flows = await space.flows.map(projectId);
		const [schedules, runs, names] = await Promise.all([
			savedSchedules(projectId),
			space.listRuns({ projectId, limit: LAST_RUNS }),
			computerNames(projectId, flows),
		]);
		const used = Object.entries(flows)
			.map(([flow, parsed]) => ({
				flow,
				parsed,
				kits: parsed ? knowledgeKitsOf(parsed) : [],
			}))
			.sort((a, b) => a.flow.localeCompare(b.flow));
		const syncs = used.flatMap(({ flow, parsed, kits }): KnowledgeSync[] => {
			const fills = kits.filter((kit) => kit !== REVIEW_LEARNINGS_KIT);
			if (fills.length === 0) return [];
			const schedule = schedules.find((item) => isSourceSchedule(item, flow));
			const last = runs.find((run) => run.flowName === flow);
			const lastRun = last
				? {
						id: last.id,
						status: last.status,
						at: last.endedAt ?? last.createdAt,
					}
				: null;
			const device = deviceOf(parsed);
			const deviceId = deviceIdOf(device);
			return [
				{
					flow,
					kits: fills,
					source: parsed ? sourceOf(parsed) : null,
					computer:
						device === undefined
							? null
							: {
									name:
										(deviceId === undefined
											? legacyDeviceName(device)
											: names.get(deviceId)) ?? ANOTHER_COMPUTER,
									here: deviceId === deps.device.id,
								},
					schedule: schedule?.cron
						? {
								cron: schedule.cron,
								enabled: schedule.enabled,
							}
						: null,
					lastRun,
					health: syncHealth(lastRun, now),
				},
			];
		});
		return {
			syncs,
			reviews: used
				.filter(({ kits }) => kits.includes(REVIEW_LEARNINGS_KIT))
				.map(({ flow }) => flow),
		};
	}

	return {
		/**
		 * The files of the project's knowledge (after a reconcile of this
		 * Device's folder), the flows that fill it with their schedules and
		 * last runs, what `can` allows on each, and the learnings that wait. A
		 * project the Space does not have refuses.
		 */
		async list(
			projectId: string,
			can: SourcePermissions,
		): Promise<KnowledgeOverview> {
			const [
				{ files, proposed, shared, olderHost, learnsFromRuns },
				{ syncs, reviews },
			] = await Promise.all([
				deps.files.listing(projectId),
				fillingFlows(projectId),
			]);
			return {
				files,
				tooLarge: files.length > KNOWLEDGE_FILES_WARNING,
				syncs: syncs.map((sync) => ({
					...sync,
					may: sourceActions(sync, can),
				})),
				proposed,
				reviews,
				shared,
				olderHost,
				learnsFromRuns,
			};
		},
		/** The flows that fill the knowledge, with no reconcile: what `list` says of each. */
		async syncs(projectId: string): Promise<KnowledgeSync[]> {
			return (await fillingFlows(projectId)).syncs;
		},
		/**
		 * Adds a source, or changes one the page added (`name`): its flow,
		 * which calls the kit with the values given, and with `keepUpToDate`
		 * its schedule (null removes it, unset leaves it). Returns the
		 * flow's name and its problems. A source that reads a folder names
		 * the computer it reads it on, on its Subflow (`savedSource`).
		 */
		async save(
			projectId: string,
			input: {
				name?: string;
				source: KnowledgeSource;
				keepUpToDate?: { cron: string } | null;
				timeZone?: string;
			},
			may: SourceRights,
		): Promise<{ name: string; issues: FlowIssue[] }> {
			const changesSchedule = input.keepUpToDate !== undefined;
			if (changesSchedule && !may.schedules) {
				throw new Refusal("forbidden", OWNER_ONLY);
			}
			const cron = input.keepUpToDate?.cron;
			const problem = cron === undefined ? null : cronError(cron);
			if (problem) {
				throw new Refusal("invalid", `This schedule is not valid: ${problem}`);
			}
			const { name } = input;
			const saved = savedSource({
				source: input.source,
				...(name !== undefined ? { name } : {}),
				flows: await space.flows.map(projectId),
				here: { device: deps.device.id },
			});
			const issues = await space.flows.save(projectId, saved.name, saved.flow);
			if (changesSchedule) {
				// Its Subflow names the computer: the schedule runs on the Host,
				// and hands that step to the computer.
				await space.saveSchedules(
					projectId,
					withSourceSchedule(
						await savedSchedules(projectId),
						saved.name,
						cron === undefined ? null : { cron },
					),
					input.timeZone,
				);
			}
			return { name: saved.name, issues };
		},
		/**
		 * Removes a source the page added: with `files`, the files of its
		 * folders that no other flow fills, for every Device of the Space;
		 * then its schedules (cron and webhook); then its flow. Every check
		 * comes first, and the files go first: a step that fails leaves the
		 * source in place, so the person can try again. Returns how many
		 * files it removed.
		 */
		async remove(
			projectId: string,
			name: string,
			options: { files: boolean },
			may: SourceRights,
		): Promise<{ removedFiles: number }> {
			const { flows, flow } = await sourceNamed(projectId, name);
			const schedules = await savedSchedules(projectId);
			const kept = schedules.filter((schedule) => schedule.flow !== name);
			if (kept.length < schedules.length && !may.schedules) {
				throw new Refusal("forbidden", OWNER_ONLY);
			}
			let removedFiles = 0;
			if (options.files) {
				const others = foldersOthersFill(flows, name);
				for (const folder of foldersOf(flow)) {
					if (others.has(folder)) continue;
					removedFiles += await deps.files.removeFolder(projectId, folder);
				}
			}
			if (kept.length < schedules.length) {
				await space.saveSchedules(projectId, kept);
			}
			await space.flows.remove(projectId, name);
			return { removedFiles };
		},
		/**
		 * Syncs a source now: a run of its flow, as any run. A folder
		 * source's Subflow runs on the computer it names. A schedule that
		 * names a computer (an older folder source, or one a person set on
		 * the Schedules page) still places the run there.
		 */
		async sync(
			projectId: string,
			name: string,
			startedBy: string,
		): Promise<Run> {
			await sourceNamed(projectId, name);
			return space.startRun({
				projectId,
				flowName: name,
				startedBy,
			});
		},
	};
}
