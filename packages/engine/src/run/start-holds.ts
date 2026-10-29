import { Refusal } from "@nightshift/refusal";

/** Why a run does not start, resume or run again in a Space whose starts are held. */
export const START_HOLD_WORDS = {
	held: "Night Shift moves the projects of this Space now. Try again in a minute.",
} as const;

export type StartHolds = ReturnType<typeof createStartHolds>;

/** What a start does in a held Space: a person's is refused, the daemon's own waits for the release. */
export type WhenHeld = "refuse" | "wait";

/**
 * The Spaces whose runs do not become active: a move of their Projects
 * to another Space moves their rows, and a run that becomes active
 * between its last check and its batch would stay behind. Every path
 * that makes a run active goes through `start`: a new run (a person's, a
 * webhook's, a schedule's), a resume, a restart, a run again, and the
 * daemon's own resume of the runs a restart interrupted. A start in a
 * held Space is refused, or waits for the release (`WhenHeld`). A hold
 * waits for the starts already under way in its Space, so the check
 * after it sees their runs. Holds count: a Space is free when its last
 * hold is released.
 */
export function createStartHolds() {
	const held = new Map<string, number>();
	const starting = new Map<string, Set<Promise<unknown>>>();
	/** Resolves when the Space's last hold is released. */
	const freed = new Map<string, { promise: Promise<void>; free(): void }>();

	function whenFree(spaceId: string): Promise<void> {
		let found = freed.get(spaceId);
		if (!found) {
			let free = () => {};
			const promise = new Promise<void>((resolve) => {
				free = resolve;
			});
			found = { promise, free };
			freed.set(spaceId, found);
		}
		return found.promise;
	}

	return {
		/**
		 * Makes a run of the Space active with `work`, unless its starts are
		 * held: then it is refused (`refuse`, the default) or waits for the
		 * release (`wait`).
		 */
		async start<T>(
			spaceId: string,
			work: () => Promise<T>,
			whenHeld: WhenHeld = "refuse",
		): Promise<T> {
			while ((held.get(spaceId) ?? 0) > 0) {
				if (whenHeld === "refuse") {
					throw new Refusal("unavailable", START_HOLD_WORDS.held);
				}
				await whenFree(spaceId);
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
				if (left > 0) {
					held.set(spaceId, left);
					return;
				}
				held.delete(spaceId);
				freed.get(spaceId)?.free();
				freed.delete(spaceId);
			};
			await Promise.allSettled([...(starting.get(spaceId) ?? [])]);
			return release;
		},
	};
}
