import {
	cronError,
	type FlowIssue,
	type KnowledgeSource,
	knowledgeKitsOf,
	knowledgeSourceKind,
	REVIEW_LEARNINGS_KIT,
	type Schedule,
	scheduleSchema,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now as timeNow } from "@nightshift/time";
import {
	KNOWLEDGE_FILES_WARNING,
	type KnowledgeFile,
	type ProjectKnowledge,
} from "../knowledge";
import type { RunSummary } from "../read";
import type { SpaceEngine } from "../run";
import {
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
 */

/** How many of the project's latest runs `list` reads for each source's last sync. */
const LAST_RUNS = 200;

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
	lastRun: { id: string; status: RunSummary["status"]; at: number } | null;
	/** What needs a person: its last sync failed, or it has not synced in a week (`syncHealth`). */
	health: SyncHealth;
};

/**
 * What a source's last sync says to a person: `failed` (it did not end
 * well), `stale` (its last sync ended more than `STALE_AFTER_MS` ago), or
 * null: it syncs now, synced lately, or never synced.
 */
export type SyncHealth = "failed" | "stale" | null;

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

/** A source of a project whose last sync needs a person, for the morning digest. */
export type SourceProblem = {
	projectId: string;
	projectName: string;
	/** The flow that syncs it. */
	flow: string;
	/** What it syncs, for a person: the kind of a source the page added, else the flow's name. */
	label: string;
	health: NonNullable<SyncHealth>;
	lastRun: NonNullable<KnowledgeSync["lastRun"]>;
};

/** A project's knowledge in its Space, and the flows that fill it. */
export type KnowledgeOverview = {
	/** Every file but the index and the proposals, by path. */
	files: KnowledgeFile[];
	/** So many files that an agent reads it badly. */
	tooLarge: boolean;
	syncs: KnowledgeSync[];
	/** How many learnings agents proposed that wait for a person. */
	proposed: number;
	/** The flows of the project that review the learnings, by name. */
	reviews: string[];
	/** The Space is not a personal one: each of its Members reads the knowledge. */
	shared: boolean;
	/** The Host that keeps the Space runs an older version of Night Shift: it cannot take this knowledge yet. */
	olderHost: boolean;
};

/** What the person who asks may do, as the API checked it. */
export type SourceRights = {
	/**
	 * Change this computer's schedules: its owner only. A save or a removal
	 * that changes a schedule refuses anyone else.
	 */
	schedules: boolean;
};

export type KnowledgeSourcesDeps = {
	/** The Space as the person who asks sees it. */
	space: Pick<
		SpaceEngine,
		"flows" | "listSchedules" | "saveSchedules" | "listRuns" | "startRun"
	>;
	/** This Device's knowledge: the files, and the removal of a folder. */
	files: Pick<ProjectKnowledge, "listing" | "removeFolder">;
	/** This computer's name: a source that reads a folder here syncs here. */
	deviceName: string;
};

/** The schedules of a project are this computer's owner's to change (`schedules.save`). */
const OWNER_ONLY =
	"Only the owner of this computer can change its schedules. Save it without Keep it up to date, or ask the owner.";

/** A project's knowledge sources, as one person in one Space sees them. */
export type KnowledgeSources = ReturnType<typeof knowledgeSources>;

export function knowledgeSources(deps: KnowledgeSourcesDeps) {
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

	return {
		/**
		 * The files of the project's knowledge (after a reconcile of this
		 * Device's folder), the flows that fill it with their schedules and
		 * last runs, and the learnings that wait. A project the Space does
		 * not have refuses.
		 */
		async list(projectId: string): Promise<KnowledgeOverview> {
			const now = timeNow();
			const flows = await space.flows.map(projectId);
			const [{ files, proposed, shared, olderHost }, schedules, runs] =
				await Promise.all([
					deps.files.listing(projectId),
					savedSchedules(projectId),
					space.listRuns({ projectId, limit: LAST_RUNS }),
				]);
			const used = Object.entries(flows)
				.map(([flow, parsed]) => ({
					flow,
					parsed,
					kits: parsed ? knowledgeKitsOf(parsed) : [],
				}))
				.sort((a, b) => a.flow.localeCompare(b.flow));
			return {
				files,
				tooLarge: files.length > KNOWLEDGE_FILES_WARNING,
				syncs: used.flatMap(({ flow, parsed, kits }) => {
					const fills = kits.filter((kit) => kit !== REVIEW_LEARNINGS_KIT);
					if (fills.length === 0) return [];
					const schedule = schedules.find((item) =>
						isSourceSchedule(item, flow),
					);
					const last = runs.find((run) => run.flowName === flow);
					const lastRun = last
						? {
								id: last.id,
								status: last.status,
								at: last.endedAt ?? last.createdAt,
							}
						: null;
					const source = parsed ? sourceOf(parsed) : null;
					const node = parsed?.nodes[0];
					const device =
						source && node?.type === "call" ? node.device : undefined;
					return [
						{
							flow,
							kits: fills,
							source,
							computer: device
								? { name: device, here: device === deps.deviceName }
								: null,
							schedule: schedule?.cron
								? {
										cron: schedule.cron,
										enabled: schedule.enabled,
										...(schedule.device ? { device: schedule.device } : {}),
									}
								: null,
							lastRun,
							health: syncHealth(lastRun, now),
						},
					];
				}),
				proposed,
				reviews: used
					.filter(({ kits }) => kits.includes(REVIEW_LEARNINGS_KIT))
					.map(({ flow }) => flow),
				shared,
				olderHost,
			};
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
			const schedules = await savedSchedules(projectId);
			const scheduled =
				name === undefined
					? undefined
					: schedules.find((item) => isSourceSchedule(item, name))?.device;
			const saved = savedSource({
				source: input.source,
				...(name !== undefined ? { name } : {}),
				flows: await space.flows.map(projectId),
				here: {
					device: deps.deviceName,
					...(scheduled !== undefined ? { scheduled } : {}),
				},
			});
			const issues = await space.flows.save(projectId, saved.name, saved.flow);
			if (changesSchedule) {
				// Its Subflow names the computer: the schedule runs anywhere.
				await space.saveSchedules(
					projectId,
					withSourceSchedule(
						schedules,
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
		): Promise<RunSummary> {
			await sourceNamed(projectId, name);
			const schedule = (await savedSchedules(projectId)).find((item) =>
				isSourceSchedule(item, name),
			);
			return space.startRun({
				projectId,
				flowName: name,
				startedBy,
				...(schedule?.device ? { deviceName: schedule.device } : {}),
			});
		},
	};
}

/**
 * The sources of a Space's projects whose last sync needs a person
 * (`syncHealth`), for the morning digest: no reconcile, no files. A
 * project the Space cannot read is left out.
 */
export async function knowledgeSourceProblems(
	space: Pick<SpaceEngine, "listProjects" | "flows" | "listRuns">,
	now: number = timeNow(),
): Promise<SourceProblem[]> {
	const problems: SourceProblem[] = [];
	for (const project of await space.listProjects()) {
		const read = await Promise.all([
			space.flows.map(project.id),
			space.listRuns({ projectId: project.id, limit: LAST_RUNS }),
		]).catch((error: unknown) => {
			if (error instanceof Refusal) return null;
			throw error;
		});
		if (!read) continue;
		const [flows, runs] = read;
		for (const [flow, parsed] of Object.entries(flows).sort(([a], [b]) =>
			a.localeCompare(b),
		)) {
			const kits = parsed ? knowledgeKitsOf(parsed) : [];
			if (!kits.some((kit) => kit !== REVIEW_LEARNINGS_KIT)) continue;
			const last = runs.find((run) => run.flowName === flow);
			if (!last) continue;
			const lastRun = {
				id: last.id,
				status: last.status,
				at: last.endedAt ?? last.createdAt,
			};
			const health = syncHealth(lastRun, now);
			if (!health) continue;
			const source = parsed ? sourceOf(parsed) : null;
			problems.push({
				projectId: project.id,
				projectName: project.name,
				flow,
				label: source ? knowledgeSourceKind(source.kit).label : flow,
				health,
				lastRun,
			});
		}
	}
	return problems;
}
