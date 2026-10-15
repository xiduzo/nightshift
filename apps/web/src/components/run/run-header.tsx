import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	AlarmClockIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleStopIcon,
	CircleXIcon,
	ClipboardCopyIcon,
	HandIcon,
	MoonIcon,
	SkipForwardIcon,
	SunriseIcon,
} from "lucide-react";
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
	const queryClient = useQueryClient();
	const projects = useQuery(orpc.projects.list.queryOptions());
	const project = projects.data?.find((p) => p.id === run.projectId);

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

	const details: [string, string, boolean][] = [
		["Flow", run.flowName ?? "Quick run", run.flowName !== null],
		["Branch", run.branch, true],
		["Base", run.baseRef, true],
		["Cost", formatCost(run.costUsd), false],
		["Started", formatDateTime(run.createdAt), false],
	];
	const stoppable = STOPPABLE.includes(status);

	return (
		<header className="flex flex-col gap-2 border-b px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<nav
					aria-label="Breadcrumb"
					className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs"
				>
					<Link
						to="/projects/$projectId"
						params={{ projectId: run.projectId }}
						className="truncate outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
					>
						{project?.name ?? "Project"}
					</Link>
					<ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
					{run.flowName ? (
						<>
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId: run.projectId, name: run.flowName }}
								className="truncate font-mono outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
							>
								{run.flowName}
							</Link>
							<ChevronRightIcon
								className="size-3 shrink-0"
								aria-hidden="true"
							/>
						</>
					) : null}
					<span>Run</span>
				</nav>
				<div aria-live="polite" className="flex items-center gap-2">
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
						<span className="text-muted-foreground text-xs">
							Reconnecting to the live transcript…
						</span>
					) : null}
				</div>
				<div className="ml-auto flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={takeOver}
						disabled={!run.takeOverCommand}
						title={run.takeOverCommand ?? "No agent session to take over yet."}
					>
						<ClipboardCopyIcon data-icon="inline-start" />
						Take over
					</Button>
					{stoppable ? (
						<StopMenu
							runId={run.id}
							status={status}
							stopAfterStep={run.stopAfterStep}
							pending={stopRun.isPending}
							onStop={(when) => stopRun.mutate({ runId: run.id, when })}
						/>
					) : null}
				</div>
			</div>
			<h1 className="line-clamp-2 whitespace-pre-wrap break-words font-medium text-sm">
				{run.title}
			</h1>
			{status === "waiting" && openGateNodeId ? (
				<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border border-status-waiting/50 bg-status-waiting/10 px-2 py-1.5 text-xs">
					<HandIcon
						className="size-3.5 shrink-0 text-status-waiting"
						aria-hidden="true"
					/>
					<span>
						The run waits at the gate{" "}
						<span className="font-mono">{openGateNodeId}</span> for your answer.
					</span>
					<button
						type="button"
						onClick={onShowGate}
						className="font-medium text-status-waiting underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
					>
						Answer it
					</button>
					<span className="text-muted-foreground">or</span>
					<Link
						to="/inbox"
						className="font-medium text-status-waiting underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
					>
						open the inbox
					</Link>
				</p>
			) : null}
			{status === "sleeping" ? (
				<SleepBanner runId={run.id} wakeAt={run.wakeAt} wait={wait} />
			) : null}
			{status === "failed" && run.reason ? (
				<p
					role="alert"
					className="flex items-start gap-1.5 border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-destructive text-xs"
				>
					<CircleXIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
					<span className="whitespace-pre-wrap break-words">{run.reason}</span>
				</p>
			) : null}
			<dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
				{details.map(([label, value, mono]) => (
					<div key={label} className="flex min-w-0 gap-1">
						<dt className="text-muted-foreground">{label}</dt>
						<dd className={mono ? "truncate font-mono" : "truncate"}>
							{value}
						</dd>
					</div>
				))}
				{run.stopAt ? (
					<div className="flex min-w-0 gap-1">
						<dt className="text-muted-foreground">Stop time</dt>
						<dd className="truncate">
							<time dateTime={new Date(run.stopAt).toISOString()}>
								{formatDayTime(run.stopAt)}
							</time>
						</dd>
					</div>
				) : null}
				<div className="flex min-w-0 basis-full gap-1">
					<dt className="text-muted-foreground">Worktree</dt>
					<dd className="truncate font-mono" title={run.worktreePath}>
						{run.worktreePath}
					</dd>
				</div>
			</dl>
		</header>
	);
}

/** Stop now, or let the running step finish first. */
function StopMenu({
	runId,
	status,
	stopAfterStep,
	pending,
	onStop,
}: {
	runId: string;
	status: RunStatus;
	stopAfterStep: boolean;
	pending: boolean;
	onStop: (when: "now" | "after-step") => void;
}) {
	return (
		<div className="flex" key={runId}>
			<Button
				variant="destructive"
				size="sm"
				onClick={() => onStop("now")}
				disabled={pending}
				title={
					status === "waiting"
						? "Close the gate without an answer and stop the run"
						: status === "sleeping"
							? "End the sleep and stop the run"
							: "Abort the running step and stop the run"
				}
			>
				<CircleStopIcon data-icon="inline-start" />
				{pending ? "Stopping…" : "Stop now"}
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="destructive"
							size="icon-sm"
							className="border-l border-l-destructive/30"
							aria-label="More ways to stop"
							disabled={pending}
						/>
					}
				>
					<ChevronDownIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-64">
					<DropdownMenuItem variant="destructive" onClick={() => onStop("now")}>
						<CircleStopIcon />
						<span className="flex flex-col">
							Stop now
							<span className="text-muted-foreground">
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
							<span className="text-muted-foreground">
								{stopAfterStep
									? "Already asked."
									: "The running step finishes; no new one starts."}
							</span>
						</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
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
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-status-sleeping/50 bg-status-sleeping/10 px-2 py-1.5 text-xs">
			<MoonIcon
				className="size-3.5 shrink-0 text-status-sleeping"
				aria-hidden="true"
			/>
			<span>
				{wait ? SLEEP_REASON[wait.reason] : "The run sleeps."} It continues the
				same session
				{until ? (
					<>
						{" "}
						at{" "}
						<time
							dateTime={new Date(until).toISOString()}
							title={formatDateTime(until)}
							className="font-medium"
						>
							{formatTime(until)}
						</time>
						, in{" "}
						<span
							className="font-medium font-mono text-status-sleeping tabular-nums"
							role="timer"
							aria-live="off"
						>
							{formatCountdown(until - now)}
						</span>
					</>
				) : null}
				.
			</span>
			<Button
				variant="outline"
				size="xs"
				className="ml-auto"
				disabled={wake.isPending}
				onClick={() => wake.mutate({ runId })}
			>
				<SunriseIcon data-icon="inline-start" />
				{wake.isPending ? "Waking…" : "Wake now"}
			</Button>
			{wait?.message ? (
				<span
					className="min-w-0 basis-full truncate text-muted-foreground"
					title={wait.message}
				>
					{wait.message}
				</span>
			) : null}
		</div>
	);
}
