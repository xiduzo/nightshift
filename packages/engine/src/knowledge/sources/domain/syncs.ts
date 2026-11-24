import {
	type Flow,
	type KnowledgeSource,
	knowledgeKitsOf,
	REVIEW_LEARNINGS_KIT,
	type Schedule,
	scheduleSchema,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { RunStatus } from "../../../run-status";
import { type FlowMap, isSourceSchedule, sourceOf } from "./source-flows";

/**
 * Knowledge sources: what a person adds on the Knowledge page, over the
 * Space a person works in. A source is a flow that calls a knowledge kit
 * (ADR 4, decision 6), its cron schedule when it keeps itself up to date,
 * its folder in the knowledge and its last run. These are the rules of
 * those sources: the API only checks who asks and carries them.
 *
 * Flows and schedules belong to the Space. The files belong to the
 * Space's knowledge document too, but this Device changes them through
 * its own copy, so removing a source's files removes them for every Device.
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

/** How many of the project's latest runs a list reads for each source's last sync. */
export const LAST_RUNS = 200;

/** How long a list waits for the names of other computers, which only the Host may know. */
export const NAMES_WAIT_MS = 2_000;

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
export type SourcePermissions = {
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
export type SourceActions = {
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
export function sourceActions(
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

/** What the person who asks may do, as the API checked it. */
export type SourceRights = {
	/**
	 * Change this computer's schedules: its owner only. A save or a removal
	 * that changes a schedule refuses anyone else.
	 */
	schedules: boolean;
};

/** What the Knowledge page calls a computer it cannot name. */
const ANOTHER_COMPUTER = "another computer";

/** The schedules of a project are this computer's owner's to change (`schedules.save`). */
export const OWNER_ONLY =
	"Only the owner of this computer can change its schedules. Save it without Keep it up to date, or ask the owner.";

/**
 * The project's schedules as its file holds them: what a save writes
 * back. None for a project without a copy on this computer (`list`
 * refuses).
 */
export async function savedSchedules(
	list: () => Promise<{ schedules: readonly unknown[] }>,
): Promise<Schedule[]> {
	try {
		const listed = await list();
		return listed.schedules.map((schedule) => scheduleSchema.parse(schedule));
	} catch (error) {
		if (error instanceof Refusal) return [];
		throw error;
	}
}

/** A source the page made, by its flow's name, or a refusal. */
export function sourceNamed(flows: FlowMap, name: string) {
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
 * Whether the flows name a computer other than this one (`here`): only
 * the Host may know its name, so only then is it asked.
 */
export function namesOthers(flows: FlowMap, here: string): boolean {
	return Object.values(flows).some((flow) => {
		const id = flow ? deviceOf(flow) : undefined;
		return id !== undefined && id !== here;
	});
}

/**
 * The project's flows that fill or review the knowledge, by name, and
 * what each source's list says: its kits, its source, its computer (by
 * `names`), its own schedule, its latest run among `runs` and its health
 * at `now`.
 */
export function fillingFlowsOf<Run extends SourceRun>(input: {
	flows: FlowMap;
	schedules: readonly Schedule[];
	runs: readonly Run[];
	names: ReadonlyMap<string, string>;
	here: string;
	now: number;
}): { syncs: KnowledgeSync[]; reviews: string[] } {
	const { schedules, runs, names, here, now } = input;
	const used = Object.entries(input.flows)
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
		const deviceId = deviceOf(parsed);
		return [
			{
				flow,
				kits: fills,
				source: parsed ? sourceOf(parsed) : null,
				computer:
					deviceId === undefined
						? null
						: {
								name: names.get(deviceId) ?? ANOTHER_COMPUTER,
								here: deviceId === here,
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
