import {
	type RunActions as Allowed,
	hasEnded,
	type RerunStart,
	type RunActing,
	type RunStatus,
	type StepSummary,
	stepName,
	useRunActed,
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
	buttonVariants,
} from "@nightshift/ui-native/components/ui/button";
import { CardContent } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Label } from "@nightshift/ui-native/components/ui/label";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui-native/components/ui/radio-group";
import {
	Text,
	TextClassContext,
} from "@nightshift/ui-native/components/ui/text";
import { useMutation } from "@tanstack/react-query";
import {
	CircleStop,
	type LucideIcon,
	Play,
	RotateCcw,
} from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { View } from "react-native";

import { useSignedIn } from "@/features/host";
import { ErrorAlert } from "@/shared/feedback";

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

/**
 * Resume a run that ended, run it again from a step, restart the step
 * that runs, or stop the run, as the run allows (`runActions`). Each asks
 * first. The content of the run's Card, or nothing when the run allows
 * none of them.
 */
export function RunActions({
	runId,
	allows,
	act,
	restartStep,
	rerunFrom,
	labels,
}: {
	runId: string;
	allows: Pick<Allowed, Action>;
	act: RunAct;
	/** The step a restart starts again (`runningStep`). */
	restartStep: StepSummary | undefined;
	/** Where the run can run again from (`rerunStarts`). */
	rerunFrom: RerunStart<StepSummary>[];
	labels: ReadonlyMap<string, string>;
}) {
	const { stop, resume, restart, rerun, acting, only } = act;
	const canRestart = allows.restart && restartStep !== undefined;
	const canRerun = allows.rerun && rerunFrom.length > 0;
	const failed = ACTIONS.find((action) => act[action].error);
	const failure = failed
		? { title: FAILED[failed], message: act[failed].error?.message ?? "" }
		: null;

	if (!allows.stop && !canRestart && !allows.resume && !canRerun) return null;

	return (
		<CardContent className="gap-3 px-4">
			<View className="gap-2">
				{allows.resume ? (
					<Confirm
						button="Resume run"
						icon={Play}
						busy={acting?.action === "resume"}
						title="Resume this run?"
						description="The run continues at its last step."
						confirm="Resume run"
						onConfirm={() => {
							only("resume");
							resume.mutate({ runId });
						}}
					/>
				) : null}
				{canRerun ? (
					<RerunConfirm
						starts={rerunFrom}
						labels={labels}
						busy={acting?.action === "rerun"}
						secondary={allows.resume}
						onConfirm={(step) => {
							only("rerun");
							rerun.mutate({ runId, nodeId: step.nodeId, stepId: step.id });
						}}
					/>
				) : null}
				{canRestart && restartStep ? (
					<Confirm
						button="Restart step"
						icon={RotateCcw}
						busy={acting?.action === "restart"}
						title={`Restart ${stepName(restartStep, labels)}?`}
						description="The step stops and starts again at once. An agent continues its conversation."
						confirm="Restart step"
						secondary
						onConfirm={() => {
							only("restart");
							restart.mutate({ runId, stepId: restartStep.id });
						}}
					/>
				) : null}
				{allows.stop ? (
					<Confirm
						button="Stop run"
						icon={CircleStop}
						busy={acting?.action === "stop"}
						title="Stop this run?"
						description="The running step stops now, and no new step starts. You can resume the run later."
						confirm="Stop run"
						destructive
						onConfirm={() => {
							only("stop");
							stop.mutate({ runId, when: "now" });
						}}
					/>
				) : null}
			</View>
			{failure ? (
				<ErrorAlert
					title={failure.title}
					message={failure.message}
					fix="Check that this phone is online and that your role in this Space lets you do this."
				/>
			) : null}
		</CardContent>
	);
}

/**
 * Run again, after you choose where from: the start of the flow or the
 * last step. That step runs again, and the steps after it follow as the
 * flow says.
 */
function RerunConfirm({
	starts,
	labels,
	busy,
	secondary,
	onConfirm,
}: {
	starts: RerunStart<StepSummary>[];
	labels: ReadonlyMap<string, string>;
	busy: boolean;
	/** Resume is the main action next to it. */
	secondary: boolean;
	onConfirm: (step: StepSummary) => void;
}) {
	const [from, setFrom] = useState<RerunStart["from"]>("last");
	const chosen = starts.find((start) => start.from === from) ?? starts[0];
	return (
		<Confirm
			button="Run again"
			icon={RotateCcw}
			busy={busy}
			title="Run this again?"
			description="The step you choose runs again. The steps after it follow as the flow says."
			confirm="Run again"
			secondary={secondary}
			onConfirm={() => {
				if (chosen) onConfirm(chosen.step);
			}}
		>
			{starts.length > 1 ? (
				<RadioGroup
					value={chosen?.from}
					onValueChange={(value) => setFrom(value as RerunStart["from"])}
					accessibilityLabel="Run again from"
				>
					{starts.map((start) => (
						<View
							key={start.from}
							className="min-h-11 flex-row items-center gap-3"
						>
							<RadioGroupItem
								value={start.from}
								aria-labelledby={`rerun-${start.from}`}
							/>
							<Label
								nativeID={`rerun-${start.from}`}
								onPress={() => setFrom(start.from)}
							>
								{`${start.from === "start" ? "From the start" : "From the last step"}: ${stepName(start.step, labels)}`}
							</Label>
						</View>
					))}
				</RadioGroup>
			) : (
				<Text className="text-muted-foreground text-sm">
					{starts[0] ? `From ${stepName(starts[0].step, labels)}` : null}
				</Text>
			)}
		</Confirm>
	);
}

/** A button that asks in an Alert Dialog before it acts. */
function Confirm({
	button,
	icon,
	busy,
	title,
	description,
	confirm,
	destructive = false,
	secondary = false,
	onConfirm,
	children,
}: {
	button: string;
	icon: LucideIcon;
	busy: boolean;
	title: string;
	description: string;
	confirm: string;
	destructive?: boolean;
	/** Not the main action: an outline button. */
	secondary?: boolean;
	onConfirm: () => void;
	/** A choice to make before it acts, under the description. */
	children?: ReactNode;
}) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					size="lg"
					variant={destructive || secondary ? "outline" : "default"}
					disabled={busy}
					className="h-auto min-h-11 py-2"
				>
					<Icon as={icon} />
					<Text>{busy ? `${button}…` : button}</Text>
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent className="w-[90%]">
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				{children}
				<AlertDialogFooter>
					<AlertDialogCancel>
						<Text>Cancel</Text>
					</AlertDialogCancel>
					<AlertDialogAction
						className={
							destructive
								? buttonVariants({ variant: "destructive" })
								: undefined
						}
						onPress={onConfirm}
					>
						{/* The Action gives its className to the text too: the label takes the text classes of its variant only. */}
						<TextClassContext.Provider
							value={buttonTextVariants({
								variant: destructive ? "destructive" : "default",
							})}
						>
							<Text>{confirm}</Text>
						</TextClassContext.Provider>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
