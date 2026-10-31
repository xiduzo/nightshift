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
import { Badge } from "@nightshift/ui/components/badge";
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import {
	AlarmClockIcon,
	ChevronDownIcon,
	CircleStopIcon,
	ClipboardCopyIcon,
	DownloadIcon,
	PlayIcon,
	RotateCcwIcon,
	SendIcon,
	SkipForwardIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { WalkerBadge, walkerName } from "@/features/devices";
import type { RunDetail, RunStatus, StepSummary } from "@/shared/api";
import { orpc, SERVER_URL } from "@/shared/api";
import { dayWord, formatDateTime, formatTime } from "@/shared/format";
import { runMutations } from "../queries";
import { CostText } from "./cost-text";
import { useWorkTime } from "./elapsed";
import { MoveMenu } from "./move-menu";
import { RunStatusBadge } from "./run-status-badge";
import { RestartStepDialog } from "./step-actions";

/**
 * The run on one line: its title, status and stop plans, and how long it ran
 * and what it cost. The rest of its facts sit in `RunDetails`
 * (`run-details.tsx`).
 */
export function RunTitle({
	run,
	steps,
	status,
	reconnecting,
}: {
	run: RunDetail;
	steps: StepSummary[];
	status: RunStatus;
	reconnecting: boolean;
}) {
	const stoppable = runActions(status, run.walker.thisDevice, run.result).stop;
	const time = useWorkTime(steps, run.createdAt);

	return (
		<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-3 lg:px-5 lg:pt-4">
			<h1 className="min-w-0 truncate font-semibold text-lg tracking-tight">
				{run.title}
			</h1>
			<div aria-live="polite" className="flex flex-wrap items-center gap-2">
				<RunStatusBadge status={status} result={run.result} />
				<WalkerBadge walker={run.device} />
				{run.commands.length > 0 ? (
					<Badge
						variant="outline"
						title={`It applies when ${walkerName(run.walker)} is online.`}
					>
						<SendIcon aria-hidden="true" />
						Sent to {walkerName(run.walker)}
					</Badge>
				) : null}
				{stoppable && run.stopAfterStep ? (
					<Badge
						variant="outline"
						className="border-status-stopped/40 text-status-stopped"
						title="The running step finishes, then the run stops."
					>
						<SkipForwardIcon aria-hidden="true" />
						Stops after this step
					</Badge>
				) : null}
				{stoppable && run.stopAt ? (
					<Badge
						variant="outline"
						title={`No new step starts after ${formatDateTime(run.stopAt)}.`}
					>
						<AlarmClockIcon aria-hidden="true" />
						Stops {dayWord(run.stopAt)} {formatTime(run.stopAt)}
					</Badge>
				) : null}
				{reconnecting ? (
					<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
						<Spinner className="size-3" />
						Reconnecting…
					</span>
				) : null}
			</div>
			<p className="ml-auto shrink-0 text-muted-foreground text-sm tabular-nums">
				{time.waited || time.slept ? (
					<Tooltip>
						<TooltipTrigger render={<span />}>
							<span className="sr-only">Worked for </span>
							{time.active}
							<span className="sr-only">
								{time.waited ? `, waited for you ${time.waited}` : ""}
								{time.slept ? `, slept ${time.slept}` : ""}
							</span>
						</TooltipTrigger>
						<TooltipContent>
							Worked {time.active}
							{time.waited ? ` · waited for you ${time.waited}` : ""}
							{time.slept ? ` · slept ${time.slept}` : ""} · open {time.open}
						</TooltipContent>
					</Tooltip>
				) : (
					<>
						<span className="sr-only">Ran for </span>
						{time.active}
					</>
				)}
				<span aria-hidden="true"> · </span>
				<span className="sr-only">, cost </span>
				<CostText cost={run} />
			</p>
		</div>
	);
}

/** The run's actions for the page header: take over the session, and stop or restart the step. */
export function RunActions({
	run,
	status,
	steps,
}: {
	run: RunDetail;
	status: RunStatus;
	/** The run's steps as they stand, live. */
	steps: StepSummary[];
}) {
	const [restarting, setRestarting] = useState(false);
	const allows = runActions(status, run.walker.thisDevice, run.result);
	const running = allows.restart ? runningStep(steps) : undefined;
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

	const takeOver = async () => {
		if (!run.takeOverCommand) return;
		try {
			await navigator.clipboard.writeText(run.takeOverCommand);
			toast.success("Command copied. Paste it in a terminal to take over.");
		} catch {
			toast.error("Could not copy. Copy the command from the tooltip.");
		}
	};

	// A run of another device: its session and its files are there. Stop goes to it.
	if (!run.walker.thisDevice) {
		return (
			<>
				<MoveMenu run={run} status={status} />
				{allows.stop ? (
					<StopMenu
						key={run.id}
						status={status}
						stopAfterStep={run.stopAfterStep}
						pending={stopPending}
						onStop={(when) => stopRun.mutate({ runId: run.id, when })}
					/>
				) : null}
			</>
		);
	}

	return (
		<>
			{run.device.thisDevice ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="outline"
								size="sm"
								onClick={takeOver}
								disabled={!run.takeOverCommand}
								aria-label="Take over"
							/>
						}
					>
						<ClipboardCopyIcon data-icon="inline-start" />
						<span className="hidden sm:inline">Take over</span>
					</TooltipTrigger>
					<TooltipContent className="max-w-sm break-all font-mono">
						{run.takeOverCommand ?? "No agent session to take over yet."}
					</TooltipContent>
				</Tooltip>
			) : null}
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="outline"
							size="sm"
							nativeButton={false}
							render={
								<a
									href={`${SERVER_URL}/api/runs/${run.id}/export`}
									download
									aria-label="Export run"
								/>
							}
						/>
					}
				>
					<DownloadIcon data-icon="inline-start" />
					<span className="hidden sm:inline">Export</span>
				</TooltipTrigger>
				<TooltipContent className="max-w-sm">
					Download the run as one file, with its flow, steps and transcripts.
					The file has no saved secrets. But a transcript shows all that the
					agents read or wrote. Check it before you share it.
				</TooltipContent>
			</Tooltip>
			<MoveMenu run={run} status={status} />
			{allows.stop ? (
				<StopMenu
					key={run.id}
					status={status}
					stopAfterStep={run.stopAfterStep}
					pending={stopPending}
					onStop={(when) => stopRun.mutate({ runId: run.id, when })}
					onRestart={running ? () => setRestarting(true) : undefined}
				/>
			) : null}
			{running ? (
				<RestartStepDialog
					key={running.id}
					runId={run.id}
					step={running}
					open={restarting}
					onOpenChange={setRestarting}
				/>
			) : null}
		</>
	);
}

const STOP_NOW_TEXT: Partial<Record<RunStatus, string>> = {
	waiting: "This closes the open gate without an answer and stops the run.",
	sleeping: "This ends the sleep and stops the run.",
	running: "This cancels the running step and stops the run.",
};

type StopWhen = "now" | "after-step" | "cancel-after-step";

/**
 * Stop now (after a confirmation), let the running step finish first, or
 * restart the running step (`onRestart`, while a step runs here). Once a
 * stop after the step is planned, the main action takes it back.
 */
function StopMenu({
	status,
	stopAfterStep,
	pending,
	onStop,
	onRestart,
}: {
	status: RunStatus;
	stopAfterStep: boolean;
	/** The stop on its way, if any. */
	pending: StopWhen | null;
	onStop: (when: StopWhen) => void;
	onRestart?: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const variant = stopAfterStep ? "outline" : "destructive";
	return (
		<>
			<ButtonGroup>
				{stopAfterStep ? (
					<Button
						variant="outline"
						size="sm"
						onClick={() => onStop("cancel-after-step")}
						disabled={pending !== null}
					>
						{pending === "cancel-after-step" ? (
							<Spinner data-icon="inline-start" />
						) : (
							<PlayIcon data-icon="inline-start" />
						)}
						Keep running
					</Button>
				) : (
					<Button
						variant="destructive"
						size="sm"
						onClick={() => setConfirming(true)}
						disabled={pending !== null}
					>
						{pending ? (
							<Spinner data-icon="inline-start" />
						) : (
							<CircleStopIcon data-icon="inline-start" />
						)}
						{pending ? "Stopping…" : "Stop"}
					</Button>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant={variant}
								size="icon-sm"
								className={cn(!stopAfterStep && "border-l-destructive/30")}
								aria-label="More ways to stop"
								disabled={pending !== null}
							/>
						}
					>
						<ChevronDownIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-64">
						<DropdownMenuItem
							variant="destructive"
							onClick={() => setConfirming(true)}
						>
							<CircleStopIcon />
							<span className="flex flex-col">
								Stop now
								<span className="text-muted-foreground text-xs">
									Cancels the running step.
								</span>
							</span>
						</DropdownMenuItem>
						{stopAfterStep ? null : (
							<DropdownMenuItem onClick={() => onStop("after-step")}>
								<SkipForwardIcon />
								<span className="flex flex-col">
									Stop after this step
									<span className="text-muted-foreground text-xs">
										The running step finishes, then the run stops.
									</span>
								</span>
							</DropdownMenuItem>
						)}
						{onRestart ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={onRestart}>
									<RotateCcwIcon />
									<span className="flex flex-col">
										Restart step
										<span className="text-muted-foreground text-xs">
											Stops the running step and starts it again.
										</span>
									</span>
								</DropdownMenuItem>
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			</ButtonGroup>
			<AlertDialog open={confirming} onOpenChange={setConfirming}>
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
								setConfirming(false);
								onStop("now");
							}}
						>
							Stop now
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
