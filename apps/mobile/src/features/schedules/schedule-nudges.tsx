import {
	createScheduleQueries,
	nudgeProblem,
	type ScheduleSummary,
	scheduleName,
	scheduleNudges,
	useRunActed,
	withPause,
} from "@nightshift/client";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@nightshift/ui-native/components/ui/alert-dialog";
import {
	Button,
	buttonTextVariants,
} from "@nightshift/ui-native/components/ui/button";
import { Card, CardContent } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import {
	Text,
	TextClassContext,
} from "@nightshift/ui-native/components/ui/text";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { CalendarCheck, Moon, Play } from "lucide-react-native";
import { View } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import { openRun } from "@/features/runs";
import { ErrorAlert } from "@/shared/feedback";
import { type Nudge, problemCopy } from "./schedule-words";

/**
 * Pause tonight (or Resume tonight) and Run now, as the schedule allows.
 * A pause shows at once, in this sheet and in the list. Run now asks
 * first, then opens the run it started. When a nudge does not work, an
 * Alert says what happened and what to do. An older Host does not know
 * the nudges: then the buttons go, and the Alert says so.
 */
export function ScheduleNudges({
	projectId,
	schedule,
	paused,
	now,
}: {
	projectId: string;
	schedule: ScheduleSummary;
	/** Paused tonight, also while a pause is on its way. */
	paused: boolean;
	now: number;
}) {
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
				// Close this sheet, then follow the run on the main screens.
				if (router.canDismiss()) router.dismiss();
				openRun(run.id);
			},
		}),
	);

	const input = { projectId, scheduleId: schedule.id };
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
	const copy =
		failed && problem
			? problemCopy(failed.nudge, problem, failed.error.message)
			: null;

	// A pause on its way counts: the buttons follow what the sheet shows.
	const allowed = scheduleNudges(schedule, now);
	const canPause = !paused && allowed.pause;
	const canResume = paused;
	const hidden = problem === "host-outdated";
	if (!canPause && !canResume && !allowed.runNow) return null;

	return (
		<Card className="py-4">
			<CardContent className="gap-3 px-4">
				{hidden ? null : (
					<View className="gap-2">
						{canPause ? (
							<Button
								size="lg"
								variant="outline"
								disabled={pause.isPending}
								className="h-auto min-h-11 py-2"
								accessibilityHint="Skips its starts until tomorrow morning"
								onPress={() => {
									only("pause");
									pause.mutate(input);
								}}
							>
								<Icon as={Moon} />
								<Text>Pause tonight</Text>
							</Button>
						) : null}
						{canResume ? (
							<Button
								size="lg"
								variant="outline"
								disabled={resume.isPending}
								className="h-auto min-h-11 py-2"
								accessibilityHint="Starts it at its next time again"
								onPress={() => {
									only("resume");
									resume.mutate(input);
								}}
							>
								<Icon as={CalendarCheck} />
								<Text>Resume tonight</Text>
							</Button>
						) : null}
						{allowed.runNow ? (
							<RunNowButton
								name={scheduleName(schedule)}
								busy={runNow.isPending}
								onConfirm={() => {
									only("runNow");
									runNow.mutate(input);
								}}
							/>
						) : null}
					</View>
				)}
				{copy ? (
					<ErrorAlert
						title={copy.title}
						message={copy.message}
						fix={copy.fix}
					/>
				) : null}
			</CardContent>
		</Card>
	);
}

/** Run now: asks in an Alert Dialog first. */
function RunNowButton({
	name,
	busy,
	onConfirm,
}: {
	name: string;
	busy: boolean;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button size="lg" disabled={busy} className="h-auto min-h-11 py-2">
					<Icon as={Play} />
					<Text>{busy ? "Starting…" : "Run now"}</Text>
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent className="w-[90%]">
				<AlertDialogHeader>
					<AlertDialogTitle>{`Run ${name} now?`}</AlertDialogTitle>
					<AlertDialogDescription>
						The run starts at once, with the inputs of this schedule. A pause
						tonight stays.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>
						<Text>Cancel</Text>
					</AlertDialogCancel>
					<AlertDialogAction onPress={onConfirm}>
						{/* The Action gives its className to the text too: the label takes the text classes of its variant only. */}
						<TextClassContext.Provider value={buttonTextVariants()}>
							<Text>Run now</Text>
						</TextClassContext.Provider>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
