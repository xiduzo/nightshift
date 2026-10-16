import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	CircleAlertIcon,
	CircleStopIcon,
	CircleXIcon,
	HandIcon,
	InboxIcon,
	type LucideIcon,
	MoonIcon,
	SunriseIcon,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";

import { useNow } from "@/hooks/use-now";
import type { RunDetail, RunStatus, StepSummary } from "@/lib/api-types";
import { formatCountdown, formatDateTime, formatTime } from "@/lib/format";
import type { CurrentWait } from "@/lib/transcript";
import { orpc } from "@/utils/orpc";

import { ResumeComposer } from "./resume-composer";

const SLEEP_REASON = {
	"usage-limit": "The agent hit its usage limit.",
	network: "The network is down.",
} as const;

type Notice = {
	icon: LucideIcon;
	/** Text colour of the icon and title. */
	tone: string;
	title: ReactNode;
	/** One line, shown in the header while the panel is closed. */
	gist: string;
	body: ReactNode;
	/** Buttons under the body. */
	actions?: ReactNode;
	/** Whether the panel ends in the composer that resumes the run. */
	resumable?: boolean;
};

/**
 * What the run needs from you, under the flow like the flow editor's issues:
 * why it failed or stopped (with the composer that resumes it), the gate it
 * waits at, or why it sleeps. A Collapsible whose header always shows what
 * happened. Nothing shows while the run walks or once it finished.
 */
export function RunStatusPanel({
	run,
	status,
	openGateNodeId,
	onShowGate,
	wait,
	lastStep,
	className,
}: {
	run: RunDetail;
	status: RunStatus;
	openGateNodeId: string | null;
	onShowGate: () => void;
	wait: CurrentWait | null;
	/** Where resuming continues. */
	lastStep: StepSummary | undefined;
	className?: string;
}) {
	const id = useId();
	const [open, setOpen] = useState(true);
	const until = run.wakeAt ?? wait?.until ?? null;
	const notice = noticeOf({ run, status, openGateNodeId, onShowGate, wait });
	if (!notice) return null;
	const Icon = notice.icon;

	return (
		<Card size="sm" className={cn("shrink-0 gap-0 py-0", className)}>
			<Collapsible
				open={open}
				onOpenChange={setOpen}
				render={<section aria-labelledby={`${id}-heading`} />}
			>
				<h2 id={`${id}-heading`}>
					<CollapsibleTrigger
						render={
							<Button
								variant="ghost"
								className="group/status h-11 w-full justify-start gap-2 rounded-none px-3"
							/>
						}
					>
						<ChevronRightIcon
							className="size-3.5 text-muted-foreground transition-transform group-data-panel-open/status:rotate-90 motion-reduce:transition-none"
							aria-hidden="true"
						/>
						<Icon className={cn("size-4", notice.tone)} aria-hidden="true" />
						<span className={cn("font-medium text-sm", notice.tone)}>
							{notice.title}
						</span>
						{status === "sleeping" && until ? (
							<Countdown until={until} className={notice.tone} />
						) : null}
						{open ? null : (
							<span className="min-w-0 truncate font-normal text-muted-foreground text-xs">
								{notice.gist}
							</span>
						)}
					</CollapsibleTrigger>
				</h2>
				<CollapsibleContent className="flex flex-col gap-3 border-t p-3">
					<ScrollArea className="max-h-32 [&>[data-slot=scroll-area-viewport]]:max-h-32">
						<div className="whitespace-pre-wrap break-words text-muted-foreground text-sm leading-relaxed">
							{notice.body}
						</div>
					</ScrollArea>
					{notice.actions ? (
						<div className="flex flex-wrap gap-2">{notice.actions}</div>
					) : null}
					{notice.resumable ? (
						<ResumeComposer runId={run.id} lastStep={lastStep} />
					) : null}
				</CollapsibleContent>
			</Collapsible>
		</Card>
	);
}

function noticeOf({
	run,
	status,
	openGateNodeId,
	onShowGate,
	wait,
}: {
	run: RunDetail;
	status: RunStatus;
	openGateNodeId: string | null;
	onShowGate: () => void;
	wait: CurrentWait | null;
}): Notice | null {
	switch (status) {
		case "waiting":
			return openGateNodeId
				? {
						icon: HandIcon,
						tone: "text-status-waiting",
						title: "Waiting for your answer",
						gist: `At the gate ${openGateNodeId}`,
						body: (
							<>
								The run waits at the gate{" "}
								<span className="font-mono text-foreground">
									{openGateNodeId}
								</span>{" "}
								until someone answers it.
							</>
						),
						actions: (
							<>
								<Button size="sm" onClick={onShowGate}>
									<HandIcon data-icon="inline-start" />
									Answer it
								</Button>
								<Button
									size="sm"
									variant="outline"
									render={<Link to="/inbox" />}
								>
									<InboxIcon data-icon="inline-start" />
									Open the inbox
								</Button>
							</>
						),
					}
				: null;
		case "sleeping": {
			const until = run.wakeAt ?? wait?.until ?? null;
			const reason = wait ? SLEEP_REASON[wait.reason] : "The run sleeps.";
			return {
				icon: MoonIcon,
				tone: "text-status-sleeping",
				title: "Sleeping",
				gist: reason,
				body: (
					<>
						{reason} It continues where it left off
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
						.{wait?.message ? `\n${wait.message}` : null}
					</>
				),
				actions: <WakeButton runId={run.id} />,
			};
		}
		case "failed":
			return {
				icon: CircleXIcon,
				tone: "text-destructive",
				title: "The run failed",
				gist: firstLine(run.reason) ?? "Resume it to continue.",
				body: run.reason ?? "The run failed. Resume it to continue.",
				resumable: true,
			};
		case "interrupted":
			return {
				icon: CircleAlertIcon,
				tone: "text-status-interrupted",
				title: "The run was interrupted",
				gist:
					firstLine(run.reason) ??
					"Night Shift stopped while this run was going.",
				body: `${run.reason ?? "Night Shift stopped while this run was going."} Resume it to continue where it left off.`,
				resumable: true,
			};
		case "stopped":
			return {
				icon: CircleStopIcon,
				tone: "text-status-stopped",
				title: "The run stopped",
				gist: firstLine(run.reason) ?? "Resume it to continue.",
				body:
					run.reason ??
					"The run stopped before its end. Resume it to continue where it left off.",
				resumable: true,
			};
		default:
			return null;
	}
}

function firstLine(text: string | null | undefined): string | undefined {
	return text
		?.split("\n")
		.find((line) => line.trim())
		?.trim();
}

/** How long until the run wakes, ticking. */
function Countdown({
	until,
	className,
}: {
	until: number;
	className?: string;
}) {
	const now = useNow(1000);
	return (
		<span
			className={cn("font-mono text-sm tabular-nums", className)}
			role="timer"
			aria-live="off"
		>
			{formatCountdown(until - now)}
		</span>
	);
}

/** Wakes a sleeping run now instead of at its wake time. */
function WakeButton({ runId }: { runId: string }) {
	const queryClient = useQueryClient();
	const wake = useMutation(
		orpc.runs.resume.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.runs.key() }),
			onError: (error) => toast.error(`Could not wake: ${error.message}`),
		}),
	);
	return (
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
	);
}
