import {
	createRunMutations,
	createRunQueries,
	type RunStatus,
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
import { Button } from "@nightshift/ui-native/components/ui/button";
import { CardContent } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleStop, type LucideIcon, Play } from "lucide-react-native";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";
import { ErrorAlert } from "@/shared/feedback";
import { runActionsFor } from "./run-facts";

/**
 * Stop a run that is on its way, or resume one that stopped, failed or
 * was interrupted. Each asks first. The content of the run's Card, or
 * nothing when the run can do neither.
 */
export function RunActions({
	runId,
	status,
}: {
	runId: string;
	status: RunStatus;
}) {
	const runQueries = useHostQueries(createRunQueries);
	const runMutations = useHostQueries(createRunMutations);
	const queryClient = useQueryClient();
	const refetch = () =>
		queryClient.invalidateQueries({ queryKey: runQueries.all() });
	const stop = useMutation(runMutations.stop({ onSuccess: refetch }));
	const resume = useMutation(runMutations.resume({ onSuccess: refetch }));

	const { canStop, canResume } = runActionsFor(status);
	const failure = stop.error
		? { title: "The run did not stop", message: stop.error.message }
		: resume.error
			? { title: "The run did not resume", message: resume.error.message }
			: null;

	if (!canStop && !canResume) return null;

	return (
		<CardContent className="gap-3 px-4">
			<View className="gap-2">
				{canStop ? (
					<Confirm
						button="Stop run"
						icon={CircleStop}
						busy={stop.isPending}
						title="Stop this run?"
						description="The running step stops now, and no new step starts. You can resume the run later."
						confirm="Stop run"
						destructive
						onConfirm={() => {
							resume.reset();
							stop.mutate({ runId, when: "now" });
						}}
					/>
				) : null}
				{canResume ? (
					<Confirm
						button="Resume run"
						icon={Play}
						busy={resume.isPending}
						title="Resume this run?"
						description="The run goes on at its last step."
						confirm="Resume run"
						onConfirm={() => {
							stop.reset();
							resume.mutate({ runId });
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

/** A button that asks in an Alert Dialog before it acts. */
function Confirm({
	button,
	icon,
	busy,
	title,
	description,
	confirm,
	destructive = false,
	onConfirm,
}: {
	button: string;
	icon: LucideIcon;
	busy: boolean;
	title: string;
	description: string;
	confirm: string;
	destructive?: boolean;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					size="lg"
					variant={destructive ? "outline" : "default"}
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
				<AlertDialogFooter>
					<AlertDialogCancel>
						<Text>Cancel</Text>
					</AlertDialogCancel>
					<AlertDialogAction
						className={destructive ? "bg-destructive" : undefined}
						onPress={onConfirm}
					>
						<Text>{confirm}</Text>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
