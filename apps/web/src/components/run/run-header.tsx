import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
	Card,
	CardContent,
	CardDescription,
	CardHeader,
} from "@nightshift/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
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
	CircleAlertIcon,
	CircleStopIcon,
	CircleXIcon,
	ClipboardCopyIcon,
	CopyIcon,
	HandIcon,
	InboxIcon,
	MoonIcon,
	SkipForwardIcon,
	SunriseIcon,
	WorkflowIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/run-status-badge";
import { useNow } from "@/hooks/use-now";
import type { RunDetail, RunStatus } from "@/lib/api-types";
import {
	dayWord,
	formatCost,
	formatCountdown,
	formatDateTime,
	formatDayTime,
	formatTime,
} from "@/lib/format";
import type { CurrentWait } from "@/lib/transcript";
import { orpc } from "@/utils/orpc";

const STOPPABLE: RunStatus[] = ["running", "waiting", "sleeping"];

/** A git object id: shown short, with the full id in a tooltip. */
const SHA = /^[0-9a-f]{40}$/i;

/**
 * The run's title, status and facts in a card, and below it an alert for a
 * state that needs attention: an open gate, a sleep, a failure, an interruption.
 */
export function RunHeader({
	run,
	status,
	reconnecting,
	openGateNodeId,
	onShowGate,
	wait,
}: {
	run: RunDetail;
	status: RunStatus;
	reconnecting: boolean;
	/** The latest wait of the run policy without a wake after it. */
	wait: CurrentWait | null;
	/** The node of the Gate the run waits at, if any. */
	openGateNodeId: string | null;
	/** Selects the open Gate's step, so its answer form shows. */
	onShowGate: () => void;
}) {
	const stoppable = STOPPABLE.includes(status);
	const inputEntries = Object.entries(run.inputs ?? {}).map(
		([name, value]) =>
			[
				name,
				typeof value === "string" ? value : JSON.stringify(value),
			] as const,
	);

	return (
		<section aria-label="About this run" className="flex flex-col gap-3">
			<Card size="sm" className="gap-4">
				<CardHeader className="gap-2">
					<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
						<h1 className="line-clamp-2 min-w-0 whitespace-pre-wrap break-words font-semibold text-xl tracking-tight">
							{run.title}
						</h1>
						<div
							aria-live="polite"
							className="flex flex-wrap items-center gap-2"
						>
							<RunStatusBadge status={status} />
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
									Reconnecting to the live transcript…
								</span>
							) : null}
						</div>
					</div>
					<CardDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
						<WorkflowIcon className="size-3.5 shrink-0" aria-hidden="true" />
						{run.flowName ? (
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId: run.projectId, name: run.flowName }}
								className="rounded-sm font-medium font-mono text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
							>
								{run.flowName}
							</Link>
						) : (
							<span>Quick run</span>
						)}
						{inputEntries.map(([name, value]) => (
							<Badge
								key={name}
								variant="secondary"
								className="max-w-full font-mono font-normal"
								title={`${name}: ${value}`}
							>
								<span className="text-muted-foreground">{name}</span>
								<span className="truncate">{value}</span>
							</Badge>
						))}
						<span aria-hidden="true">·</span>
						<span>
							{run.trigger.kind === "schedule"
								? `Scheduled · ${run.trigger.scheduleId}`
								: "Started by hand"}
						</span>
					</CardDescription>
				</CardHeader>
				<CardContent>
					<dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
						<Fact
							label="Branch"
							className="col-span-2 sm:col-span-1 xl:col-span-2"
						>
							<CopyValue label="branch" value={run.branch} />
						</Fact>
						<Fact label="Base">
							<CopyValue
								label="base ref"
								value={run.baseRef}
								short={
									SHA.test(run.baseRef) ? run.baseRef.slice(0, 12) : undefined
								}
							/>
						</Fact>
						<Fact label="Cost">
							<span className="font-medium tabular-nums">
								{formatCost(run.costUsd)}
							</span>
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
						<Fact
							label="Worktree"
							className="col-span-2 sm:col-span-3 xl:col-span-6"
						>
							<CopyValue label="worktree path" value={run.worktreePath} />
						</Fact>
					</dl>
				</CardContent>
			</Card>
			{status === "waiting" && openGateNodeId ? (
				<Alert
					role="status"
					className="border-status-waiting/40 bg-status-waiting/10"
				>
					<HandIcon aria-hidden="true" className="text-status-waiting!" />
					<AlertTitle className="text-status-waiting">
						Waiting for your answer
					</AlertTitle>
					<AlertDescription>
						The run waits at the gate{" "}
						<span className="font-mono text-foreground">{openGateNodeId}</span>{" "}
						until someone answers it.
					</AlertDescription>
					<div className="col-start-2 mt-2 flex flex-wrap gap-2">
						<Button size="sm" onClick={onShowGate}>
							<HandIcon data-icon="inline-start" />
							Answer it
						</Button>
						<Button size="sm" variant="outline" render={<Link to="/inbox" />}>
							<InboxIcon data-icon="inline-start" />
							Open the inbox
						</Button>
					</div>
				</Alert>
			) : null}
			{status === "sleeping" ? (
				<SleepBanner runId={run.id} wakeAt={run.wakeAt} wait={wait} />
			) : null}
			{status === "failed" && run.reason ? (
				<Alert
					variant="destructive"
					className="border-destructive/40 bg-destructive/10"
				>
					<CircleXIcon aria-hidden="true" />
					<AlertTitle>The run failed</AlertTitle>
					<AlertDescription className="whitespace-pre-wrap break-words">
						{run.reason}
					</AlertDescription>
				</Alert>
			) : null}
			{status === "interrupted" ? (
				<Alert
					role="status"
					className="border-status-interrupted/40 bg-status-interrupted/10"
				>
					<CircleAlertIcon
						aria-hidden="true"
						className="text-status-interrupted!"
					/>
					<AlertTitle className="text-status-interrupted">
						The run was interrupted
					</AlertTitle>
					<AlertDescription className="whitespace-pre-wrap break-words">
						{run.reason ?? "The daemon stopped while this run ran."} Resume it
						to continue in the same worktree.
					</AlertDescription>
				</Alert>
			) : null}
		</section>
	);
}

/** One fact of the run: a small muted label above its value. */
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

/** The run's actions for the page header: take over the session, and stop. */
export function RunActions({
	run,
	status,
}: {
	run: RunDetail;
	status: RunStatus;
}) {
	const queryClient = useQueryClient();
	const stopRun = useMutation(
		orpc.runs.stop.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.runs.key() }),
			onError: (error) => toast.error(`Could not stop: ${error.message}`),
		}),
	);

	const takeOver = async () => {
		if (!run.takeOverCommand) return;
		try {
			await navigator.clipboard.writeText(run.takeOverCommand);
			toast.success("Command copied. Paste it in a terminal to take over.");
		} catch {
			toast.error("Could not copy. Copy the command from the tooltip.");
		}
	};

	return (
		<>
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
			{STOPPABLE.includes(status) ? (
				<StopMenu
					key={run.id}
					status={status}
					stopAfterStep={run.stopAfterStep}
					pending={stopRun.isPending}
					onStop={(when) => stopRun.mutate({ runId: run.id, when })}
				/>
			) : null}
		</>
	);
}

const STOP_NOW_TEXT: Partial<Record<RunStatus, string>> = {
	waiting: "This closes the open gate without an answer and stops the run.",
	sleeping: "This ends the sleep and stops the run.",
	running: "This aborts the running step and stops the run.",
};

/** Stop now (after a confirmation), or let the running step finish first. */
function StopMenu({
	status,
	stopAfterStep,
	pending,
	onStop,
}: {
	status: RunStatus;
	stopAfterStep: boolean;
	pending: boolean;
	onStop: (when: "now" | "after-step") => void;
}) {
	const [confirming, setConfirming] = useState(false);
	return (
		<>
			<ButtonGroup>
				<Button
					variant="destructive"
					size="sm"
					onClick={() => setConfirming(true)}
					disabled={pending}
				>
					{pending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<CircleStopIcon data-icon="inline-start" />
					)}
					{pending ? "Stopping…" : "Stop"}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="destructive"
								size="icon-sm"
								className="border-l-destructive/30"
								aria-label="More ways to stop"
								disabled={pending}
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
									Aborts the running step.
								</span>
							</span>
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={stopAfterStep}
							onClick={() => onStop("after-step")}
						>
							<SkipForwardIcon />
							<span className="flex flex-col">
								Stop after this step
								<span className="text-muted-foreground text-xs">
									{stopAfterStep
										? "Already asked."
										: "The running step finishes; no new one starts."}
								</span>
							</span>
						</DropdownMenuItem>
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
							later in the same worktree.
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

const SLEEP_REASON = {
	"usage-limit": "The harness hit a usage limit.",
	network: "The network is down.",
} as const;

/** Why the run sleeps, a live countdown to when it wakes, and a way to wake it now. */
function SleepBanner({
	runId,
	wakeAt,
	wait,
}: {
	runId: string;
	wakeAt: number | null;
	wait: CurrentWait | null;
}) {
	const now = useNow(1000);
	const queryClient = useQueryClient();
	const wake = useMutation(
		orpc.runs.resume.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.runs.key() }),
			onError: (error) => toast.error(`Could not wake: ${error.message}`),
		}),
	);
	const until = wakeAt ?? wait?.until ?? null;

	return (
		<Alert
			role="status"
			className="border-status-sleeping/40 bg-status-sleeping/10"
		>
			<MoonIcon aria-hidden="true" className="text-status-sleeping!" />
			<AlertTitle className="flex flex-wrap items-center gap-x-2 text-status-sleeping">
				Sleeping
				{until ? (
					<span className="font-mono tabular-nums" role="timer" aria-live="off">
						{formatCountdown(until - now)}
					</span>
				) : null}
			</AlertTitle>
			<AlertDescription className="flex flex-col gap-1">
				<p>
					{wait ? SLEEP_REASON[wait.reason] : "The run sleeps."} It continues
					the same session
					{until ? (
						<>
							{" "}
							at{" "}
							<time
								dateTime={new Date(until).toISOString()}
								title={formatDateTime(until)}
								className="font-medium text-foreground tabular-nums"
							>
								{formatTime(until)}
							</time>
						</>
					) : null}
					.
				</p>
				{wait?.message ? (
					<p className="truncate" title={wait.message}>
						{wait.message}
					</p>
				) : null}
			</AlertDescription>
			<div className="col-start-2 mt-2">
				<Button
					variant="outline"
					size="sm"
					disabled={wake.isPending}
					onClick={() => wake.mutate({ runId })}
				>
					{wake.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<SunriseIcon data-icon="inline-start" />
					)}
					{wake.isPending ? "Waking…" : "Wake now"}
				</Button>
			</div>
		</Alert>
	);
}
