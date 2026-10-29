import type { Database } from "@nightshift/db";
import { project } from "@nightshift/db/schema";
import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { ProjectFlows } from "../flows";
import {
	moveSpaceEntries,
	type ProjectTarget,
	type SpaceDocuments,
	spaceMoveBatch,
	spaceRunIds,
} from "../projects";
import type { StartHolds } from "./start-holds";

/**
 * A Space move: Projects that go from one Space to other Spaces, as one
 * operation (`Engine.moveProjects`). A person's move of a Project, the
 * merge of a Device's Personal into its Home Host's, and the split of a
 * Personal of its own when it leaves (ADR 1) are each one.
 *
 * In this order:
 *
 * 1. No run becomes active in `from` (`StartHolds`), and no schedule fires
 *    anywhere, from the caller's last check through the batch. The starts
 *    under way end first. A schedule that came due meanwhile fires after
 *    the release, within its grace.
 * 2. `plan`: the caller's checks and what moves, under the hold.
 * 3. The schedules of the moved Projects change through `ProjectFlows`
 *    (`plan.schedule`), before any row moves: a move that stops here goes
 *    on from its last state, and a schedule changes once.
 * 4. One `db.batch`: every row of the moved Projects (`spaceMoveBatch`),
 *    the rows of the packages above the engine (`MoveRows`: the Commands
 *    of the moved runs, the notifier's deliveries), and the caller's own
 *    rows (`statements`: the Spaces of auth, the state of a merge). Every
 *    row lands in its new Space, or none does.
 * 5. The run log reads the moved runs again, and so does the landed feed.
 * 6. The Space documents this Replica writes follow the rows
 *    (`moveSpaceEntries`).
 *
 * The flow documents of a Project that joins another one are the
 * caller's to merge: they may first have to come from a Host.
 */

/** What moves, as the caller decides it under the hold. */
export type ProjectsMovePlan = {
	/** Each Project to move, by its id in `from`: its Space and its id there. */
	projects: Readonly<Record<string, ProjectTarget>>;
	/** A Person's id in `from`: their id in the Space the rows go to. */
	personMap?: Readonly<Record<string, string>>;
	/**
	 * The moved events of this computer take the numbers after its latest
	 * one, so they reach the Host of a Space it moves them into.
	 */
	renumber?: boolean;
	/**
	 * Only the runs this computer walks move: it takes its own copy of the
	 * Projects (a split), and `from` keeps the rest. Every Project keeps
	 * its id, and only this computer's Clones go along in the documents.
	 */
	ownRunsOnly?: boolean;
	/**
	 * Each schedule of a moved Project as it is to be after the move. It
	 * returns the schedule itself to keep it as it is.
	 */
	schedule?(schedule: Schedule): Schedule;
};

/** A move of Projects out of one Space. */
export type ProjectsMove = {
	from: string;
	/** Runs under the hold, before anything changes: throws to call the move off. */
	plan(): Promise<ProjectsMovePlan>;
	/** The caller's own rows of the move, for the same batch. */
	statements?(
		moved: MovedProjects,
	): BatchItem<"sqlite">[] | Promise<BatchItem<"sqlite">[]>;
};

/** What a move moved. */
export type MovedProjects = {
	/** The Projects, by their id in `from`. */
	projects: string[];
	/** The runs that moved with them. */
	runIds: string[];
	/** How many schedules `plan.schedule` changed. */
	schedules: number;
};

/** The runs a move takes from one Space to another, for the rows that move with them. */
export type MovedRuns = {
	from: string;
	to: string;
	runIds: readonly string[];
	/** A Person's id in `from`: their id in `to`. */
	personMap: Readonly<Record<string, string>>;
};

/**
 * The rows of a package above the engine that move with the runs of a
 * Space move (a port: the engine does not import those packages). Each
 * adapter gives its statements for the move's batch.
 */
export type MoveRows = (runs: MovedRuns) => Promise<BatchItem<"sqlite">[]>;

export type ProjectsMoveDeps = {
	db: Database;
	ready: Promise<void>;
	holds: Pick<StartHolds, "hold">;
	/** Holds every schedule of this computer: resolves with the release. */
	holdSchedules(): Promise<() => void>;
	/** This computer as a Walker. */
	walkerId(): Promise<string>;
	flows: Pick<ProjectFlows, "schedules" | "saveSchedules">;
	documents: Pick<SpaceDocuments, "open">;
	/** The rows of these runs changed under the run log: read them again. */
	reread(runIds: readonly string[]): void;
	rows: readonly MoveRows[];
};

export function createProjectsMove(deps: ProjectsMoveDeps) {
	const { db } = deps;

	/** Changes the schedules of the Projects, through `ProjectFlows`. Returns how many changed. */
	async function editSchedules(
		projectIds: readonly string[],
		edit: (schedule: Schedule) => Schedule,
	): Promise<number> {
		let changed = 0;
		for (const projectId of projectIds) {
			const read = await deps.flows
				.schedules({ projectId }, { validate: false })
				.catch((error: unknown) => {
					// A removed Project has no schedules that fire.
					if (error instanceof Refusal && error.kind === "not-found") {
						return null;
					}
					throw error;
				});
			if (!read) continue;
			const edited = read.schedules.map(edit);
			const count = edited.filter((s, i) => s !== read.schedules[i]).length;
			if (count === 0) continue;
			await deps.flows.saveSchedules({ projectId }, edited);
			changed += count;
		}
		return changed;
	}

	return async function moveProjects(
		move: ProjectsMove,
	): Promise<MovedProjects> {
		await deps.ready;
		const { from } = move;
		const releaseSchedules = await deps.holdSchedules();
		let releaseStarts = () => {};
		try {
			releaseStarts = await deps.holds.hold(from);
			const plan = await move.plan();
			const walker = await deps.walkerId();
			const personMap = plan.personMap ?? {};
			const sources = Object.keys(plan.projects);
			const bySpace = new Map<string, Record<string, string>>();
			for (const [source, target] of Object.entries(plan.projects)) {
				bySpace.set(target.spaceId, {
					...bySpace.get(target.spaceId),
					[source]: target.projectId,
				});
			}
			const groups: {
				to: string;
				map: Record<string, string>;
				runIds: string[];
			}[] = [];
			for (const [to, map] of bySpace) {
				const runIds = await spaceRunIds(
					db,
					from,
					Object.keys(map),
					plan.ownRunsOnly ? walker : undefined,
				);
				groups.push({ to, map, runIds });
			}
			const rows = new Map(
				sources.length === 0
					? []
					: (
							await db
								.select()
								.from(project)
								.where(inArray(project.id, sources))
						).map((row) => [row.id, row]),
			);

			const schedules = plan.schedule
				? await editSchedules(sources, plan.schedule)
				: 0;
			const moved: MovedProjects = {
				projects: sources,
				runIds: groups.flatMap((g) => g.runIds),
				schedules,
			};

			const statements: BatchItem<"sqlite">[] = [];
			for (const { to, map, runIds } of groups) {
				statements.push(
					...(await spaceMoveBatch(db, {
						from,
						to,
						projectMap: map,
						personMap,
						...(plan.renumber ? { walkerId: walker } : {}),
						...(plan.ownRunsOnly ? { runsOf: walker } : {}),
					})),
				);
				if (runIds.length === 0) continue;
				for (const rowsOf of deps.rows) {
					statements.push(...(await rowsOf({ from, to, runIds, personMap })));
				}
			}
			statements.push(...((await move.statements?.(moved)) ?? []));
			const [first, ...rest] = statements;
			if (first) await db.batch([first, ...rest]);
			deps.reread(moved.runIds);

			if (sources.length > 0) {
				await moveSpaceEntries(deps.documents, {
					from,
					projects: plan.projects,
					rows,
					...(plan.ownRunsOnly ? { onlyDevice: walker } : {}),
				});
			}
			return moved;
		} finally {
			releaseStarts();
			releaseSchedules();
		}
	};
}
