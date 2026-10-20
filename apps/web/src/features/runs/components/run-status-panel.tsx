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
	RadioIcon,
	SendIcon,
	SunriseIcon,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { walkerName } from "@/features/devices";
import type { RunDetail, RunStatus, StepSummary } from "@/shared/api";
import {
	formatCountdown,
	formatDateTime,
	formatTime,
	useNow,
} from "@/shared/format";
import { runMutations, runQueries } from "../queries";
import type { CurrentWait } from "../transcript/transcript";
import { ResumeComposer } from "./resume-composer";

const SLEEP_REASON: Record<CurrentWait["reason"], string> = {
	"usage-limit": "The agent hit its usage limit.",
	network: "The network is down.",
	duration: "The flow waits a while.",
	time: "The flow waits for a time.",
	command: "The flow waits for a command to pass.",
	signal: "The flow waits for a signal.",
	"device-offline": "The device of the next step is offline.",
};

/** A Wait node's own wait, not the run policy's. */
const isNodeWait = (reason: CurrentWait["reason"]) =>
	reason !== "usage-limit" &&
	reason !== "network" &&
	reason !== "device-offline";

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
	// A run of another device: answers, signals and stops go to it; only it resumes.
	const elsewhere = run.walker.thisDevice ? null : walkerName(run.walker);
	const resumeHere = elsewhere
		? `Only ${elsewhere} can resume it.`
		: "Resume it to continue.";
	switch (status) {
		case "waiting":
			if (
				openGateNodeId &&
				elsewhere &&
				run.commands.some((c) => c.kind === "gate.resolve")
			) {
				return {
					icon: SendIcon,
					tone: "text-status-waiting",
					title: "Answer sent",
					gist: `It applies when ${elsewhere} is online.`,
					body: `Your answer is on its way to ${elsewhere}. The run goes on when ${elsewhere} is online.`,
				};
			}
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
			const signal = run.signal ?? wait?.signal ?? null;
			const reason = wait ? SLEEP_REASON[wait.reason] : "The run sleeps.";
			const at = until ? (
				<time
					dateTime={new Date(until).toISOString()}
					title={formatDateTime(until)}
					className="font-medium text-foreground tabular-nums"
				>
					{formatTime(until)}
				</time>
			) : null;
			if (signal !== null) {
				return {
					icon: RadioIcon,
					tone: "text-status-sleeping",
					title: (
						<>
							Waiting for signal <span className="font-mono">{signal}</span>
						</>
					),
					gist: `Send ${signal} to go on.`,
					body: (
						<>
							The flow goes on when the run gets the signal{" "}
							<span className="font-mono text-foreground">{signal}</span>
							{at ? <>, or times out at {at}</> : null}. Send it here, or from
							another system through the API.
						</>
					),
					actions: <SignalButton runId={run.id} name={signal} />,
				};
			}
			const nodeWait = wait ? isNodeWait(wait.reason) : false;
			return {
				icon: MoonIcon,
				tone: "text-status-sleeping",
				title: nodeWait ? "Waiting" : "Sleeping",
				gist: reason,
				body: (
					<>
						{reason}{" "}
						{wait?.reason === "command"
							? "It tries the command again"
							: wait?.reason === "device-offline"
								? "It starts when the device is back, and looks again"
								: nodeWait
									? "It goes on"
									: "It continues where it left off"}
						{at ? <> at {at}</> : null}.
						{wait?.message ? `\n${wait.message}` : null}
					</>
				),
				actions: elsewhere ? undefined : <WakeButton runId={run.id} />,
			};
		}
		case "failed":
			return {
				icon: CircleXIcon,
				tone: "text-destructive",
				title: "The run failed",
				gist: firstLine(run.reason) ?? resumeHere,
				body: run.reason ?? `The run failed. ${resumeHere}`,
				resumable: !elsewhere,
			};
		case "interrupted":
			return {
				icon: CircleAlertIcon,
				tone: "text-status-interrupted",
				title: "The run was interrupted",
				gist:
					firstLine(run.reason) ??
					"Night Shift stopped while this run was going.",
				body: `${run.reason ?? "Night Shift stopped while this run was going."} ${elsewhere ? resumeHere : "Resume it to continue where it left off."}`,
				resumable: !elsewhere,
			};
		case "stopped":
			return {
				icon: CircleStopIcon,
				tone: "text-status-stopped",
				title: "The run stopped",
				gist: firstLine(run.reason) ?? resumeHere,
				body:
					run.reason ??
					`The run stopped before its end. ${elsewhere ? resumeHere : "Resume it to continue where it left off."}`,
				resumable: !elsewhere,
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

/** Sends the signal a run waits for, so its Wait step ends. */
function SignalButton({ runId, name }: { runId: string; name: string }) {
	const queryClient = useQueryClient();
	const send = useMutation(
		runMutations.signal({
			onSuccess: () => {
				toast.success(`Sent ${name}. The flow goes on.`);
				void queryClient.invalidateQueries({ queryKey: runQueries.all() });
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
	const queryClient = useQueryClient();
	const wake = useMutation(
		runMutations.resume({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: runQueries.all() }),
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
