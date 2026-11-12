import {
	type NoticeAction,
	type NoticeKind,
	type NoticePart,
	type RunNow,
	useRunActed,
} from "@nightshift/client";
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
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	CircleAlertIcon,
	CircleDashedIcon,
	CircleStopIcon,
	CircleXIcon,
	FileTextIcon,
	FlagIcon,
	HandIcon,
	InboxIcon,
	type LucideIcon,
	MoonIcon,
	RadioIcon,
	SendIcon,
	SunriseIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import type { RunDetail, StepSummary } from "@/shared/api";
import { orpc } from "@/shared/api";
import { formatCountdown, formatTime, useNow } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { runMutations } from "../queries";
import { ResumeComposer } from "./resume-composer";

/** The icon and colour of each notice. */
const LOOK: Record<NoticeKind, { icon: LucideIcon; tone: string }> = {
	"answer-sent": { icon: SendIcon, tone: "text-status-waiting" },
	gate: { icon: HandIcon, tone: "text-status-waiting" },
	signal: { icon: RadioIcon, tone: "text-status-sleeping" },
	wait: { icon: MoonIcon, tone: "text-status-sleeping" },
	sleep: { icon: MoonIcon, tone: "text-status-sleeping" },
	done: { icon: FlagIcon, tone: "text-status-finished" },
	"nothing-to-do": { icon: CircleDashedIcon, tone: "text-muted-foreground" },
	"ended-failed": { icon: FlagIcon, tone: "text-destructive" },
	failed: { icon: CircleXIcon, tone: "text-destructive" },
	interrupted: { icon: CircleAlertIcon, tone: "text-status-interrupted" },
	stopped: { icon: CircleStopIcon, tone: "text-status-stopped" },
};

/**
 * What the run needs from you, under the flow like the flow editor's issues:
 * why it failed or stopped (with the composer that resumes it), the gate it
 * waits at, or why it sleeps, or the line an End node left and its report.
 * A Collapsible whose header always shows what happened. Nothing shows
 * while the run walks, or once it finished without a word or a report
 * from an End node. The words come from `runNow`: this draws them.
 */
export function RunStatusPanel({
	run,
	now,
	onShowGate,
	onShowReport,
	lastStep,
	askWhy,
	agentAnswer,
	className,
}: {
	run: RunDetail;
	now: RunNow;
	onShowGate: () => void;
	/** Scrolls to the run's report. Unset: the run has none. */
	onShowReport?: () => void;
	/** Where resuming continues. */
	lastStep: StepSummary | undefined;
	/** "Ask an agent" and "Improve the flow", beside the reason the run ended. */
	askWhy?: ReactNode;
	/** The answer of "Ask an agent", below the buttons. */
	agentAnswer?: ReactNode;
	className?: string;
}) {
	const id = useId();
	const [open, setOpen] = useState(true);
	const notice = now.notice;
	if (!notice) return null;
	const { icon: Icon, tone } = LOOK[notice.kind];
	// The button of each action a notice can offer. Only those it offers show.
	const button: Record<NoticeAction, ReactNode> = {
		answer: (
			<Button size="sm" onClick={onShowGate}>
				<HandIcon data-icon="inline-start" />
				Answer it
			</Button>
		),
		"open-inbox": (
			<Button
				size="sm"
				variant="outline"
				nativeButton={false}
				render={<Link to="/inbox" />}
			>
				<InboxIcon data-icon="inline-start" />
				Open the inbox
			</Button>
		),
		"send-signal":
			notice.signal !== null ? (
				<SignalButton runId={run.id} name={notice.signal} />
			) : null,
		wake: <WakeButton runId={run.id} />,
		"read-report": onShowReport ? (
			<Button size="sm" variant="outline" onClick={onShowReport}>
				<FileTextIcon data-icon="inline-start" />
				Read the report
			</Button>
		) : null,
	};
	const buttons = notice.actions.map((action) => (
		<Fragment key={action}>{button[action]}</Fragment>
	));

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
						<Icon className={cn("size-4", tone)} aria-hidden="true" />
						<span className={cn("font-medium text-sm", tone)}>
							<Parts parts={notice.title} code="font-mono" />
						</span>
						{notice.wakeAt ? (
							<Countdown until={notice.wakeAt} className={tone} />
						) : null}
						{open ? null : (
							<span className="min-w-0 truncate font-normal text-muted-foreground text-xs">
								{notice.gist}
							</span>
						)}
					</CollapsibleTrigger>
				</h2>
				<CollapsibleContent className="flex flex-col gap-3 border-t p-3">
					{notice.body.length > 0 ? (
						<ScrollArea className="max-h-32 [&>[data-slot=scroll-area-viewport]]:max-h-32">
							<div className="whitespace-pre-wrap break-words text-muted-foreground text-sm leading-relaxed">
								<Parts parts={notice.body} code="font-mono text-foreground" />
							</div>
						</ScrollArea>
					) : null}
					{notice.actions.length > 0 || askWhy ? (
						<div className="flex flex-wrap gap-2">
							{buttons}
							{askWhy}
						</div>
					) : null}
					{agentAnswer}
					{notice.resumable ? (
						<ResumeComposer runId={run.id} lastStep={lastStep} />
					) : null}
				</CollapsibleContent>
			</Collapsible>
		</Card>
	);
}

/** A notice's words: a name from the flow in code type, a time of day on the reader's clock. */
function Parts({ parts, code }: { parts: NoticePart[]; code: string }) {
	return parts.map((part, index) => (
		<Fragment key={index}>
			{typeof part === "string" ? (
				part
			) : "code" in part ? (
				<span className={code}>{part.code}</span>
			) : (
				<LocalTime
					at={part.time}
					className="font-medium text-foreground tabular-nums"
				>
					{formatTime(part.time)}
				</LocalTime>
			)}
		</Fragment>
	));
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

/** Sends the signal a run waits for, so its Wait step ends. */
function SignalButton({ runId, name }: { runId: string; name: string }) {
	const runActed = useRunActed({ orpc });
	const send = useMutation(
		runMutations.signal({
			onSuccess: () => {
				toast.success(`Sent ${name}. The flow continues.`);
				runActed(runId);
			},
			onError: (error) => toast.error(`Could not send: ${error.message}`),
		}),
	);
	return (
		<Button
			size="sm"
			disabled={send.isPending}
			onClick={() => send.mutate({ runId, name })}
		>
			{send.isPending ? (
				<Spinner data-icon="inline-start" />
			) : (
				<SendIcon data-icon="inline-start" />
			)}
			{send.isPending ? "Sending…" : "Send signal"}
		</Button>
	);
}

/** Wakes a sleeping run now instead of at its wake time. */
function WakeButton({ runId }: { runId: string }) {
	const runActed = useRunActed({ orpc });
	const wake = useMutation(
		runMutations.resume({
			onSuccess: () => runActed(runId),
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
