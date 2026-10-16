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
	GitBranchIcon,
	HandIcon,
	ListChecksIcon,
	LoaderCircleIcon,
	MoonIcon,
	SplitIcon,
	SunriseIcon,
} from "lucide-react";
import { memo, type ReactNode } from "react";

import { GateAnswer } from "@/components/gate/gate-answer";
import {
	ItemStateBadge,
	itemStateStyle,
	outcomeLabel,
	outcomeStyle,
	stepStateStyle,
} from "@/components/outcome-badge";
import { JsonBlock } from "@/components/run/json-block";
import type { SessionSummary, StepSummary } from "@/lib/api-types";
import {
	formatCost,
	formatDateTime,
	formatRelative,
	formatTime,
	formatTokens,
} from "@/lib/format";
import type {
	DecisionAskItem,
	DecisionItem,
	ErrorItem,
	ExitItem,
	FinishedItem,
	GateOpenItem,
	GateResolvedItem,
	ItemEndItem,
	ItemStartItem,
	ItemsReadItem,
	LogItem,
	MessageItem,
	ReportItem,
	TranscriptItem,
	TranscriptState,
	WaitItem,
	WakeItem,
} from "@/lib/transcript";

import { ToolCallRow } from "./tool-call-row";

/**
 * The transcript of one step. An agent step reads as a conversation: session
 * boundaries with their prompt, messages, tool calls, and the step report. A
 * command step reads as a terminal log. A decision step shows what the decider
 * was asked and what it picked. A gate step shows its question, and while it
 * is open, the choices to answer it with.
 */
export function StepTranscript({
	runId,
	step,
	transcript,
	connecting,
}: {
	runId: string;
	step: StepSummary;
	transcript: TranscriptState;
	/** The first replay has not arrived yet. */
	connecting: boolean;
}) {
	const running = step.outcome === null;
	// A gate step without an outcome waits for a person: it gets the answer form.
	const gateOpen = step.nodeType === "gate" && running;
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
	// An item's end only names its id; its start has the title.
	// A blocked item never starts: its title comes from the step's item list.
	const itemTitles = new Map([
		...step.items.map((item) => [item.id, item.title] as const),
		...transcript.items.flatMap((item) =>
			item.kind === "item-start" ? [[item.itemId, item.title] as const] : [],
		),
	]);

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
								{item.kind === "gate-open" ? (
									<GateQuestion
										item={item}
										answer={
											gateOpen ? (
												<GateAnswer
													runId={runId}
													stepId={step.id}
													nodeId={step.nodeId}
													choices={item.choices}
												/>
											) : null
										}
									/>
								) : (
									<TranscriptItemView
										item={item}
										itemTitle={
											item.kind === "item-end"
												? itemTitles.get(item.itemId)
												: undefined
										}
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
								)}
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
						{running && !gateOpen ? (
							<Marker className="py-1">
								<MarkerIcon>
									<LoaderCircleIcon className="animate-spin text-status-running motion-reduce:animate-none" />
								</MarkerIcon>
								<MarkerContent>{RUNNING_TEXT[step.nodeType]}</MarkerContent>
							</Marker>
						) : null}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

const RUNNING_TEXT: Record<StepSummary["nodeType"], string> = {
	agent: "The agent is working…",
	command: "The command is running…",
	decision: "The decider is choosing…",
	gate: "Waiting for an answer…",
	subflow: "The called flow is running…",
	foreach: "Working through the elements…",
};

const TranscriptItemView = memo(function TranscriptItemView({
	item,
	itemTitle,
	running,
	session,
	sessionNumber,
}: {
	item: TranscriptItem;
	/** For an item's end: the title from its start. */
	itemTitle?: string;
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
		case "decision-ask":
			return <DecisionAsk item={item} />;
		case "decision":
			return <DecisionCard item={item} />;
		case "gate-open":
			return <GateQuestion item={item} answer={null} />;
		case "gate-resolved":
			return <GateResolved item={item} />;
		case "items-read":
			return <ItemsRead item={item} />;
		case "item-start":
			return <ItemStart item={item} />;
		case "item-end":
			return <ItemEnd item={item} title={itemTitle} />;
		case "wait":
			return <WaitCard item={item} />;
		case "wake":
			return <WakeMarker item={item} />;
	}
});

function ItemsRead({ item }: { item: ItemsReadItem }) {
	return (
		<Marker>
			<MarkerIcon>
				<ListChecksIcon />
			</MarkerIcon>
			<MarkerContent>
				Read {item.count} {item.count === 1 ? "element" : "elements"} ·{" "}
				{item.open} open · {formatTime(item.at)}
			</MarkerContent>
		</Marker>
	);
}

function ItemStart({ item }: { item: ItemStartItem }) {
	return (
		<div className="flex flex-col gap-1 pt-2">
			<Marker variant="separator">
				<MarkerContent>
					<h3 className="inline font-medium text-foreground">
						{item.title}
						{item.title !== item.itemId ? (
							<span className="ml-1 font-mono font-normal text-muted-foreground">
								{item.itemId}
							</span>
						) : null}
					</h3>
					<span title={formatDateTime(item.at)}> · {formatTime(item.at)}</span>
				</MarkerContent>
			</Marker>
			{item.branch ? (
				<p className="flex items-center justify-center gap-1 text-muted-foreground text-xs">
					<GitBranchIcon className="size-3" aria-hidden="true" />
					<span className="font-mono text-foreground">{item.branch}</span>
					{item.baseBranch ? (
						<>
							<span aria-hidden="true">→</span>
							<span className="sr-only">on top of</span>
							<span className="font-mono">{item.baseBranch}</span>
						</>
					) : null}
				</p>
			) : null}
		</div>
	);
}

function ItemEnd({ item, title }: { item: ItemEndItem; title?: string }) {
	const { color } = itemStateStyle(item.state);
	return (
		<div
			className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-l-[3px] bg-card px-3 py-1.5 text-xs"
			style={{ borderLeftColor: color }}
		>
			<ItemStateBadge state={item.state} />
			<span className="min-w-0 truncate">
				{title && title !== item.itemId ? (
					<>
						{title}{" "}
						<span className="font-mono text-muted-foreground">
							{item.itemId}
						</span>
					</>
				) : (
					<span className="font-mono">{item.itemId}</span>
				)}
			</span>
			<span className="ml-auto text-muted-foreground">
				{formatTime(item.at)}
			</span>
			{item.reason ? (
				<p className="basis-full whitespace-pre-wrap break-words text-muted-foreground">
					{item.reason}
				</p>
			) : null}
		</div>
	);
}

const WAIT_TITLE: Record<WaitItem["reason"], string> = {
	"usage-limit": "Usage limit reached",
	network: "The network is down",
};

/** The run sleeps on this step, and when it continues the same session. */
function WaitCard({ item }: { item: WaitItem }) {
	return (
		<div className="flex gap-2 border border-status-sleeping/50 bg-status-sleeping/10 px-3 py-2 text-sm">
			<MoonIcon
				className="mt-0.5 size-4 shrink-0 text-status-sleeping"
				aria-hidden="true"
			/>
			<div className="flex min-w-0 flex-col gap-1">
				<p className="font-medium text-status-sleeping">
					{WAIT_TITLE[item.reason]} · sleeping
				</p>
				{item.message ? (
					<p className="whitespace-pre-wrap break-words text-xs">
						{item.message}
					</p>
				) : null}
				<p className="text-muted-foreground text-xs">
					Continues the same session at{" "}
					<time
						dateTime={new Date(item.until).toISOString()}
						title={formatDateTime(item.until)}
						className="text-foreground"
					>
						{formatTime(item.until)}
					</time>{" "}
					({formatRelative(item.until)}).
				</p>
			</div>
		</div>
	);
}

function WakeMarker({ item }: { item: WakeItem }) {
	return (
		<Marker>
			<MarkerIcon>
				<SunriseIcon className="text-status-sleeping" />
			</MarkerIcon>
			<MarkerContent>Woke up · {formatTime(item.at)}</MarkerContent>
		</Marker>
	);
}

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
	const { label, icon: Icon, text, color } = stepStateStyle(item.outcome);
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
				{item.data !== undefined ? (
					<div className="flex flex-col gap-1">
						<p className="text-muted-foreground text-xs">Data</p>
						<JsonBlock value={item.data} />
					</div>
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

/** What the decider was asked, with the labels it could pick. */
function DecisionAsk({ item }: { item: DecisionAskItem }) {
	return (
		<div className="flex flex-col gap-2">
			<Marker variant="separator">
				<MarkerContent>
					<h3 className="inline font-medium text-foreground">Decision</h3>
					<span title={formatDateTime(item.at)}>
						{" "}
						· {formatTime(item.at)} · {item.model}
					</span>
				</MarkerContent>
			</Marker>
			<div className="border-primary/40 border-l-2 bg-muted/40 px-3 py-2">
				<p className="mb-1 text-muted-foreground text-xs">Prompt</p>
				<p className="whitespace-pre-wrap break-words text-sm">{item.prompt}</p>
				<p className="mt-2 flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
					Picks one of
					{item.labels.map((label) => (
						<span
							key={label}
							className={cn(
								"border bg-background px-1 font-mono",
								outcomeStyle(label).text,
							)}
						>
							{outcomeLabel(label)}
						</span>
					))}
				</p>
			</div>
		</div>
	);
}

/** The label the decider picked, and its notes on why. */
function DecisionCard({ item }: { item: DecisionItem }) {
	const { text, color } = outcomeStyle(item.label);
	return (
		<div
			className="flex gap-2 border border-l-[3px] bg-card px-3 py-2"
			style={{ borderLeftColor: color }}
		>
			<SplitIcon
				className={cn("mt-0.5 size-4 shrink-0", text)}
				aria-hidden="true"
			/>
			<div className="flex min-w-0 flex-col gap-1">
				<p className="text-xs">
					<span className="text-muted-foreground">Decided · </span>
					<span className={cn("font-medium font-mono", text)}>
						{outcomeLabel(item.label)}
					</span>
				</p>
				{item.notes.trim() ? (
					<p className="whitespace-pre-wrap break-words text-sm">
						{item.notes}
					</p>
				) : (
					<p className="text-muted-foreground text-sm italic">No notes.</p>
				)}
			</div>
		</div>
	);
}

/** The question a Gate asks. While the gate is open, the answer form follows. */
function GateQuestion({
	item,
	answer,
}: {
	item: GateOpenItem;
	answer: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex flex-col gap-3 border bg-card px-3 py-3",
				answer && "border-status-waiting/60",
			)}
		>
			<p className="flex items-center gap-1.5 text-xs">
				<HandIcon className="size-3.5 text-status-waiting" aria-hidden="true" />
				<span className="font-medium text-status-waiting">
					{answer ? "Waiting for you" : "Gate"}
				</span>
				<span className="text-muted-foreground">
					· opened{" "}
					<time
						dateTime={new Date(item.at).toISOString()}
						title={formatDateTime(item.at)}
					>
						{formatRelative(item.at)}
					</time>
				</span>
			</p>
			<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
				{item.question}
			</p>
			{answer}
		</div>
	);
}

/** The answer a person gave, and their note. */
function GateResolved({ item }: { item: GateResolvedItem }) {
	const { text, color } = outcomeStyle(item.choice);
	return (
		<div
			className="flex gap-2 border border-l-[3px] bg-card px-3 py-2"
			style={{ borderLeftColor: color }}
		>
			<HandIcon
				className={cn("mt-0.5 size-4 shrink-0", text)}
				aria-hidden="true"
			/>
			<div className="flex min-w-0 flex-col gap-1">
				<p className="text-xs">
					<span className="text-muted-foreground">Answered · </span>
					<span className={cn("font-medium font-mono", text)}>
						{outcomeLabel(item.choice)}
					</span>
					<span className="text-muted-foreground">
						{" "}
						·{" "}
						<time
							dateTime={new Date(item.at).toISOString()}
							title={formatDateTime(item.at)}
						>
							{formatTime(item.at)}
						</time>
					</span>
				</p>
				{item.note.trim() ? (
					<p className="whitespace-pre-wrap break-words text-sm">{item.note}</p>
				) : (
					<p className="text-muted-foreground text-sm italic">No note.</p>
				)}
			</div>
		</div>
	);
}
