import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { RowBatch } from "../../contract";
import type { ProjectFlows } from "../../flows";
import {
	groupBySpace,
	type MovedProjects,
	type ProjectsMove,
} from "../domain/move";
import type {
	MoveHolds,
	MoveRows,
	MoveStore,
	ProjectsMovedHook,
	Reread,
	SpaceEntries,
	ThisWalker,
} from "./ports";

export type MoveProjectsPorts = {
	holds: Pick<MoveHolds, "holdStarts" | "holdSchedules">;
	walker: ThisWalker;
	moveStore: Pick<
		MoveStore,
		"runIds" | "projectRows" | "batchOf" | "emptied" | "commit"
	>;
	movedSchedules: Pick<ProjectFlows, "schedules" | "saveSchedules">;
	spaceEntries: Pick<SpaceEntries, "move">;
	/** The rows of the packages above the engine, in this order. */
	moveRows: readonly MoveRows[];
	reread: Reread;
	projectsMoved: ProjectsMovedHook;
};

/** Changes the schedules of the Projects. Returns how many changed. */
async function editSchedules(
	schedules: Pick<ProjectFlows, "schedules" | "saveSchedules">,
	projectIds: readonly string[],
	edit: (schedule: Schedule) => Schedule,
): Promise<number> {
	let changed = 0;
	for (const projectId of projectIds) {
		const read = await schedules
			.schedules(projectId, { validate: false })
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
		await schedules.saveSchedules(projectId, edited);
		changed += count;
	}
	return changed;
}

/**
 * Moves Projects from one Space to others, as one operation. Devices, the
 * merge, the split and a person's move ask. In this order:
 *
 * 1. No schedule of this computer fires, and no run becomes active in
 *    `from`, from the caller's last check through the batch. The starts
 *    under way end first. A schedule that came due meanwhile fires after
 *    the release, within its grace.
 * 2. `plan`: the caller's checks and what moves, under the hold.
 * 3. The schedules of the moved Projects change (`plan.schedule`), before
 *    any row moves: a move that stops here goes on from its last state,
 *    and a schedule changes once.
 * 4. One batch: every row of the moved Projects, the rows of the packages
 *    above the engine (`MoveRows`: the Commands of the moved runs, the
 *    notifier's deliveries), and the caller's own rows (`statements`: the
 *    Spaces of auth, the state of a merge). Every row lands in its new
 *    Space, or none does.
 * 5. The run log reads the moved runs again, and so does the landed feed.
 * 6. The Space documents this Replica writes follow the rows, then the
 *    data outside the rows (`moved`: the knowledge of each Project). Its
 *    failure is logged: the move is done.
 *
 * The flow documents of a Project that joins another one are the
 * caller's to merge: they may first have to come from a Host.
 */
export const moveProjects =
	(ports: MoveProjectsPorts) =>
	async (request: ProjectsMove): Promise<MovedProjects> => {
		const { from } = request;
		const releaseSchedules = await ports.holds.holdSchedules();
		let releaseStarts = () => {};
		try {
			releaseStarts = await ports.holds.holdStarts(from);
			const plan = await request.plan();
			const walker = await ports.walker.walkerId();
			const personMap = plan.personMap ?? {};
			const sources = Object.keys(plan.projects);
			const groups: {
				to: string;
				map: Record<string, string>;
				runIds: string[];
			}[] = [];
			for (const { to, map } of groupBySpace(plan.projects)) {
				const runIds = await ports.moveStore.runIds(
					from,
					Object.keys(map),
					plan.ownRunsOnly ? walker : undefined,
				);
				groups.push({ to, map, runIds });
			}
			const rows = await ports.moveStore.projectRows(sources);

			const schedules = plan.schedule
				? await editSchedules(ports.movedSchedules, sources, plan.schedule)
				: 0;
			const moved: MovedProjects = {
				projects: sources,
				runIds: groups.flatMap((g) => g.runIds),
				schedules,
			};

			const batches: RowBatch[] = [];
			for (const { to, map, runIds } of groups) {
				batches.push(
					await ports.moveStore.batchOf({
						from,
						to,
						projectMap: map,
						personMap,
						...(plan.renumber ? { walkerId: walker } : {}),
						...(plan.ownRunsOnly ? { runsOf: walker } : {}),
					}),
				);
				if (runIds.length === 0) continue;
				for (const rowsOf of ports.moveRows) {
					batches.push(await rowsOf({ from, to, runIds, personMap }));
				}
			}
			batches.push((await request.statements?.(moved)) ?? []);
			if (plan.empties) batches.push(ports.moveStore.emptied(from));
			await ports.moveStore.commit(batches);
			ports.reread.reread(moved.runIds);

			if (sources.length > 0) {
				await ports.spaceEntries.move({
					from,
					projects: plan.projects,
					rows,
					...(plan.ownRunsOnly ? { onlyDevice: walker } : {}),
				});
				await ports.projectsMoved
					.moved?.({ from, projects: plan.projects })
					.catch((error) => {
						console.warn(
							"What follows the moved projects did not move:",
							error,
						);
					});
			}
			return moved;
		} finally {
			releaseStarts();
			releaseSchedules();
		}
	};
