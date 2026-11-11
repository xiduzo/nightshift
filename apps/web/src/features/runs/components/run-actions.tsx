import { runActions, runningStep, useRunActed } from "@nightshift/client";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Button } from "@nightshift/ui/components/button";
import { ButtonGroup } from "@nightshift/ui/components/button-group";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import {
	ChevronDownIcon,
	CircleStopIcon,
	ClipboardCopyIcon,
	DownloadIcon,
	InfoIcon,
	PlayIcon,
	RotateCcwIcon,
	SkipForwardIcon,
	WaypointsIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { RunDetail, RunStatus, StepSummary } from "@/shared/api";
import { orpc, SERVER_URL } from "@/shared/api";
import { runMutations } from "../queries";
import { ActionText } from "./action-text";
import { RunDetails } from "./details/run-details";
import { MoveSubmenu, useMoveRun } from "./move-menu";
import { RestartStepDialog } from "./step-actions";

const STOP_NOW_TEXT: Partial<Record<RunStatus, string>> = {
	waiting: "This closes the open gate without an answer and stops the run.",
	sleeping: "This ends the sleep and stops the run.",
	running: "This cancels the running step and stops the run.",
};

/**
 * All that you can do with the run, for the page header: one button for what
 * matters most now, and a menu with every action, the same one on top. Stop
 * goes first while the run can stop, then Take over, then Details.
 *
 * Mount one per run (`key`), so a dialog or sheet does not stay open for the
 * next run.
 */
export function RunActions({
	run,
	status,
	steps,
	onShowStep,
	onShowFlow,
}: {
	run: RunDetail;
	status: RunStatus;
	/** The run's steps as they stand, live. */
	steps: StepSummary[];
	onShowStep: (stepId: string) => void;
	/** Opens the run on its flow. */
	onShowFlow: () => void;
}) {
	const [confirmingStop, setConfirmingStop] = useState(false);
	const [restarting, setRestarting] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);

	const allows = runActions(status, run.walker.thisDevice, run.result);
	// A run of another device: its session and its files are there.
	const here = run.walker.thisDevice;
	const running = here && allows.restart ? runningStep(steps) : undefined;
	const takeOverCommand =
		here && run.device.thisDevice ? run.takeOverCommand : null;
	const move = useMoveRun(run, status);

	const runActed = useRunActed({ orpc });
	const stopRun = useMutation(
		runMutations.stop({
			onSuccess: (_, { runId }) => runActed(runId),
			onError: (error, { when }) =>
				toast.error(
					when === "cancel-after-step"
						? `Could not keep the run going: ${error.message}`
						: `Could not stop: ${error.message}`,
				),
		}),
	);
	const stopPending = stopRun.isPending
		? (stopRun.variables?.when ?? "now")
		: null;
	const stopPlanned = allows.stop && run.stopAfterStep;
	const stopFirst = allows.stop && !run.stopAfterStep;

	const takeOver = async () => {
		if (!takeOverCommand) return;
		try {
			await navigator.clipboard.writeText(takeOverCommand);
			toast.success("Command copied. Paste it in a terminal to take over.");
		} catch {
			toast.error("Could not copy. Run this command in a terminal.", {
				description: takeOverCommand,
			});
		}
	};

	const others = running || takeOverCommand || move.offered || here;

	return (
		<>
			<ButtonGroup>
				{stopPlanned ? (
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							stopRun.mutate({ runId: run.id, when: "cancel-after-step" })
						}
						disabled={stopPending !== null}
					>
						{stopPending === "cancel-after-step" ? (
							<Spinner data-icon="inline-start" />
						) : (
							<PlayIcon data-icon="inline-start" />
						)}
						Keep running
					</Button>
				) : stopFirst ? (
					<Button
						variant="destructive"
						size="sm"
						onClick={() => setConfirmingStop(true)}
						disabled={stopPending !== null}
					>
						{stopPending ? (
							<Spinner data-icon="inline-start" />
						) : (
							<CircleStopIcon data-icon="inline-start" />
						)}
						{stopPending ? "Stopping…" : "Stop"}
					</Button>
				) : takeOverCommand ? (
					<Button variant="outline" size="sm" onClick={takeOver}>
						<ClipboardCopyIcon data-icon="inline-start" />
						Take over
					</Button>
				) : (
					<Button
						variant="outline"
						size="sm"
						onClick={() => setDetailsOpen(true)}
					>
						<InfoIcon data-icon="inline-start" />
						Details
					</Button>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant={stopFirst ? "destructive" : "outline"}
								size="icon-sm"
								className={cn(stopFirst && "border-l-destructive/30")}
								aria-label="More actions"
								disabled={stopPending !== null || move.pending}
							/>
						}
					>
						{move.pending ? <Spinner /> : <ChevronDownIcon />}
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-64">
						{allows.stop ? (
							<>
								<DropdownMenuItem
									variant="destructive"
									onClick={() => setConfirmingStop(true)}
								>
									<CircleStopIcon />
									<ActionText
										label="Stop now"
										hint="Cancels the running step."
									/>
								</DropdownMenuItem>
								{run.stopAfterStep ? null : (
									<DropdownMenuItem
										onClick={() =>
											stopRun.mutate({ runId: run.id, when: "after-step" })
										}
									>
										<SkipForwardIcon />
										<ActionText
											label="Stop after this step"
											hint="The running step finishes, then the run stops."
										/>
									</DropdownMenuItem>
								)}
								{others ? <DropdownMenuSeparator /> : null}
							</>
						) : null}
						{running ? (
							<DropdownMenuItem onClick={() => setRestarting(true)}>
								<RotateCcwIcon />
								<ActionText
									label="Restart step"
									hint="Stops the running step and starts it again."
								/>
							</DropdownMenuItem>
						) : null}
						{takeOverCommand ? (
							<DropdownMenuItem onClick={takeOver}>
								<ClipboardCopyIcon />
								<ActionText
									label="Take over"
									hint="Copies a command to paste in a terminal."
								/>
							</DropdownMenuItem>
						) : null}
						{move.offered ? <MoveSubmenu move={move} /> : null}
						{here ? (
							<DropdownMenuItem
								render={
									<a
										href={`${SERVER_URL}/api/runs/${run.id}/export`}
										download
									/>
								}
							>
								<DownloadIcon />
								<ActionText
									label="Export"
									hint="The file has no saved secrets. A transcript shows all that the agents read or wrote, so check it before you share it."
								/>
							</DropdownMenuItem>
						) : null}
						{allows.stop || others ? <DropdownMenuSeparator /> : null}
						<DropdownMenuItem onClick={onShowFlow}>
							<WaypointsIcon />
							Show flow
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => setDetailsOpen(true)}>
							<InfoIcon />
							Details
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</ButtonGroup>
			<AlertDialog open={confirmingStop} onOpenChange={setConfirmingStop}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogMedia className="bg-destructive/10 text-destructive">
							<CircleStopIcon />
						</AlertDialogMedia>
						<AlertDialogTitle>Stop this run now?</AlertDialogTitle>
						<AlertDialogDescription>
							{STOP_NOW_TEXT[status] ?? "This stops the run."} You can resume it
							later.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep it running</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								setConfirmingStop(false);
								stopRun.mutate({ runId: run.id, when: "now" });
							}}
						>
							Stop now
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{running ? (
				<RestartStepDialog
					key={running.id}
					runId={run.id}
					step={running}
					open={restarting}
					onOpenChange={setRestarting}
				/>
			) : null}
			<RunDetails
				run={run}
				steps={steps}
				status={status}
				open={detailsOpen}
				onOpenChange={setDetailsOpen}
				onShowStep={onShowStep}
			/>
		</>
	);
}
