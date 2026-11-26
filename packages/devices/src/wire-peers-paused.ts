import type { Database } from "@nightshift/db";
import { hostSpace, project, spaceSplit } from "@nightshift/db/schema";
import type { PausedHere } from "@nightshift/engine";
import { asDate } from "@nightshift/time";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";

/** A schedule as `space_split.paused` names it. */
type PausedSchedule = { projectId: string; scheduleId: string };

/**
 * The schedules a split paused on this computer (`space_split.paused`), for
 * the engine. Wherever the Project is now, while no Host keeps its Space:
 * there the Host fires them.
 */
export function pausedHere(db: Database): PausedHere {
	const rows = async () =>
		(
			await db
				.select({ toSpace: spaceSplit.toSpace, paused: spaceSplit.paused })
				.from(spaceSplit)
				.where(
					and(ne(spaceSplit.state, "planned"), isNotNull(spaceSplit.paused)),
				)
		).map((row) => ({
			toSpace: row.toSpace,
			paused: JSON.parse(row.paused ?? "[]") as PausedSchedule[],
		}));
	return {
		async of(projectId) {
			const ids = (await rows())
				.flatMap((row) => row.paused)
				.filter((p) => p.projectId === projectId)
				.map((p) => p.scheduleId);
			if (ids.length === 0) return new Set();
			const [own] = await db
				.select({ id: project.id })
				.from(project)
				// A Space this computer left is no Host's here.
				.leftJoin(
					hostSpace,
					and(eq(hostSpace.spaceId, project.spaceId), isNull(hostSpace.leftAt)),
				)
				.where(and(eq(project.id, projectId), isNull(hostSpace.spaceId)));
			return new Set(own ? ids : []);
		},
		async ended(projectId, scheduleIds) {
			for (const row of await rows()) {
				const left = row.paused.filter(
					(p) =>
						p.projectId !== projectId || !scheduleIds.includes(p.scheduleId),
				);
				if (left.length === row.paused.length) continue;
				await db
					.update(spaceSplit)
					.set({ paused: JSON.stringify(left), updatedAt: asDate() })
					.where(eq(spaceSplit.toSpace, row.toSpace));
			}
		},
	};
}
