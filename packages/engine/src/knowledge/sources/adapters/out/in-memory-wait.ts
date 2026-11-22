import type { Wait } from "../../application/ports";

/**
 * `Wait` in memory: it ends at once, or never after `hang`. It keeps each
 * wait it is asked for.
 */
export function inMemoryWait() {
	let hangs = false;
	const twin = {
		/** The waits asked for, in ms, in order. */
		waits: [] as number[],
		/** From now on a wait never ends. */
		hang() {
			hangs = true;
		},
		wait(ms: number): Promise<void> {
			twin.waits.push(ms);
			return hangs ? new Promise<void>(() => {}) : Promise.resolve();
		},
	};
	return twin satisfies Wait;
}

export type InMemoryWait = ReturnType<typeof inMemoryWait>;
