import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@nightshift/ui/components/message-scroller";
import { cn } from "@nightshift/ui/lib/utils";
import {
	CircleCheckIcon,
	CircleStopIcon,
	CircleXIcon,
	ClockIcon,
	LoaderCircleIcon,
} from "lucide-react";
import { memo } from "react";

import { STEP_STATE } from "@/components/outcome-badge";
import type { SessionSummary, StepSummary } from "@/lib/api-types";
import {
	formatCost,
	formatDateTime,
	formatRelative,
	formatTime,
	formatTokens,
} from "@/lib/format";
import type {
	ErrorItem,
	ExitItem,
	FinishedItem,
	LogItem,
	MessageItem,
	ReportItem,
	TranscriptItem,
	TranscriptState,
} from "@/lib/transcript";

import { ToolCallRow } from "./tool-call-row";

/**
 * The transcript of one step. An agent step reads as a conversation: session
 * boundaries with their prompt, messages, tool calls, and the step report. A
 * command step reads as a terminal log.
 */
export function StepTranscript({
	step,
	transcript,
	connecting,
}: {
	step: StepSummary;
	transcript: TranscriptState;
	/** The first replay has not arrived yet. */
	connecting: boolean;
}) {
	const running = step.outcome === null;
	const sessionNumbers = new Map(
		step.sessions.map((session, position) => [session.id, position + 1]),
	);
	const sessionsById = new Map(
		step.sessions.map((session) => [session.id, session]),
	);
	// Sessions the engine knows about but that have no transcript entries yet,
	// for example one that was resumed a moment ago.
	const seen = new Set(
		transcript.items.flatMap((item) =>
			item.kind === "session" ? [item.sessionId] : [],
		),
	);
	const pendingSessions = step.sessions.filter(
		(session) => !seen.has(session.id),
	);
	const isEmpty = transcript.items.length === 0 && pendingSessions.length === 0;

	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller className="min-h-0">
				<MessageScrollerViewport aria-label={`Transcript of ${step.nodeId}`}>
					<MessageScrollerContent
						aria-live="off"
						className="mx-auto w-full max-w-4xl gap-3 px-4 py-4"
					>
						{transcript.items.map((item) => (
							<MessageScrollerItem key={item.key} messageId={item.key}>
								<TranscriptItemView
									item={item}
									running={running}
									session={
										item.sessionId
											? sessionsById.get(item.sessionId)
											: undefined
									}
									sessionNumber={
										item.sessionId
											? sessionNumbers.get(item.sessionId)
											: undefined
									}
								/>
							</MessageScrollerItem>
						))}
						{pendingSessions.map((session) => (
							<MessageScrollerItem
								key={`pending:${session.id}`}
								messageId={`pending:${session.id}`}
							>
								<SessionBoundary
									number={sessionNumbers.get(session.id)}
									at={session.createdAt}
									prompt={session.prompt}
								/>
							</MessageScrollerItem>
						))}
						{isEmpty ? (
							<p className="py-8 text-center text-muted-foreground text-xs">
								{connecting ? "Loading transcript…" : "No transcript yet."}
							</p>
						) : null}
						{step.error ? (
							<div className="flex gap-2 border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive text-sm">
								<CircleXIcon
									className="mt-0.5 size-4 shrink-0"
									aria-hidden="true"
								/>
								<p className="whitespace-pre-wrap break-words text-xs">
									{step.error}
								</p>
							</div>
						) : null}
						{running ? (
							<Marker className="py-1">
								<MarkerIcon>
									<LoaderCircleIcon className="animate-spin text-status-running motion-reduce:animate-none" />
								</MarkerIcon>
								<MarkerContent>
									{step.nodeType === "agent"
										? "The agent is working…"
										: "The command is running…"}
								</MarkerContent>
							</Marker>
						) : null}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

const TranscriptItemView = memo(function TranscriptItemView({
	item,
	running,
	session,
	sessionNumber,
}: {
	item: TranscriptItem;
	running: boolean;
	session: SessionSummary | undefined;
	sessionNumber: number | undefined;
}) {
	switch (item.kind) {
		case "session":
			return (
				<SessionBoundary
					number={sessionNumber}
					at={item.at}
					model={item.model}
					prompt={session?.prompt ?? ""}
				/>
			);
		case "message":
			return <MessageBlock item={item} />;
		case "tool":
			return <ToolCallRow item={item} running={running} />;
		case "report":
			return <ReportCard item={item} />;
		case "finished":
			return <SessionFinished item={item} />;
		case "error":
			return <SessionError item={item} />;
		case "command":
			return (
				<p className="break-words font-mono text-xs">
					<span className="select-none text-muted-foreground">$ </span>
					{item.command}
				</p>
			);
		case "log":
			return <CommandLog item={item} />;
		case "exit":
			return <CommandExit item={item} />;
	}
});

function SessionBoundary({
	number,
	at,
	model,
	prompt,
}: {
	number: number | undefined;
	at: number;
	model?: string;
	prompt: string;
}) {
	const resumed = number !== undefined && number > 1;
	const title = number === undefined ? "Session" : `Session ${number}`;
	const details = [
		resumed ? "resumed" : null,
		formatTime(at),
		model ?? null,
	].filter(Boolean);

	return (
		<div className="flex flex-col gap-2 pt-2">
			<Marker variant="separator">
				<MarkerContent>
					<h3 className="inline font-medium text-foreground">{title}</h3>
					<span title={formatDateTime(at)}> · {details.join(" · ")}</span>
				</MarkerContent>
			</Marker>
			<div className="border-primary/40 border-l-2 bg-muted/40 px-3 py-2">
				<p className="mb-1 text-muted-foreground text-xs">
					{resumed ? "Follow-up prompt" : "Prompt"}
				</p>
				{prompt.trim() === "" ? (
					<p className="text-muted-foreground text-sm italic">
						{resumed ? "Resumed without a new prompt." : "No prompt."}
					</p>
				) : (
					<p className="whitespace-pre-wrap break-words text-sm">{prompt}</p>
				)}
			</div>
		</div>
	);
}

function MessageBlock({ item }: { item: MessageItem }) {
	return (
		<div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
			{item.text}
		</div>
	);
}

/** The agent's step report: the outcome the flow follows, and its summary. */
function ReportCard({ item }: { item: ReportItem }) {
	const { label, icon: Icon, text, color } = STEP_STATE[item.outcome];
	return (
		<div
			className="flex gap-2 border border-l-[3px] bg-card px-3 py-2"
			style={{ borderLeftColor: color }}
		>
			<Icon className={cn("mt-0.5 size-4 shrink-0", text)} aria-hidden="true" />
			<div className="flex min-w-0 flex-col gap-1">
				<p className="text-xs">
					<span className="text-muted-foreground">Step report · </span>
					<span className={cn("font-medium", text)}>{label}</span>
				</p>
				{item.summary.trim() ? (
					<p className="whitespace-pre-wrap break-words text-sm">
						{item.summary}
					</p>
				) : null}
			</div>
		</div>
	);
}

function SessionFinished({ item }: { item: FinishedItem }) {
	const usage = item.usage;
	const parts = ["Session finished"];
	if (usage) {
		parts.push(
			`${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out`,
		);
		if (usage.costUsd !== undefined) parts.push(formatCost(usage.costUsd));
	}
	return (
		<Marker>
			<MarkerIcon>
				<CircleCheckIcon className="text-status-finished" />
			</MarkerIcon>
			<MarkerContent>{parts.join(" · ")}</MarkerContent>
		</Marker>
	);
}

function SessionError({ item }: { item: ErrorItem }) {
	if (item.errorKind === "aborted") {
		return (
			<Marker>
				<MarkerIcon>
					<CircleStopIcon />
				</MarkerIcon>
				<MarkerContent>
					Stopped at {formatTime(item.at)}
					{item.message ? ` · ${item.message}` : null}
				</MarkerContent>
			</Marker>
		);
	}

	const usageLimit = item.errorKind === "usage-limit";
	const Icon = usageLimit ? ClockIcon : CircleXIcon;

	return (
		<div className="flex gap-2 border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive text-sm">
			<Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<div className="flex min-w-0 flex-col gap-1">
				<p className="font-medium">
					{usageLimit ? "Usage limit reached" : "The agent failed"}
				</p>
				<p className="whitespace-pre-wrap break-words text-xs">
					{item.message}
				</p>
				{usageLimit && item.resetAt ? (
					<p className="text-xs">
						Resets{" "}
						<time dateTime={new Date(item.resetAt).toISOString()}>
							{formatDateTime(item.resetAt)}
						</time>{" "}
						({formatRelative(item.resetAt)}). Resume the run after that.
					</p>
				) : null}
			</div>
		</div>
	);
}

function CommandLog({ item }: { item: LogItem }) {
	return (
		<pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words border bg-muted/40 p-2 font-mono text-xs leading-relaxed">
			{item.chunks.map((chunk, index) => (
				<span
					// Chunks only grow at the end, so the index is stable.
					key={index}
					className={chunk.stream === "stderr" ? "text-destructive" : undefined}
				>
					{chunk.text}
				</span>
			))}
		</pre>
	);
}

function CommandExit({ item }: { item: ExitItem }) {
	const passed = item.exitCode === 0;
	return (
		<Marker>
			<MarkerIcon>
				{passed ? (
					<CircleCheckIcon className="text-outcome-pass" />
				) : (
					<CircleXIcon className="text-outcome-fail" />
				)}
			</MarkerIcon>
			<MarkerContent>
				{item.exitCode === null
					? "The command ended without an exit code"
					: `Exited with code ${item.exitCode}`}{" "}
				· {formatTime(item.at)}
			</MarkerContent>
		</Marker>
	);
}
