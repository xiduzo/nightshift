import {
	type RunProgress,
	runProgress,
	sameProgress,
} from "@nightshift/client";

import type { LockScreenPort } from "./lock-screen-port";

/** A run the person follows on the lock screen of this phone. */
export type FollowedRun = {
	runId: string;
	/** The Host the run is on. */
	host: string;
	/** The key of the Live Activity or notification. */
	key: string;
};

/** Where the followed runs are kept. */
export type FollowedRunStore = {
	list(): readonly FollowedRun[];
	add(run: FollowedRun): void;
	remove(runId: string): void;
};

export type FollowResult =
	| { kind: "following" }
	| { kind: "ended" }
	| { kind: "refused"; reason: string };

/**
 * Follows runs on the lock screen: shows a run, shows each new progress
 * once, ends it when the run ends, and forgets a run the person removed.
 * Work on one run waits for the work before it, so updates keep their order.
 */
export function createFollower({
	port,
	store,
}: {
	port: LockScreenPort;
	store: FollowedRunStore;
}) {
	const shown = new Map<string, RunProgress>();
	const queues = new Map<string, Promise<unknown>>();

	function inOrder<T>(runId: string, work: () => Promise<T>): Promise<T> {
		const before = queues.get(runId) ?? Promise.resolve();
		const next = before.then(work, work);
		queues.set(
			runId,
			next.catch(() => {}),
		);
		return next;
	}

	const find = (runId: string) =>
		store.list().find((run) => run.runId === runId) ?? null;

	return {
		/** Starts to show a run. `read` loads the run as it is now. */
		follow(
			host: string,
			runId: string,
			read: () => Promise<Parameters<typeof runProgress>[0]>,
		): Promise<FollowResult> {
			return inOrder(runId, async (): Promise<FollowResult> => {
				if (find(runId)) return { kind: "following" };
				if (!port.available || !(await port.allow())) {
					return { kind: "refused", reason: port.refusedText };
				}
				const progress = runProgress(await read());
				if (progress.ended) return { kind: "ended" };
				let key: string;
				try {
					key = await port.show(runId, progress);
				} catch {
					return { kind: "refused", reason: port.refusedText };
				}
				shown.set(runId, progress);
				store.add({ runId, host, key });
				return { kind: "following" };
			});
		},

		/** Stops to show a run, now. */
		unfollow(runId: string): Promise<void> {
			return inOrder(runId, async () => {
				const run = find(runId);
				if (!run) return;
				store.remove(runId);
				shown.delete(runId);
				await port.remove(run.key).catch(() => {});
			});
		},

		/** Shows the run's newest progress; ends it when the run has ended. */
		sync(runId: string, progress: RunProgress): Promise<void> {
			return inOrder(runId, async () => {
				const run = find(runId);
				if (!run) return;
				const before = shown.get(runId);
				if (before && sameProgress(before, progress) && !progress.ended) return;
				if (progress.ended) {
					store.remove(runId);
					shown.delete(runId);
					await port.end(run.key, progress).catch(() => {});
					return;
				}
				const alive = await port.update(run.key, progress).catch(() => false);
				if (alive) {
					shown.set(runId, progress);
				} else {
					store.remove(runId);
					shown.delete(runId);
				}
			});
		},
	};
}

export type Follower = ReturnType<typeof createFollower>;
