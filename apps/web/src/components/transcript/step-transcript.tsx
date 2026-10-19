import type { JsonValue } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Bubble, BubbleContent } from "@nightshift/ui/components/bubble";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockLine,
} from "@nightshift/ui/components/code-block";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "@nightshift/ui/components/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@nightshift/ui/components/message-scroller";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import {
	BracesIcon,
	CircleCheckIcon,
	CircleStopIcon,
	CircleXIcon,
	ClockIcon,
	CopyIcon,
	GitBranchIcon,
	HandIcon,
	ListChecksIcon,
	type LucideIcon,
	MessagesSquareIcon,
	MoonIcon,
	SendIcon,
	SplitIcon,
	SunriseIcon,
} from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { GateAnswer } from "@/components/gate/gate-answer";
import { GateQuestion as GateQuestionText } from "@/components/gate/gate-question";
import {
	ItemStateBadge,
	outcomeLabel,
	outcomeStyle,
	stepStateStyle,
} from "@/components/outcome-badge";
import { CodeView, JsonBlock } from "@/components/run/json-block";
import { SectionTitle } from "@/components/run/step-console";

import type { RunSummary, SessionSummary, StepSummary } from "@/lib/api-types";
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
	RuleItem,
	TranscriptItem,
	TranscriptState,
	ValueAskItem,
	ValueItem,
	WaitItem,
	WakeItem,
} from "@/lib/transcript";
import {
	markdownContext,
	transcriptToMarkdown,
} from "@/lib/transcript-markdown";

import { ToolCallRow } from "./tool-call-row";

/**
 * The transcript of one step. An agent step reads as a conversation: session
 * boundaries with their prompt, messages, tool calls, and the step report. A
 * command step reads as a terminal log. A decision step shows what the model
 * was asked and what it picked, or which rule held. A gate step shows its
 * question, and while it is open, the options to answer it with.
 */
export function StepTranscript({
	runId,
	step,
	transcript,
	connecting,
	walker,
	answerPending = false,
}: {
	runId: string;
	step: StepSummary;
	transcript: TranscriptState;
	/** The first replay has not arrived yet. */
	connecting: boolean;
	/** The device that runs the run. */
	walker?: RunSummary["walker"];
	/** An answer to this run's Gate is on its way to that device. */
	answerPending?: boolean;
}) {
	const running = step.outcome === null;
	// A gate step without an outcome waits for a person: it gets the answer form.
	const gateOpen = step.gate !== null && running;
	const elsewhere =
		walker && !walker.thisDevice ? (walker.name ?? "another device") : null;
	// A run of another device shows a step's transcript once the step ended:
	// its open Gate comes from the step itself.
	const openGate =
		gateOpen &&
		step.gate &&
		!transcript.items.some((i) => i.kind === "gate-open")
			? step.gate
			: null;
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

	// Select mode: a checkbox per part, to copy only some of them.
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [anchor, setAnchor] = useState<number | null>(null);
	const keys = transcript.items.map((item) => item.key);
	const select = (index: number, checked: boolean, range: boolean) => {
		const from = range && anchor !== null ? Math.min(anchor, index) : index;
		const to = range && anchor !== null ? Math.max(anchor, index) : index;
		setSelected((current) => {
			const next = new Set(current);
			for (const key of keys.slice(from, to + 1)) {
				if (checked) next.add(key);
				else next.delete(key);
			}
			return next;
		});
		setAnchor(index);
	};
	const stopSelecting = () => {
		setSelecting(false);
		setSelected(new Set());
		setAnchor(null);
	};
	const copy = async (items: readonly TranscriptItem[]) => {
		const text = transcriptToMarkdown(
			step,
			items,
			markdownContext(step, itemTitles),
		);
		try {
			await navigator.clipboard.writeText(text);
			toast.success(
				items.length === transcript.items.length
					? "Copied the transcript as Markdown."
					: `Copied ${items.length} ${items.length === 1 ? "part" : "parts"} as Markdown.`,
			);
			stopSelecting();
		} catch {
			toast.error("Could not copy. Allow this page to use the clipboard.");
		}
	};
	const picked = transcript.items.filter((item) => selected.has(item.key));

	return (
		<>
			<div className="flex h-9 shrink-0 items-center gap-2 border-b bg-background px-4">
				<MessagesSquareIcon
					className="size-3.5 text-muted-foreground"
					aria-hidden="true"
				/>
				<SectionTitle id="step-transcript-heading">Transcript</SectionTitle>
				<div className="ml-auto flex items-center gap-1">
					{selecting ? (
						<>
							<span className="px-2 text-muted-foreground text-xs tabular-nums">
								{picked.length === 0
									? "Pick the parts to copy. Shift-click picks a range."
									: `${picked.length} selected`}
							</span>
							<Button variant="ghost" size="xs" onClick={stopSelecting}>
								Cancel
							</Button>
							<Button
								size="xs"
								disabled={picked.length === 0}
								onClick={() => void copy(picked)}
							>
								<CopyIcon data-icon="inline-start" />
								Copy selected
							</Button>
						</>
					) : (
						<>
							<Button
								variant="ghost"
								size="xs"
								disabled={transcript.items.length === 0}
								onClick={() => setSelecting(true)}
							>
								<ListChecksIcon data-icon="inline-start" />
								Select
							</Button>
							<Button
								variant="ghost"
								size="xs"
								disabled={transcript.items.length === 0 && !step.error}
								title="Copy the whole transcript as Markdown, to share it"
								onClick={() => void copy(transcript.items)}
							>
								<CopyIcon data-icon="inline-start" />
								Copy
							</Button>
						</>
					)}
				</div>
			</div>
			{openGate ? (
				<div className="flex shrink-0 flex-col gap-4 border-b p-4">
					<GateQuestionText question={openGate.question} />
					{answerPending ? (
						<Alert>
							<SendIcon />
							<AlertTitle>Answer sent</AlertTitle>
							<AlertDescription>
								Your answer is on its way to {elsewhere ?? "the device"}. The
								run goes on when it is online.
							</AlertDescription>
						</Alert>
					) : (
						<GateAnswer
							runId={runId}
							stepId={step.id}
							nodeId={step.nodeId}
							choices={openGate.choices}
							{...(elsewhere ? { walkerName: elsewhere } : {})}
						/>
					)}
				</div>
			) : null}
			<MessageScrollerProvider autoScroll defaultScrollPosition="end">
				<MessageScroller className="min-h-0">
					<MessageScrollerViewport aria-label={`Transcript of ${step.nodeId}`}>
						<MessageScrollerContent
							aria-live="off"
							className="mx-auto w-full max-w-3xl gap-4 px-4 py-5 md:px-6"
						>
							{transcript.items.map((item, index) => (
								<MessageScrollerItem key={item.key} messageId={item.key}>
									<Selectable
										on={selecting}
										checked={selected.has(item.key)}
										onCheckedChange={(checked, range) =>
											select(index, checked, range)
										}
									>
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
									</Selectable>
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
								<Marker className="justify-center py-10 text-xs">
									{connecting ? (
										<MarkerIcon>
											<Spinner className="size-3.5" />
										</MarkerIcon>
									) : null}
									<MarkerContent>
										{connecting ? "Loading transcript…" : "No transcript yet."}
									</MarkerContent>
								</Marker>
							) : null}
							{step.error ? (
								<Alert variant="destructive">
									<CircleXIcon aria-hidden="true" />
									<AlertTitle>The step failed</AlertTitle>
									<AlertDescription className="whitespace-pre-wrap break-words font-mono text-xs">
										{step.error}
									</AlertDescription>
								</Alert>
							) : null}
							{running && !gateOpen ? (
								<Marker className="text-xs">
									<MarkerIcon>
										<Spinner className="size-3.5 text-status-running" />
									</MarkerIcon>
									<MarkerContent className="text-status-running">
										{RUNNING_TEXT[step.nodeType]}
									</MarkerContent>
								</Marker>
							) : null}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>
		</>
	);
}

/** One part of the transcript, with a checkbox in front while selecting. */
function Selectable({
	on,
	checked,
	onCheckedChange,
	children,
}: {
	on: boolean;
	checked: boolean;
	/** `range`: Shift was held, so everything since the last click follows. */
	onCheckedChange: (checked: boolean, range: boolean) => void;
	children: ReactNode;
}) {
	if (!on) return children;
	return (
		<div className="flex items-start gap-3">
			<Checkbox
				className="mt-1"
				checked={checked}
				aria-label="Copy this part"
				onCheckedChange={(next, details) =>
					onCheckedChange(
						next,
						details.event instanceof MouseEvent && details.event.shiftKey,
					)
				}
			/>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

const RUNNING_TEXT: Record<StepSummary["nodeType"], string> = {
	agent: "The agent is working…",
	command: "The command is running…",
	decision: "Deciding…",
	call: "The called flow is running…",
	value: "Making the value…",
	wait: "Waiting…",
	tool: "Calling the tool…",
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
			return <CodeView code={item.command} language="bash" title="Command" />;
		case "log":
			return <CommandLog item={item} />;
		case "exit":
			return <CommandExit item={item} />;
		case "decision-ask":
			return <DecisionAsk item={item} />;
		case "decision":
			return <DecisionCard item={item} />;
		case "rule":
			return <RuleCard item={item} />;
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
		case "value-ask":
			return <ValueAsk item={item} />;
		case "value":
			return <ValueCard item={item} />;
	}
});

/** A section break in the transcript: a session, an element, a decision. */
function Divider({
	title,
	at,
	details,
}: {
	title: ReactNode;
	at: number;
	details: (string | null | undefined)[];
}) {
	return (
		<Marker variant="separator" className="text-xs">
			<MarkerContent>
				<h3 className="inline font-medium text-foreground">{title}</h3>
				<span title={formatDateTime(at)}>
					{" "}
					· {details.filter(Boolean).join(" · ")}
				</span>
			</MarkerContent>
		</Marker>
	);
}

function ItemsRead({ item }: { item: ItemsReadItem }) {
	return (
		<Marker className="text-xs">
			<MarkerIcon>
				<ListChecksIcon className="size-3.5" />
			</MarkerIcon>
			<MarkerContent>
				Read {item.count} {item.count === 1 ? "item" : "items"} · {item.open}{" "}
				open · {formatTime(item.at)}
			</MarkerContent>
		</Marker>
	);
}

function ItemStart({ item }: { item: ItemStartItem }) {
	return (
		<div className="flex flex-col gap-1.5 pt-2">
			<Divider
				title={
					<>
						{item.title}
						{item.title !== item.itemId ? (
							<span className="ml-1.5 font-mono font-normal text-muted-foreground">
								{item.itemId}
							</span>
						) : null}
					</>
				}
				at={item.at}
				details={[formatTime(item.at)]}
			/>
			{item.branch ? (
				<p className="flex min-w-0 items-center justify-center gap-1 text-muted-foreground text-xs">
					<GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
					<span className="truncate font-mono text-foreground">
						{item.branch}
					</span>
					{item.baseBranch ? (
						<>
							<span aria-hidden="true">→</span>
							<span className="sr-only">on top of</span>
							<span className="truncate font-mono">{item.baseBranch}</span>
						</>
					) : null}
				</p>
			) : null}
		</div>
	);
}

function ItemEnd({ item, title }: { item: ItemEndItem; title?: string }) {
	return (
		<Item variant="outline" size="sm" className="bg-card">
			<ItemContent className="min-w-0">
				<ItemTitle className="w-full min-w-0 text-xs">
					<ItemStateBadge state={item.state} />
					<span className="min-w-0 truncate">
						{title && title !== item.itemId ? (
							<>
								{title}{" "}
								<span className="font-mono font-normal text-muted-foreground">
									{item.itemId}
								</span>
							</>
						) : (
							<span className="font-mono">{item.itemId}</span>
						)}
					</span>
				</ItemTitle>
				{item.reason ? (
					<ItemDescription className="line-clamp-none whitespace-pre-wrap break-words text-xs">
						{item.reason}
					</ItemDescription>
				) : null}
			</ItemContent>
			<ItemActions className="self-start text-muted-foreground text-xs tabular-nums">
				{formatTime(item.at)}
			</ItemActions>
		</Item>
	);
}

const WAIT_TITLE: Record<WaitItem["reason"], string> = {
	"usage-limit": "Usage limit reached",
	network: "The network is down",
	duration: "Waiting",
	time: "Waiting for a time",
	command: "Waiting for a command to pass",
	signal: "Waiting for a signal",
};

/** A Wait node's own wait, or the run policy's (a usage limit, the network). */
const isNodeWait = (reason: WaitItem["reason"]) =>
	reason !== "usage-limit" && reason !== "network";

/**
 * The run sleeps on this step: the run policy continues the same session
 * at a time; a Wait node goes on at its time, when its command passes, or
 * when its signal comes.
 */
function WaitCard({ item }: { item: WaitItem }) {
	const { until } = item;
	const at =
		until === null ? null : (
			<>
				<time
					dateTime={new Date(until).toISOString()}
					title={formatDateTime(until)}
					className="text-foreground tabular-nums"
				>
					{formatTime(until)}
				</time>{" "}
				({formatRelative(until)})
			</>
		);
	const next =
		item.reason === "signal" ? (
			<>
				Goes on when the signal{" "}
				<span className="font-mono text-foreground">{item.signal}</span> arrives
				{at ? <>, or times out at {at}</> : null}.
			</>
		) : item.reason === "command" ? (
			<>Tries the command again{at ? <> at {at}</> : null}.</>
		) : isNodeWait(item.reason) ? (
			<>Goes on{at ? <> at {at}</> : null}.</>
		) : (
			<>Continues where it left off{at ? <> at {at}</> : null}.</>
		);
	return (
		<Alert
			role="status"
			className="border-status-sleeping/40 bg-status-sleeping/10"
		>
			<MoonIcon aria-hidden="true" className="text-status-sleeping!" />
			<AlertTitle className="text-status-sleeping">
				{WAIT_TITLE[item.reason]} · sleeping
			</AlertTitle>
			<AlertDescription className="flex flex-col gap-1">
				{item.message ? (
					<p className="whitespace-pre-wrap break-words text-foreground">
						{item.message}
					</p>
				) : null}
				<p>{next}</p>
			</AlertDescription>
		</Alert>
	);
}

function WakeMarker({ item }: { item: WakeItem }) {
	return (
		<Marker className="text-xs">
			<MarkerIcon>
				<SunriseIcon className="size-3.5 text-status-sleeping" />
			</MarkerIcon>
			<MarkerContent>
				{item.signal !== undefined ? (
					<>
						Signal <span className="font-mono">{item.signal}</span> received
					</>
				) : (
					"Woke up"
				)}{" "}
				· {formatTime(item.at)}
			</MarkerContent>
		</Marker>
	);
}

/** Prompts longer than this many lines start folded. */
const PROMPT_FOLD_LINES = 12;

/** A prompt to the agent or the model, as a message bubble on the right. */
function PromptBubble({
	label,
	prompt,
	empty,
	children,
}: {
	label: string;
	prompt: string;
	/** Shown in place of an empty prompt. */
	empty: string;
	children?: ReactNode;
}) {
	const long =
		prompt.split("\n").length > PROMPT_FOLD_LINES || prompt.length > 1200;
	const [open, setOpen] = useState(false);
	return (
		<Message align="end">
			<MessageContent>
				<MessageHeader className="justify-end">{label}</MessageHeader>
				<Bubble variant="muted" align="end" className="max-w-[92%]">
					<BubbleContent className="flex flex-col gap-2">
						{prompt.trim() === "" ? (
							<p className="text-muted-foreground italic">{empty}</p>
						) : (
							<p
								className={cn(
									"whitespace-pre-wrap break-words",
									long && !open && "line-clamp-[12]",
								)}
							>
								{prompt}
							</p>
						)}
						{long ? (
							<Button
								variant="link"
								size="xs"
								className="self-start px-0"
								aria-expanded={open}
								onClick={() => setOpen((value) => !value)}
							>
								{open ? "Show less" : "Show the whole prompt"}
							</Button>
						) : null}
						{children}
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
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
	return (
		<div className="flex flex-col gap-3 pt-2">
			<Divider
				title={number === undefined ? "Session" : `Session ${number}`}
				at={at}
				details={[resumed ? "resumed" : null, formatTime(at), model]}
			/>
			<PromptBubble
				label={resumed ? "Follow-up prompt" : "Prompt"}
				prompt={prompt}
				empty={resumed ? "Resumed without a new prompt." : "No prompt."}
			/>
		</div>
	);
}

/** The agent's own words. */
function MessageBlock({ item }: { item: MessageItem }) {
	return (
		<Message>
			<MessageContent className="whitespace-pre-wrap text-sm leading-relaxed">
				{item.text}
			</MessageContent>
		</Message>
	);
}

/** A result in the transcript: a report, a decision, an answer. */
function ResultCard({
	icon: Icon,
	kicker,
	value,
	tone,
	extra,
	children,
	className,
}: {
	icon: LucideIcon;
	kicker?: string;
	value: ReactNode;
	/** Text colour class of the outcome. */
	tone: string;
	extra?: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	return (
		// Inset ring: transcript items skip painting offscreen (content-visibility), which clips an outer ring.
		<Card size="sm" className={cn("ring-inset", className)}>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-normal text-xs">
					<Icon className={cn("size-4", tone)} aria-hidden="true" />
					{kicker ? (
						<span className="text-muted-foreground">{kicker}</span>
					) : null}
					<span className={cn("font-medium", tone)}>{value}</span>
					{extra}
				</CardTitle>
			</CardHeader>
			{children ? <CardContent>{children}</CardContent> : null}
		</Card>
	);
}

/** The agent's step report: the outcome the flow follows, and its summary. */
function ReportCard({ item }: { item: ReportItem }) {
	const { label, icon, text } = stepStateStyle(item.outcome);
	const hasSummary = item.summary.trim() !== "";
	return (
		<ResultCard icon={icon} kicker="Step report ·" value={label} tone={text}>
			{hasSummary || item.data !== undefined ? (
				<>
					{hasSummary ? (
						<p className="whitespace-pre-wrap break-words leading-relaxed">
							{item.summary}
						</p>
					) : null}
					{item.data !== undefined ? (
						<div className="flex flex-col gap-1.5">
							<p className="text-muted-foreground text-xs">Data</p>
							<JsonBlock value={item.data} />
						</div>
					) : null}
				</>
			) : null}
		</ResultCard>
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
		<Marker className="text-xs">
			<MarkerIcon>
				<CircleCheckIcon className="size-3.5 text-status-finished" />
			</MarkerIcon>
			<MarkerContent className="tabular-nums">
				{parts.join(" · ")}
			</MarkerContent>
		</Marker>
	);
}

function SessionError({ item }: { item: ErrorItem }) {
	if (item.errorKind === "aborted") {
		return (
			<Marker className="text-xs">
				<MarkerIcon>
					<CircleStopIcon className="size-3.5 text-status-stopped" />
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
		<Alert variant="destructive">
			<Icon aria-hidden="true" />
			<AlertTitle>
				{usageLimit ? "Usage limit reached" : "The agent failed"}
			</AlertTitle>
			<AlertDescription className="flex flex-col gap-1">
				<p className="whitespace-pre-wrap break-words">{item.message}</p>
				{usageLimit && item.resetAt ? (
					<p>
						Resets{" "}
						<time dateTime={new Date(item.resetAt).toISOString()}>
							{formatDateTime(item.resetAt)}
						</time>{" "}
						({formatRelative(item.resetAt)}). Resume the run after that.
					</p>
				) : null}
			</AlertDescription>
		</Alert>
	);
}

/** A command's output as it streamed; stderr in the destructive colour. */
function CommandLog({ item }: { item: LogItem }) {
	return (
		<CodeBlock size="sm">
			<CodeBlockActions>
				<CodeBlockCopyButton
					value={item.chunks.map((chunk) => chunk.text).join("")}
				/>
			</CodeBlockActions>
			<CodeBlockContent wrap className="max-h-[36rem]">
				<CodeBlockLine className="wrap-anywhere">
					{item.chunks.map((chunk, index) => (
						<span
							// Chunks only grow at the end, so the index is stable.
							key={index}
							className={
								chunk.stream === "stderr" ? "text-destructive" : undefined
							}
						>
							{chunk.text}
						</span>
					))}
				</CodeBlockLine>
			</CodeBlockContent>
		</CodeBlock>
	);
}

function CommandExit({ item }: { item: ExitItem }) {
	const passed = item.exitCode === 0;
	return (
		<Marker className="text-xs">
			<MarkerIcon>
				{passed ? (
					<CircleCheckIcon className="size-3.5 text-outcome-pass" />
				) : (
					<CircleXIcon className="size-3.5 text-outcome-fail" />
				)}
			</MarkerIcon>
			<MarkerContent>
				{item.exitCode === null
					? "The command ended without a result"
					: passed
						? "The command succeeded"
						: `The command failed with code ${item.exitCode}`}{" "}
				· {formatTime(item.at)}
			</MarkerContent>
		</Marker>
	);
}

/** What the model was asked, with the options it could pick. */
function DecisionAsk({ item }: { item: DecisionAskItem }) {
	return (
		<div className="flex flex-col gap-3">
			<Divider
				title="Decision"
				at={item.at}
				details={[formatTime(item.at), item.model]}
			/>
			<PromptBubble label="Prompt" prompt={item.prompt} empty="No prompt.">
				<p className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
					Picks one of
					{item.labels.map((label) => (
						<Badge
							key={label}
							variant="outline"
							className={cn("font-mono", outcomeStyle(label).badge)}
						>
							{outcomeLabel(label)}
						</Badge>
					))}
				</p>
			</PromptBubble>
		</div>
	);
}

/** The option the model picked, and its notes on why. */
function DecisionCard({ item }: { item: DecisionItem }) {
	const { text } = outcomeStyle(item.label);
	return (
		<ResultCard
			icon={SplitIcon}
			kicker="Decided ·"
			value={<span className="font-mono">{outcomeLabel(item.label)}</span>}
			tone={text}
		>
			{item.notes.trim() ? (
				<p className="whitespace-pre-wrap break-words leading-relaxed">
					{item.notes}
				</p>
			) : (
				<p className="text-muted-foreground italic">No notes.</p>
			)}
		</ResultCard>
	);
}

/** Which option the rule picked, and what each rule gave on the way there. */
function RuleCard({ item }: { item: RuleItem }) {
	const matched = item.matched;
	const { text } = matched ? outcomeStyle(matched) : { text: "" };
	return (
		<ResultCard
			icon={SplitIcon}
			kicker={matched ? "Rule picked ·" : undefined}
			value={
				matched ? (
					<span className="font-mono">{outcomeLabel(matched)}</span>
				) : (
					"No option matched"
				)
			}
			tone={matched ? text : "text-destructive"}
		>
			<ul className="flex flex-col gap-1 text-xs">
				{item.evaluated.map((entry) => (
					<li key={entry.option} className="flex items-center gap-2">
						<Badge
							variant="outline"
							className={cn("font-mono", outcomeStyle(entry.option).badge)}
						>
							{outcomeLabel(entry.option)}
						</Badge>
						<span className="text-muted-foreground">
							{entry.result === null
								? entry.option === matched
									? "no rule: the default"
									: "no value"
								: ruleResultText(entry.result)}
						</span>
					</li>
				))}
			</ul>
		</ResultCard>
	);
}

/** What a Value step was asked: the expression a rule evaluates, or the prompt a model reads. */
function ValueAsk({ item }: { item: ValueAskItem }) {
	const rule = item.by === "rule";
	return (
		<div className="flex flex-col gap-3">
			<Divider
				title="Value"
				at={item.at}
				details={[formatTime(item.at), rule ? "a rule" : item.model]}
			/>
			<PromptBubble
				label={rule ? "Expression" : "Prompt"}
				prompt={item.source}
				empty={rule ? "No expression." : "No prompt."}
			/>
		</div>
	);
}

/** The value made, as data, or why there is none. */
function ValueCard({ item }: { item: ValueItem }) {
	const made = item.problem === null;
	const { label, text } = stepStateStyle(made ? "pass" : "fail");
	return (
		<ResultCard
			icon={BracesIcon}
			kicker={made ? "Value made ·" : "No value ·"}
			value={label}
			tone={text}
		>
			{made ? (
				<JsonBlock value={item.data} />
			) : (
				<p className="whitespace-pre-wrap break-words leading-relaxed">
					{item.problem}
				</p>
			)}
		</ResultCard>
	);
}

/** A rule's value in words: held or did not hold for a boolean, else the value. */
function ruleResultText(result: JsonValue): string {
	if (result === true) return "held";
	if (result === false) return "did not hold";
	return typeof result === "string" ? result : JSON.stringify(result);
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
		<ResultCard
			icon={HandIcon}
			value={answer ? "Waiting for you" : "Gate"}
			tone="text-status-waiting"
			className={cn(answer && "ring-status-waiting/50")}
			extra={
				<span className="text-muted-foreground">
					· opened{" "}
					<time
						dateTime={new Date(item.at).toISOString()}
						title={formatDateTime(item.at)}
					>
						{formatRelative(item.at)}
					</time>
				</span>
			}
		>
			<p className="whitespace-pre-wrap break-words leading-relaxed">
				{item.question}
			</p>
			{answer}
		</ResultCard>
	);
}

/** The answer a person gave, and their note. */
function GateResolved({ item }: { item: GateResolvedItem }) {
	const { text } = outcomeStyle(item.choice);
	return (
		<ResultCard
			icon={HandIcon}
			kicker="Answered ·"
			value={<span className="font-mono">{outcomeLabel(item.choice)}</span>}
			tone={text}
			extra={
				<span className="text-muted-foreground">
					·{" "}
					<time
						dateTime={new Date(item.at).toISOString()}
						title={formatDateTime(item.at)}
					>
						{formatTime(item.at)}
					</time>
				</span>
			}
		>
			{item.note.trim() ? (
				<p className="whitespace-pre-wrap break-words leading-relaxed">
					{item.note}
				</p>
			) : (
				<p className="text-muted-foreground italic">No note.</p>
			)}
		</ResultCard>
	);
}
