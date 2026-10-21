import { createRunQueries, runProgress } from "@nightshift/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useHostQueries, useSignedIn } from "@/features/host";
import { createFollower } from "./follow";
import { followedRuns, loadFollowedRuns } from "./followed-runs";
import { lockScreen } from "./lock-screen";

/** One follower for the app: the store and the platform are app-wide too. */
const follower = createFollower({ port: lockScreen, store: followedRuns });

/** The runs this phone follows on the lock screen, of the Host it is signed in to. */
export function useFollowedRuns() {
	const { host } = useSignedIn();
	useEffect(() => {
		void loadFollowedRuns();
	}, []);
	const all = useSyncExternalStore(followedRuns.subscribe, followedRuns.list);
	return all.filter((run) => run.host === host.address);
}

/** Follow a run on the lock screen, or stop: for a button. */
export function useLockScreenFollow(runId: string) {
	const { host } = useSignedIn();
	const queryClient = useQueryClient();
	const runQueries = useHostQueries(createRunQueries);
	const following = useFollowedRuns().some((run) => run.runId === runId);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	const follow = useCallback(async () => {
		setBusy(true);
		setProblem(null);
		try {
			const result = await follower.follow(host.address, runId, () =>
				queryClient.fetchQuery({ ...runQueries.get(runId), staleTime: 0 }),
			);
			if (result.kind === "refused") setProblem(result.reason);
		} catch {
			setProblem(
				"Night Shift could not read this run. Check that this phone is online, then try again.",
			);
		} finally {
			setBusy(false);
		}
	}, [host.address, runId, queryClient, runQueries]);

	const unfollow = useCallback(async () => {
		setProblem(null);
		await follower.unfollow(runId);
	}, [runId]);

	return {
		available: lockScreen.available,
		following,
		busy,
		problem,
		follow,
		unfollow,
	};
}

/** Starts to follow a run on the lock screen, outside a button: after a start. */
export function useFollowAfterStart() {
	const { host } = useSignedIn();
	const queryClient = useQueryClient();
	const runQueries = useHostQueries(createRunQueries);
	return useCallback(
		(runId: string) =>
			follower
				.follow(host.address, runId, () =>
					queryClient.fetchQuery({ ...runQueries.get(runId), staleTime: 0 }),
				)
				.catch(() => ({ kind: "refused" as const, reason: "" })),
		[host.address, queryClient, runQueries],
	);
}

/** Shows a followed run's newest progress; ends it with the run. */
export function syncFollowedRun(
	runId: string,
	run: Parameters<typeof runProgress>[0],
): void {
	void follower.sync(runId, runProgress(run));
}

/** Whether this phone can show a run on the lock screen at all. */
export const canFollowOnLockScreen = lockScreen.available;
