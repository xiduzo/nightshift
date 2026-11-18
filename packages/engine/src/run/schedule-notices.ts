import type { ScheduleMissed } from "../schedules";

/**
 * What the schedules slice tells the rest of Night Shift, and who hears
 * it: `createEngine` fills the slice's notices port with `notices`, and
 * offers the two subscriptions on `Engine` (`onScheduleMissed`,
 * `onSchedulesChanged`). The daemon's notifications listen.
 */

/** A missed cron time as the slice tells it: without the Space of its project. */
type MissedTime = Omit<ScheduleMissed, "spaceId">;

type MissedListener = (missed: ScheduleMissed) => void;
type ChangedListener = (spaceId: string, projectId: string) => Promise<void>;

export type ScheduleNoticesDeps = {
	/** The Space of a project. Throws for a project this Replica does not have. */
	spaceOf(projectId: string): Promise<string>;
};

export function createScheduleNotices(deps: ScheduleNoticesDeps) {
	const missedListeners = new Set<MissedListener>();
	const changedListeners = new Set<ChangedListener>();

	return {
		/** What the schedules slice calls. */
		notices: {
			/**
			 * A cron time was missed by more than its schedule allows. Tells
			 * the listeners with the Space of the project. It does not wait,
			 * and it never throws: the scheduler goes on.
			 */
			missed(time: MissedTime): void {
				void deps
					.spaceOf(time.projectId)
					.then((spaceId) => {
						for (const listener of [...missedListeners]) {
							listener({ ...time, spaceId });
						}
					})
					.catch((error) =>
						console.error("[schedules] could not tell of a missed time", error),
					);
			},
			/**
			 * A project's schedules changed without a run (a pause tonight).
			 * Waits for each listener, in the order they came. A listener
			 * that fails fails the request that made the change.
			 */
			async changed(spaceId: string, projectId: string): Promise<void> {
				for (const listener of [...changedListeners]) {
					await listener(spaceId, projectId);
				}
			},
		},
		/** `Engine.onScheduleMissed`. */
		onMissed(listener: MissedListener): () => void {
			missedListeners.add(listener);
			return () => missedListeners.delete(listener);
		},
		/** `Engine.onSchedulesChanged`. */
		onChanged(listener: ChangedListener): () => void {
			changedListeners.add(listener);
			return () => changedListeners.delete(listener);
		},
	};
}
