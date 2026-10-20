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
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Separator } from "@nightshift/ui/components/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@nightshift/ui/components/sheet";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	AlarmClockIcon,
	ChevronDownIcon,
	CircleStopIcon,
	ClipboardCopyIcon,
	CopyIcon,
	DownloadIcon,
	InfoIcon,
	MonitorIcon,
	PlayIcon,
	RotateCcwIcon,
	SendIcon,
	SkipForwardIcon,
	WorkflowIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { CostText } from "@/components/cost-text";
import { RunStatusBadge } from "@/components/run-status-badge";
import type { RunDetail, RunStatus, StepSummary } from "@/lib/api-types";
import { authClient } from "@/lib/auth-client";
import {
	dayWord,
	formatDateTime,
	formatDayTime,
	formatTime,
} from "@/lib/format";
import { SERVER_URL } from "@/lib/server-url";
import { orpc } from "@/utils/orpc";

import { Elapsed } from "./elapsed";
import { MoveMenu } from "./move-menu";
import { RestartStepDialog } from "./step-actions";
import { WalkerBadge, walkerName } from "./walker-badge";

const STOPPABLE: RunStatus[] = ["running", "waiting", "sleeping"];

/** A git object id: shown short, with the full id in a tooltip. */
const SHA = /^[0-9a-f]{40}$/i;

/**
 * The run on one line: its title, status and stop plans, and how long it ran
 * and what it cost. The rest of its facts sit in `RunDetails`.
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
	const stoppable = STOPPABLE.includes(status);
	// Counts up while a step runs; otherwise ends at the last step's end.
	const lastEnd = steps.some((step) => step.endedAt === null)
		? null
		: Math.max(run.createdAt, ...steps.map((step) => step.endedAt ?? 0));

	return (
		<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-3 lg:px-5 lg:pt-4">
			<h1 className="min-w-0 truncate font-semibold text-lg tracking-tight">
				{run.title}
			</h1>
			<div aria-live="polite" className="flex flex-wrap items-center gap-2">
				<RunStatusBadge status={status} />
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
				<span className="sr-only">Ran for </span>
				<Elapsed start={run.createdAt} end={lastEnd} />
				<span aria-hidden="true"> · </span>
				<span className="sr-only">, cost </span>
				<CostText cost={run} />
			</p>
		</div>
	);
}

/** A button in the page header that opens every fact of the run in a Sheet. */
export function RunDetails({ run }: { run: RunDetail }) {
	return (
		<Sheet>
			<SheetTrigger
				render={<Button variant="outline" size="sm" aria-label="Details" />}
			>
				<InfoIcon data-icon="inline-start" />
				<span className="hidden sm:inline">Details</span>
			</SheetTrigger>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Run details</SheetTitle>
					<SheetDescription>
						What started it, where it ran, and what it cost.
					</SheetDescription>
				</SheetHeader>
				<ScrollArea className="min-h-0 flex-1">
					<div className="px-4 pb-6">
						<RunFacts run={run} />
					</div>
				</ScrollArea>
			</SheetContent>
		</Sheet>
	);
}

/** Every fact of the run, one per row, in three groups: what, where, when. */
function RunFacts({ run }: { run: RunDetail }) {
	const inputs = Object.entries(run.inputs ?? {}).map(
		([name, value]) =>
			[
				name,
				typeof value === "string" ? value : JSON.stringify(value),
			] as const,
	);
	const daemonResumes = run.resumes.filter((resume) => resume.by === "daemon");

	return (
		<div className="flex flex-col gap-5">
			<dl className="flex flex-col gap-3">
				<Fact label="Flow">
					<WorkflowIcon
						className="size-3.5 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					{run.flowName ? (
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId: run.projectId, name: run.flowName }}
							className="truncate rounded-sm font-mono underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							{run.flowName}
						</Link>
					) : (
						"Quick run"
					)}
				</Fact>
				{inputs.map(([name, value]) => (
					<Fact key={name} label={`Input · ${name}`}>
						<span className="truncate font-mono text-xs" title={value}>
							{value}
						</span>
					</Fact>
				))}
				<Fact label="Started by">
					<StartedBy run={run} />
				</Fact>
			</dl>
			<Separator />
			<dl className="flex flex-col gap-3">
				<Fact label="Branch">
					<CopyValue label="branch" value={run.branch} />
				</Fact>
				<Fact label="Base">
					<CopyValue
						label="base"
						value={run.baseRef}
						short={SHA.test(run.baseRef) ? run.baseRef.slice(0, 12) : undefined}
					/>
				</Fact>
				<Fact label="Runs on">
					<MonitorIcon
						className="size-3.5 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					{run.device.thisDevice ? "This computer" : walkerName(run.device)}
				</Fact>
				{run.walker.id !== run.device.id ? (
					<Fact label="Walked by">
						<MonitorIcon
							className="size-3.5 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						{run.walker.thisDevice ? "This computer" : walkerName(run.walker)}
					</Fact>
				) : null}
				{run.handOffs.length > 0 ? (
					<Fact label="Work moved">
						<ul className="flex min-w-0 flex-col gap-1 text-xs">
							{run.handOffs.map((handOff) => (
								<li key={`${handOff.at}-${handOff.commit}`}>
									{deviceLabel(handOff.from)} → {deviceLabel(handOff.to)}{" "}
									<span className="font-mono text-muted-foreground">
										{handOff.commit.slice(0, 7)}
									</span>
								</li>
							))}
						</ul>
					</Fact>
				) : null}
				{run.walker.thisDevice && run.device.thisDevice ? (
					<Fact label="Folder">
						<CopyValue label="folder path" value={run.worktreePath} />
					</Fact>
				) : null}
			</dl>
			<Separator />
			<dl className="flex flex-col gap-3">
				<Fact label="Cost">
					<CostText cost={run} className="font-medium tabular-nums" />
				</Fact>
				<Fact label="Started">
					<time
						dateTime={new Date(run.createdAt).toISOString()}
						className="truncate tabular-nums"
					>
						{formatDateTime(run.createdAt)}
					</time>
				</Fact>
				<Fact label="Stop time">
					{run.stopAt ? (
						<time
							dateTime={new Date(run.stopAt).toISOString()}
							className="truncate tabular-nums"
						>
							{formatDayTime(run.stopAt)}
						</time>
					) : (
						<span className="text-muted-foreground">None</span>
					)}
				</Fact>
				{daemonResumes.length > 0 ? (
					<Fact label="Resumed automatically">
						<ul className="flex min-w-0 flex-col gap-1 text-xs">
							{daemonResumes.map((resume) => (
								<li key={resume.at}>
									<span className="tabular-nums">
										{formatDayTime(resume.at)}
									</span>
									, at <span className="font-mono">{resume.nodeId}</span>:{" "}
									{resume.reason ?? "Night Shift restarted."}
								</li>
							))}
						</ul>
					</Fact>
				) : null}
			</dl>
		</div>
	);
}

/** A device of the run, as people read it: this computer, or its name. */
function deviceLabel(device: RunDetail["walker"]): string {
	return device.thisDevice ? "This computer" : walkerName(device);
}

/** One fact of the run: a small muted label above its value. */
/**
 * Who started the run: a schedule, you, or another Member of the Space.
 * Commits in the run are in the name of the person who started it.
 */
function StartedBy({ run }: { run: RunDetail }) {
	const session = authClient.useSession();
	if (run.trigger.kind === "schedule") {
		return <>Schedule · {run.trigger.scheduleId}</>;
	}
	if (!run.startedBy) {
		return <span className="text-muted-foreground">Not known</span>;
	}
	if (run.startedBy.id === session.data?.user.id) return <>You</>;
	return (
		<span className="truncate">{run.startedBy.name ?? "A former member"}</span>
	);
}

function Fact({
	label,
	className,
	children,
}: {
	label: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={cn("flex min-w-0 flex-col gap-1", className)}>
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className="flex min-h-6 min-w-0 items-center gap-1 text-sm">
				{children}
			</dd>
		</div>
	);
}

/** A mono value that may be cut short, with its full text in a tooltip and a copy button. */
function CopyValue({
	label,
	value,
	short,
}: {
	label: string;
	value: string;
	/** A shorter form to show, such as the start of a hash. */
	short?: string;
}) {
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(`Copied the ${label}.`);
		} catch {
			toast.error("Could not copy.");
		}
	};
	return (
		<>
			<Tooltip>
				<TooltipTrigger
					render={<span className="min-w-0 truncate font-mono text-xs" />}
				>
					{short ?? value}
				</TooltipTrigger>
				<TooltipContent className="max-w-md break-all font-mono">
					{value}
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-xs"
							className="text-muted-foreground"
							aria-label={`Copy the ${label}`}
							onClick={copy}
						/>
					}
				>
					<CopyIcon aria-hidden="true" />
				</TooltipTrigger>
				<TooltipContent>Copy</TooltipContent>
			</Tooltip>
		</>
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
	// The innermost step that runs: a step inside a called flow starts after its caller.
	const running =
		status === "running"
			? [...steps].reverse().find((step) => step.endedAt === null)
			: undefined;
	const queryClient = useQueryClient();
	const stopRun = useMutation(
		orpc.runs.stop.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.runs.key() }),
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
				{STOPPABLE.includes(status) ? (
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
					Downloads the run as one file, with its flow, steps and transcripts.
					Saved secrets are removed, but a transcript shows everything the
					agents read or printed. Check it before you share it.
				</TooltipContent>
			</Tooltip>
			<MoveMenu run={run} status={status} />
			{STOPPABLE.includes(status) ? (
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
