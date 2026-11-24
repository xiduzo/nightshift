import type { Engine } from "@nightshift/engine";
import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type {
	MergeRow,
	PausedSchedule,
	SplitRow,
} from "../domain/membership-rows";
import { isPausedForm, pausedForm } from "../domain/paused-schedule";
import type { MembershipRecord } from "./ports";

export type PausedSchedulesDeps = {
	engine: {
		flows: Pick<Engine["flows"], "schedules" | "saveSchedules">;
	};
	/** The Person who owns this computer. */
	ownerId: string;
	record: MembershipRecord;
};

/**
 * The schedules a split pauses, since the Host goes on with them. The
 * Project keeps its flow document on both sides, so a pause goes to the
 * Host when this computer joins it again. The split keeps each schedule as
 * it was before it pauses one. A join of the same Host turns those on
 * again that nobody changed, once the rows are the Host's and before the
 * documents of their Projects sync.
 */
export function pausedSchedules(deps: PausedSchedulesDeps) {
	const splits = deps.record.splits;

	/** The schedules of a Project. A Project that is gone has none. */
	async function schedulesOf(projectId: string): Promise<Schedule[]> {
		try {
			return (await deps.engine.flows.schedules(projectId, { validate: false }))
				.schedules;
		} catch (error) {
			if (error instanceof Refusal && error.kind === "not-found") return [];
			throw error;
		}
	}

	/**
	 * Turns on what is paused, where `projectIds` has it and its schedule is
	 * still as the pause left it. `personOf` gives the Person it runs as.
	 * Runs again safely.
	 */
	async function turnOn(
		paused: readonly PausedSchedule[],
		keeps: (projectId: string) => boolean,
		personOf: (personId: string) => string,
	): Promise<void> {
		for (const projectId of new Set(paused.map((p) => p.projectId))) {
			if (!keeps(projectId)) continue;
			const now = await schedulesOf(projectId);
			const next = now.map((schedule) => {
				const was = paused.find(
					(p) => p.projectId === projectId && p.schedule.id === schedule.id,
				)?.schedule;
				if (!was || !isPausedForm(schedule, was)) return schedule;
				return was.person === undefined
					? was
					: { ...was, person: personOf(was.person) };
			});
			if (next.every((schedule, i) => schedule === now[i])) continue;
			await deps.engine.flows.saveSchedules(projectId, next);
		}
	}

	return {
		/** Keeps the schedules of the Projects that are on, before the split pauses them: those of an earlier try too. */
		async keep(row: SplitRow, projectIds: readonly string[]): Promise<void> {
			const on: PausedSchedule[] = [];
			for (const projectId of projectIds) {
				for (const schedule of await schedulesOf(projectId)) {
					if (schedule.enabled) on.push({ projectId, schedule });
				}
			}
			const again = (p: PausedSchedule) =>
				on.some(
					(o) => o.projectId === p.projectId && o.schedule.id === p.schedule.id,
				);
			const before = (row.paused ?? []).filter((p) => !again(p));
			await splits.paused(row.toSpace, [...before, ...on]);
		},

		/** A schedule as a split leaves it. */
		pause: (schedule: Schedule): Schedule =>
			schedule.enabled ? pausedForm(schedule) : schedule,

		/**
		 * This computer joined the Host again and the rows of `merge` moved: what
		 * its splits off that Space paused is on again. A split from before the
		 * schedules were kept turns none on.
		 */
		async afterMerge(merge: MergeRow): Promise<void> {
			const there = merge.personMap[deps.ownerId] ?? deps.ownerId;
			for (const split of await splits.ofHost(merge.hostId)) {
				if (split.fromSpace !== merge.toSpace) continue;
				if (split.hostPersonId !== there) continue;
				if (split.paused === null) {
					if (split.unpinned > 0) {
						console.warn(
							`[devices] The ${split.unpinned} schedules that an earlier leave paused stay paused. The split: ${split.toSpace}`,
						);
					}
					continue;
				}
				if (split.paused.length === 0) continue;
				await turnOn(
					split.paused,
					(id) => {
						const target = merge.projectMap[id];
						return target?.projectId === id && target.spaceId === merge.toSpace;
					},
					(personId) => merge.personMap[personId] ?? personId,
				);
				await splits.paused(split.toSpace, []);
			}
		},
	};
}
