import { runActions, tokensLabel } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { AlarmClockIcon, SendIcon, SkipForwardIcon } from "lucide-react";
import { WalkerBadge, walkerName } from "@/features/devices";
import type { RunDetail, RunStatus, StepSummary } from "@/shared/api";
import { dayWord, formatTime, hoverTime } from "@/shared/format";
import { CostText } from "./cost-text";
import { useWorkTime } from "./elapsed";
import { RunStatusBadge } from "./run-status-badge";

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
	const tokens = tokensLabel(run.metrics?.tokens);

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
						title={`No new step starts after ${hoverTime(run.stopAt)}.`}
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
				{tokens ? (
					<>
						{tokens}
						<span aria-hidden="true"> · </span>
					</>
				) : null}
				<span className="sr-only">cost </span>
				<CostText cost={run} />
			</p>
		</div>
	);
}
