import {
	createScheduleQueries,
	nudgeProblem,
	type ScheduleSummary,
	useRunActed,
	withPause,
} from "@nightshift/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";

import { useHostQueries, useSignedIn } from "@/features/host";
import { openRun } from "@/features/runs";
import { type Nudge, problemCopy } from "./schedule-words";

/**
 * Pause tonight, Resume tonight and Run now of one schedule. A pause
 * shows at once in the schedule list. Run now opens the run it started,
 * after it closes the sheet it was in. `copy` says what happened when a
 * nudge did not work. `hidden`: the Host is too old for the nudges.
 */
export function useScheduleNudges(
	projectId: string,
	schedule: ScheduleSummary,
) {
	const { host } = useSignedIn();
	const queryClient = useQueryClient();
	const scheduleQueries = useHostQueries(createScheduleQueries);
	const runActed = useRunActed(host);
	const showPause = (answer: {
		pausedUntil: number | null;
		nextAt: number | null;
	}) =>
		queryClient.setQueryData(
			scheduleQueries.list(projectId).queryKey,
			(list) => (list ? withPause(list, schedule.id, answer) : list),
		);
	const pause = useMutation(
		host.orpc.schedules.pauseTonight.mutationOptions({ onSuccess: showPause }),
	);
	const resume = useMutation(
		host.orpc.schedules.resumeTonight.mutationOptions({ onSuccess: showPause }),
	);
	const runNow = useMutation(
		host.orpc.schedules.runNow.mutationOptions({
			onSuccess: (run) => {
				runActed(run.id);
				// Close a sheet, then follow the run on the main screens.
				if (router.canDismiss()) router.dismiss();
				openRun(run.id);
			},
		}),
	);

	const input = { projectId, scheduleId: schedule.id };
	// One message at a time: a new nudge clears the error of another.
	const only = (nudge: Nudge) => {
		if (nudge !== "pause") pause.reset();
		if (nudge !== "resume") resume.reset();
		if (nudge !== "runNow") runNow.reset();
	};
	const failed: { nudge: Nudge; error: Error } | null = pause.error
		? { nudge: "pause", error: pause.error }
		: resume.error
			? { nudge: "resume", error: resume.error }
			: runNow.error
				? { nudge: "runNow", error: runNow.error }
				: null;
	const problem = failed ? nudgeProblem(failed.error) : null;

	return {
		pause: () => {
			only("pause");
			pause.mutate(input);
		},
		resume: () => {
			only("resume");
			resume.mutate(input);
		},
		runNow: () => {
			only("runNow");
			runNow.mutate(input);
		},
		pausing: pause.isPending,
		resuming: resume.isPending,
		starting: runNow.isPending,
		copy:
			failed && problem
				? problemCopy(failed.nudge, problem, failed.error.message)
				: null,
		hidden: problem === "host-outdated",
	};
}
