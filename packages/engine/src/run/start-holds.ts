import { Refusal } from "@nightshift/refusal";

/** Why a run does not start in a Space whose starts are held. */
export const START_HOLD_WORDS = {
	held: "Night Shift moves the projects of this Space now. Start the run again in a minute.",
} as const;

export type StartHolds = ReturnType<typeof createStartHolds>;

/**
 * The Spaces whose new runs wait: a merge or a split of Spaces moves
 * their rows, and a run that starts between its last check and its batch
 * would stay behind. A start in a held Space is refused. A hold waits
 * for the starts already under way in its Space, so the check after it
 * sees their runs. Holds count: a Space is free when its last hold is
 * released.
 */
export function createStartHolds() {
	const held = new Map<string, number>();
	const starting = new Map<string, Set<Promise<unknown>>>();

	return {
		/** Starts a run in the Space with `work`, unless its starts are held. */
		async start<T>(spaceId: string, work: () => Promise<T>): Promise<T> {
			if ((held.get(spaceId) ?? 0) > 0) {
				throw new Refusal("unavailable", START_HOLD_WORDS.held);
			}
			const task = work();
			const tasks = starting.get(spaceId) ?? new Set<Promise<unknown>>();
			starting.set(spaceId, tasks);
			tasks.add(task);
			try {
				return await task;
			} finally {
				tasks.delete(task);
				if (tasks.size === 0) starting.delete(spaceId);
			}
		},

		/**
		 * Holds the starts of the Space, once the starts under way there
		 * settled. Resolves with the release, which is safe to call twice.
		 */
		async hold(spaceId: string): Promise<() => void> {
			held.set(spaceId, (held.get(spaceId) ?? 0) + 1);
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				const left = (held.get(spaceId) ?? 1) - 1;
				if (left > 0) held.set(spaceId, left);
				else held.delete(spaceId);
			};
			await Promise.allSettled([...(starting.get(spaceId) ?? [])]);
			return release;
		},
	};
}
