/**
 * The rows of a run bundle, read from each format that `openRunBundle`
 * opens. An older format is read in the shape of today's tables.
 */
import type { Database } from "@nightshift/db";
import {
	agentSession,
	clone,
	event,
	project,
	run,
	step,
} from "@nightshift/db/schema";
import { asc, eq, getColumns, sql } from "drizzle-orm";

/**
 * The Walker and Device of a format 1 bundle's rows: that bundle never
 * said which computer walked the run.
 */
export const UNKNOWN_DEVICE = "unknown";

/** The Space of a format 1 or 2 bundle's rows: those bundles never said. */
export const UNKNOWN_SPACE = "unknown";

export type BundleRows = {
	project: typeof project.$inferSelect | undefined;
	clones: (typeof clone.$inferSelect)[];
	run: typeof run.$inferSelect | undefined;
	steps: (typeof step.$inferSelect)[];
	sessions: (typeof agentSession.$inferSelect)[];
	events: (typeof event.$inferSelect)[];
};

/** The run's columns of a bundle from before its Person, its Devices and its Flow revisions: read with none. */
function withoutStartedBy() {
	const {
		startedBy: _person,
		deviceId: _device,
		placements: _placements,
		deviceNames: _names,
		flowRevision: _revision,
		bodyFlowRevisions: _revisions,
		...columns
	} = getColumns(run);
	return columns;
}

/** What a run of a bundle from before Flow revisions has of them. */
const NO_REVISIONS = { flowRevision: null, bodyFlowRevisions: "{}" };

/**
 * A format 3 to 8 bundle: the live schema's tables. Format 3 has no
 * `started_by`, formats 3 and 4 no `device_id`, formats 3 to 5 no
 * `placements`, formats 3 to 6 no `device_names`, and formats 3 to 7 no
 * Flow revisions: read as none.
 */
export async function readRows(
	db: Database,
	runId: string,
	formatVersion: number,
): Promise<BundleRows> {
	const columns = getColumns(run);
	const [runRow] =
		formatVersion >= 8
			? await db.select().from(run).where(eq(run.id, runId))
			: (
					await db
						.select({
							...withoutStartedBy(),
							...(formatVersion >= 4 ? { startedBy: columns.startedBy } : {}),
							...(formatVersion >= 5 ? { deviceId: columns.deviceId } : {}),
							...(formatVersion >= 6 ? { placements: columns.placements } : {}),
							...(formatVersion >= 7
								? { deviceNames: columns.deviceNames }
								: {}),
						})
						.from(run)
						.where(eq(run.id, runId))
				).map((row) => ({
					startedBy: null,
					deviceId: null,
					placements: null,
					deviceNames: null,
					...row,
					...NO_REVISIONS,
				}));
	const projectId = runRow?.projectId ?? "";
	const [projectRow] = await db
		.select()
		.from(project)
		.where(eq(project.id, projectId));
	return {
		project: projectRow,
		clones: await db.select().from(clone).where(eq(clone.projectId, projectId)),
		run: runRow,
		steps: await db
			.select()
			.from(step)
			.where(eq(step.runId, runId))
			.orderBy(asc(step.createdAt)),
		sessions: await sessionsOf(db, runId),
		events: await db
			.select()
			.from(event)
			.where(eq(event.runId, runId))
			.orderBy(asc(event.seq)),
	};
}

/** The columns of a table without its Space. */
function withoutSpace<T extends Record<string, unknown>>(
	columns: T,
): Omit<T, "spaceId"> {
	const { spaceId: _space, ...rest } = columns;
	return rest;
}

/** A format 2 bundle: the live schema's tables without `space_id`, read in `UNKNOWN_SPACE`. */
export async function readFormat2(
	db: Database,
	runId: string,
): Promise<BundleRows> {
	const space = { spaceId: UNKNOWN_SPACE };
	const [runRow] = await db
		.select(withoutSpace(withoutStartedBy()))
		.from(run)
		.where(eq(run.id, runId));
	const projectId = runRow?.projectId ?? "";
	const [projectRow] = await db
		.select(withoutSpace(getColumns(project)))
		.from(project)
		.where(eq(project.id, projectId));
	const clones = await db
		.select(withoutSpace(getColumns(clone)))
		.from(clone)
		.where(eq(clone.projectId, projectId));
	const steps = await db
		.select(withoutSpace(getColumns(step)))
		.from(step)
		.where(eq(step.runId, runId))
		.orderBy(asc(step.createdAt));
	const sessions = await db
		.select(withoutSpace(getColumns(agentSession)))
		.from(agentSession)
		.where(eq(agentSession.runId, runId))
		.orderBy(asc(agentSession.createdAt));
	const events = await db
		.select(withoutSpace(getColumns(event)))
		.from(event)
		.where(eq(event.runId, runId))
		.orderBy(asc(event.seq));
	return {
		project: projectRow && { ...projectRow, ...space },
		clones: clones.map((c) => ({ ...c, ...space })),
		run: runRow && {
			...runRow,
			...space,
			startedBy: null,
			deviceId: null,
			placements: null,
			deviceNames: null,
			...NO_REVISIONS,
		},
		steps: steps.map((s) => ({ ...s, ...space })),
		sessions: sessions.map((s) => ({ ...s, ...space })),
		events: events.map((e) => ({ ...e, ...space })),
	};
}

/**
 * A format 1 bundle, read as format 4: the project's `repo_path` is its one
 * Clone, it has no remote, every row's Walker is `UNKNOWN_DEVICE` and its
 * Space `UNKNOWN_SPACE`.
 */
export async function readFormat1(
	db: Database,
	runId: string,
): Promise<BundleRows> {
	const space = { spaceId: UNKNOWN_SPACE };
	const { walkerId: _walker, ...runColumns } = withoutSpace(withoutStartedBy());
	const { deviceId: _device, ...stepColumns } = withoutSpace(getColumns(step));
	const {
		walkerId: _eventWalker,
		walkerSeq: _walkerSeq,
		...eventColumns
	} = withoutSpace(getColumns(event));
	const { remote: _remote, ...projectColumns } = withoutSpace(
		getColumns(project),
	);

	const [runRow] = await db
		.select(runColumns)
		.from(run)
		.where(eq(run.id, runId));
	const [projectRow] = await db
		.select({ ...projectColumns, repoPath: sql<string>`repo_path` })
		.from(project)
		.where(eq(project.id, runRow?.projectId ?? ""));
	const steps = await db
		.select(stepColumns)
		.from(step)
		.where(eq(step.runId, runId))
		.orderBy(asc(step.createdAt));
	const events = await db
		.select(eventColumns)
		.from(event)
		.where(eq(event.runId, runId))
		.orderBy(asc(event.seq));
	return {
		project: projectRow && {
			id: projectRow.id,
			...space,
			name: projectRow.name,
			remote: null,
			createdAt: projectRow.createdAt,
			removedAt: projectRow.removedAt,
		},
		clones: projectRow
			? [
					{
						id: projectRow.id,
						...space,
						projectId: projectRow.id,
						deviceId: UNKNOWN_DEVICE,
						path: projectRow.repoPath,
						createdAt: projectRow.createdAt,
					},
				]
			: [],
		run: runRow
			? {
					...runRow,
					...space,
					walkerId: UNKNOWN_DEVICE,
					startedBy: null,
					deviceId: null,
					placements: null,
					deviceNames: null,
					...NO_REVISIONS,
				}
			: undefined,
		steps: steps.map((s) => ({ ...s, ...space, deviceId: null })),
		sessions: (
			await db
				.select(withoutSpace(getColumns(agentSession)))
				.from(agentSession)
				.where(eq(agentSession.runId, runId))
				.orderBy(asc(agentSession.createdAt))
		).map((s) => ({ ...s, ...space })),
		events: events.map((e) => ({
			...e,
			...space,
			walkerId: UNKNOWN_DEVICE,
			walkerSeq: e.seq,
		})),
	};
}

function sessionsOf(db: Database, runId: string) {
	return db
		.select()
		.from(agentSession)
		.where(eq(agentSession.runId, runId))
		.orderBy(asc(agentSession.createdAt));
}
