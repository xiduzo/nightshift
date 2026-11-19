import type { Database } from "@nightshift/db";
import { event, project, run } from "@nightshift/db/schema";
import { asDate, now } from "@nightshift/time";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import {
	type Derive,
	foldRun,
	type RunBus,
	type RunLog,
	type RunRow,
	type TranscriptEntry,
} from "../../../../log";
import {
	deriveSteps,
	namesOf,
	type PendingCommand,
	type RunPage,
	type RunSummary,
	type RunWalker,
	runDeviceId,
	runFacts,
	runTrace,
	toSummary,
} from "../../../../read";
import type { RunViews } from "../../application/ports";
import {
	answeredFacts,
	answeredGatesOf,
	countProjectRuns,
	type DeviceNamer,
	devicesOfRun,
	type HarnessOf,
	knownStatus,
	openGate,
	openGatesOf,
	type ProjectRunsRead,
	runHereOf,
	stepOf,
	toRunDetail,
	toStepDetail,
	walkerOf,
} from "./run-pages";
import type { StepEntries } from "./run-transcript";
import { type RunWatchPorts, savedTranscript, watchRun } from "./run-watch";

/**
 * The views of the runs over this Replica's database and its run log:
 * what people see of a run, derived from the event log (design rule: the
 * log is the read model). It only reads. The rows come from SQL, each
 * run's state from the run log, and every page is made in `run-pages.ts`.
 */

export type DrizzleRunViewsDeps = {
	db: Database;
	log: RunLog;
	bus: RunBus;
	/** This computer's Device id (and the run log's Walker id). */
	deviceId: string;
	/** The harness port of that name, for its take-over command. */
	harnessOf: HarnessOf;
	/** The Walkers of runs of a Space (and the Devices their steps run on), by id. */
	walkers(
		spaceId: string,
		ids: readonly string[],
	): Promise<Map<string, RunWalker>>;
	/** The actions of each run that wait for its Walker, by run id. */
	pendingCommands(
		runIds: readonly string[],
	): Promise<Map<string, PendingCommand[]>>;
	/** A step's transcript, wherever its run is walked (`RunsPort.stepEntries`). */
	stepEntries: StepEntries;
	/** The entries of a step's own transcript file on this Replica: none without one (`RunHistory.ownTranscript`). */
	ownEntries(step: {
		runId: string;
		stepId: string;
	}): Promise<TranscriptEntry[]>;
	/** The name of a Person as the Space document's Members name them. Default: none. */
	memberName?(spaceId: string, personId: string): Promise<string | null>;
};

/**
 * When a run last did something, as SQL: the time of the latest event of
 * its log that is not feedback (`Scored`), else its start. The same
 * moment as `RunState.lastAt`, so the order of a list agrees with the
 * `lastActivityAt` of its summaries. The index on the event's run reads
 * the latest row first: one row per run.
 */
const LAST_ACTIVITY = sql<number>`coalesce((select ${event.at} from ${event} where ${event.runId} = ${run.id} and ${event.type} <> 'Scored' order by ${event.seq} desc limit 1), ${run.createdAt})`;

/** The reads that need the database, the run log or the bus. */
export function drizzleRunViews(deps: DrizzleRunViewsDeps): RunViews {
	const { db, log } = deps;
	const memberIn = (spaceId: string) => {
		const { memberName } = deps;
		return memberName && ((personId: string) => memberName(spaceId, personId));
	};

	/*
	 * Every read of a run's derived state goes through the run log's
	 * `derive`: the run list, each watcher of the run and the run page
	 * share one derivation per append.
	 */
	async function one<T>(runId: string, fn: Derive<T>): Promise<T> {
		return (await log.derive([runId], fn)).get(runId) as T;
	}

	/** Names the Devices a Space's runs name: their Walkers and Placements. */
	async function namer(
		spaceId: string,
		ids: readonly (string | null)[],
	): Promise<DeviceNamer> {
		const known = await deps.walkers(
			spaceId,
			ids.filter((id): id is string => id !== null),
		);
		return (id) => walkerOf(known, id);
	}

	const watching: RunWatchPorts = {
		log,
		bus: deps.bus,
		stepEntries: deps.stepEntries,
		ownEntries: deps.ownEntries,
		namer,
	};

	/**
	 * The Space's runs (of one project), newest first, with the facts the
	 * log gives each one. With `page`, at most `limit` of them with one of
	 * its `statuses`, after its `cursor`.
	 */
	async function listRuns(
		spaceId: string,
		projectId?: string,
		page: RunPage = {},
	): Promise<RunSummary[]> {
		const { cursor, statuses } = page;
		// A status is the log's, not a column's: those pages are cut after the facts.
		const limit = statuses ? undefined : page.limit;
		const byActivity = page.order === "activity";
		const after = !cursor
			? undefined
			: byActivity
				? // A cursor of an older client names no activity: its start stands in.
					sql`(${LAST_ACTIVITY}, ${run.id}) < (${cursor.lastActivityAt ?? cursor.createdAt}, ${cursor.id})`
				: or(
						lt(run.createdAt, asDate(cursor.createdAt)),
						and(
							eq(run.createdAt, asDate(cursor.createdAt)),
							lt(run.id, cursor.id),
						),
					);
		const query = db
			.select()
			.from(run)
			.where(
				and(
					eq(run.spaceId, spaceId),
					projectId ? eq(run.projectId, projectId) : undefined,
					after,
				),
			)
			.orderBy(desc(byActivity ? LAST_ACTIVITY : run.createdAt), desc(run.id));
		const read = await (limit === undefined ? query : query.limit(limit));
		const facts = await log.derive(
			read.map((r) => r.id),
			runFacts,
		);
		const rows = statuses
			? read
					.filter((r) => {
						const status = facts.get(r.id)?.status;
						return status !== undefined && statuses.includes(status);
					})
					.slice(0, page.limit)
			: read;
		const deviceOf = await namer(
			spaceId,
			rows.flatMap((r) => [r.walkerId, runDeviceId(r)]),
		);
		const names = await namesOf(
			db,
			rows.map((r) => r.startedBy),
			memberIn(spaceId),
		);
		return rows.map((row) =>
			toSummary(
				row,
				facts.get(row.id) ?? runFacts(foldRun([])),
				names,
				deviceOf(row.walkerId),
				deviceOf(runDeviceId(row)),
			),
		);
	}

	/** How the runs of each project of the Space stand, by project id (`countProjectRuns`). */
	async function projectRuns(
		spaceId: string,
		read: ProjectRunsRead = { now: now(), timeZone: "UTC" },
	) {
		const rows = await db
			.select({
				id: run.id,
				projectId: run.projectId,
				title: run.title,
				createdAt: run.createdAt,
			})
			.from(run)
			.where(eq(run.spaceId, spaceId))
			.orderBy(desc(run.createdAt), desc(run.id));
		const facts = await log.derive(
			rows.map((r) => r.id),
			runFacts,
		);
		return countProjectRuns(rows, facts, read);
	}

	/** The run page of `row`, the run's row (the caller has read it). */
	async function getRun(row: RunRow) {
		const runId = row.id;
		const state = await log.state(runId);
		const facts = await one(runId, runFacts);
		const deviceOf = await namer(row.spaceId, devicesOfRun(row, state));
		const walker = deviceOf(row.walkerId);
		return toRunDetail(
			row,
			state,
			facts,
			deps.harnessOf,
			await namesOf(db, [row.startedBy], memberIn(row.spaceId)),
			walker,
			walker.thisDevice
				? []
				: ((await deps.pendingCommands([runId])).get(runId) ?? []),
			deviceOf,
		);
	}

	/** One step of the run with its prompts and the elements of its items, or "not found". */
	async function getStep(row: RunRow, stepId: string) {
		const step = stepOf(await one(row.id, deriveSteps), stepId);
		return toStepDetail(step, await namer(row.spaceId, [step.deviceId]));
	}

	/**
	 * Where a run is and what it does, cheap: its status, when it wakes,
	 * and whether this computer walks it or runs its steps. Null when this
	 * Replica has no such run. One row and the run log's kept facts.
	 */
	async function runHere(runId: string) {
		const [row] = await db
			.select({ walkerId: run.walkerId, deviceId: run.deviceId })
			.from(run)
			.where(eq(run.id, runId));
		if (!row) return null;
		const facts = await one(runId, runFacts);
		return runHereOf(runId, row, facts, await log.walkerId(), deps.deviceId);
	}

	/** The runs of the Space, of projects a person has not removed, with their project's name. */
	function runsOfProjects(spaceId: string, since?: number) {
		return db
			.select({ run, projectName: project.name })
			.from(run)
			.innerJoin(project, eq(run.projectId, project.id))
			.where(
				and(
					eq(run.spaceId, spaceId),
					isNull(project.removedAt),
					since === undefined ? undefined : gte(run.createdAt, asDate(since)),
				),
			);
	}

	/** The open Gates of the Space's runs of projects a person has not removed, in the inbox order. */
	async function listGates(spaceId: string) {
		const rows = await runsOfProjects(spaceId);
		// Only a waiting run has an open Gate. The run list keeps the same facts.
		const facts = await log.derive(
			rows.map((r) => r.run.id),
			runFacts,
		);
		const open = await log.derive(
			rows
				.map((r) => r.run.id)
				.filter((id) => facts.get(id)?.status === "waiting"),
			openGate,
		);
		const withGate = rows.filter((r) => open.has(r.run.id));
		const walkers = await deps.walkers(
			spaceId,
			withGate.map((r) => r.run.walkerId),
		);
		// One read for the answers that wait for a Walker elsewhere.
		const pending = await deps.pendingCommands(
			withGate
				.filter((r) => !walkerOf(walkers, r.run.walkerId).thisDevice)
				.map((r) => r.run.id),
		);
		return openGatesOf(rows, open, walkers, pending);
	}

	/**
	 * The Gates of the Space's runs that closed after `since`, newest first:
	 * one per wait, with the question it asked and the option it took.
	 * Only runs that started after `since` count: the inbox keeps no more.
	 */
	async function listAnsweredGates(spaceId: string, since: number) {
		const rows = await runsOfProjects(spaceId, since);
		const derived = await log.derive(
			rows.map((r) => r.run.id),
			answeredFacts,
		);
		return answeredGatesOf(rows, derived, since);
	}

	return {
		listRuns,
		projectRuns,
		getRun,
		getStep,
		stepTranscript: (row, stepId, signal) =>
			savedTranscript(watching, row, stepId, signal),
		/** The run's status, or null for a run the log has nothing on. */
		runStatus: (runId) => one(runId, knownStatus),
		runHere,
		/** The run as monitoring reads it (`run-trace.ts`), or null when the log has none of it. */
		trace: (runId) => one(runId, runTrace),
		listGates,
		listAnsweredGates,
		watch: (row, signal, afterSeq) => watchRun(watching, row, signal, afterSeq),
	};
}
