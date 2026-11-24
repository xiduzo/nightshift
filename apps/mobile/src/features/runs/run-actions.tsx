import {
	hasEnded,
	type RerunStart,
	type RunActing,
	type RunStatus,
	type StepSummary,
	stepName,
	useRunActed,
} from "@nightshift/client";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { Alert } from "react-native";

import { useSignedIn } from "@/features/access";
import { ErrorAlert } from "@/shared/feedback";
import type { RunActionKind } from "./run-facts";

const ACTIONS = ["stop", "resume", "restart", "rerun"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Stop, Resume, Restart step and Run again of one run. While one is on
 * its way, and after it until the run gets there, `acting` says which:
 * the screen shows its result at once (`actedRunStatus`). It reads the
 * mutation's `variables`, so a failed action shows the run as it is
 * again. `status` is the run's own status: once a resume or a run again
 * has the run on its way, the action lets go, so a run that ends again
 * shows how it ended.
 */
export function useRunAct(runId: string, status: RunStatus) {
	const { host } = useSignedIn();
	const runActed = useRunActed(host);
	const refetch = () => runActed(runId);
	const stop = useMutation(
		host.orpc.runs.stop.mutationOptions({ onSuccess: refetch }),
	);
	const resume = useMutation(
		host.orpc.runs.resume.mutationOptions({ onSuccess: refetch }),
	);
	const restart = useMutation(
		host.orpc.runs.restartStep.mutationOptions({ onSuccess: refetch }),
	);
	const rerun = useMutation(
		host.orpc.runs.rerun.mutationOptions({ onSuccess: refetch }),
	);
	const onItsWay = !hasEnded(status);
	const resumed = resume.isSuccess && onItsWay;
	const reran = rerun.isSuccess && onItsWay;
	const { reset: resetResume } = resume;
	const { reset: resetRerun } = rerun;
	useEffect(() => {
		if (resumed) resetResume();
		if (reran) resetRerun();
	}, [resumed, reran, resetResume, resetRerun]);

	const mutations = { stop, resume, restart, rerun };
	let acting: RunActing = null;
	for (const action of ACTIONS) {
		const mutation = mutations[action];
		if (mutation.variables?.runId === runId && !mutation.isError) {
			acting = { action, settled: mutation.isSuccess };
			break;
		}
	}
	/** Forget the other actions before one starts: one shows at a time. */
	const only = (action: Action) => {
		for (const other of ACTIONS) {
			if (other !== action) mutations[other].reset();
		}
	};
	return { stop, resume, restart, rerun, acting, only };
}

export type RunAct = ReturnType<typeof useRunAct>;

/** What a failed action says. */
const FAILED: Record<Action, string> = {
	stop: "The run did not stop",
	resume: "The run did not resume",
	restart: "The step did not restart",
	rerun: "The run did not start again",
};

/** What a run action needs to know to ask and to act. */
export type RunActionContext = {
	runId: string;
	act: RunAct;
	/** The words of a resume: "Retry", "Resume at build". */
	label?: string;
	/** The step a resume continues at. */
	resumeAt?: string | null;
	/** The step a restart starts again (`runningStep`). */
	restartStep?: StepSummary;
	/** Where the run can run again from (`rerunStarts`). */
	rerunFrom?: RerunStart<StepSummary>[];
	labels: ReadonlyMap<string, string>;
};

/** What one action asks before it acts, and what it does. */
type Ask = {
	title: string;
	description: string;
	confirm: string;
	destructive?: boolean;
	run: () => void;
};

/** Stop, Resume and Restart step: the question, its words and the act. Run again asks where from first. */
function askOf(
	action: Exclude<RunActionKind, "rerun">,
	{ runId, act, label, resumeAt = null, restartStep, labels }: RunActionContext,
): Ask | null {
	const { stop, resume, restart, only } = act;
	switch (action) {
		case "resume": {
			const retry = label === "Retry";
			return {
				title: retry ? "Retry this run?" : "Resume this run?",
				description: retry
					? "The run continues at the step that failed."
					: `The run continues at ${resumeAt ?? "its last step"}.`,
				confirm: retry ? "Retry" : "Resume run",
				run: () => {
					only("resume");
					resume.mutate({ runId });
				},
			};
		}
		case "restart":
			return restartStep
				? {
						title: `Restart ${stepName(restartStep, labels)}?`,
						description:
							"The step stops and starts again at once. An agent continues its conversation.",
						confirm: "Restart step",
						run: () => {
							only("restart");
							restart.mutate({ runId, stepId: restartStep.id });
						},
					}
				: null;
		case "stop":
			return {
				title: "Stop this run?",
				description:
					"The running step stops now, and no new step starts. You can resume the run later.",
				confirm: "Stop run",
				destructive: true,
				run: () => {
					only("stop");
					stop.mutate({ runId, when: "now" });
				},
			};
	}
}

const RERUN_TITLE = "Run this again?";
const RERUN_DESCRIPTION =
	"The step you choose runs again. The steps after it follow as the flow says.";

/** "From the start: Gather", "From the last step: Review". */
function rerunChoice(
	start: RerunStart<StepSummary>,
	labels: ReadonlyMap<string, string>,
): string {
	return `${start.from === "start" ? "From the start" : "From the last step"}: ${stepName(start.step, labels)}`;
}

/**
 * Asks in the system alert before a run action acts: for a header button
 * or a menu item, which hold no dialog of their own. Run again offers
 * where it runs from as the buttons of the alert.
 */
export function confirmRunAction(
	action: RunActionKind,
	context: RunActionContext,
): void {
	if (action !== "rerun") {
		const ask = askOf(action, context);
		if (!ask) return;
		Alert.alert(ask.title, ask.description, [
			{ text: "Cancel", style: "cancel" },
			{
				text: ask.confirm,
				style: ask.destructive ? "destructive" : "default",
				onPress: ask.run,
			},
		]);
		return;
	}
	const { runId, act, rerunFrom = [], labels } = context;
	if (rerunFrom.length === 0) return;
	const run = (start: RerunStart<StepSummary>) => {
		act.only("rerun");
		act.rerun.mutate({
			runId,
			nodeId: start.step.nodeId,
			stepId: start.step.id,
		});
	};
	Alert.alert(
		RERUN_TITLE,
		[
			RERUN_DESCRIPTION,
			...rerunFrom.map((start) => rerunChoice(start, labels)),
		].join("\n\n"),
		[
			{ text: "Cancel", style: "cancel" },
			...rerunFrom.map((start) => ({
				text:
					rerunFrom.length === 1
						? "Run again"
						: start.from === "start"
							? "From the start"
							: "From the last step",
				onPress: () => run(start),
			})),
		],
	);
}

/** The action that failed last. Undefined when none failed. */
export function failedAction(act: RunAct): Action | undefined {
	return ACTIONS.find((action) => act[action].error);
}

/** Why the last action did not work, and how to fix it. Nothing when none failed. */
export function RunActionFailure({ act }: { act: RunAct }) {
	const failed = failedAction(act);
	if (!failed) return null;
	return (
		<ErrorAlert
			title={FAILED[failed]}
			message={act[failed].error?.message ?? ""}
			fix="Check that this phone is online and that your role in this Space lets you do this."
		/>
	);
}
