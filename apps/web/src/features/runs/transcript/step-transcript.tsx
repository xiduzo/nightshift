/**
 * The transcript of one step: its items in order, with selection and copy.
 * Each kind of item has its view in `items/`, one file per group of kinds.
 */
import type { FlowNode } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
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
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	CircleXIcon,
	CopyIcon,
	ListChecksIcon,
	MessagesSquareIcon,
	SendIcon,
} from "lucide-react";
import { memo, type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	GateAnswer,
	GateConfirmation,
	GateQuestion as GateQuestionText,
} from "@/features/gates";
import type { RunSummary, SessionSummary, StepSummary } from "@/shared/api";
import { SectionTitle } from "../components/step-console";
import { useOpenedStep } from "../hooks/use-opened-step";
import { CommandExit, CommandLog, CommandRun } from "./items/command-items";
import {
	DecisionAsk,
	DecisionCard,
	GateQuestion,
	GateResolved,
	RuleCard,
	ValueAsk,
	ValueCard,
} from "./items/decision-items";
import { EndCard } from "./items/end-items";
import { ItemEnd, ItemStart, ItemsRead } from "./items/list-items";
import { Reasoning } from "./items/reasoning";
import {
	MessageBlock,
	ReportCard,
	SessionBoundary,
	SessionError,
	SessionFinished,
} from "./items/session-items";
import { isSubagentCall, SubagentRun } from "./items/subagent";
import { ToolCallRow } from "./items/tool-call-row";
import { ToolCallsGroup } from "./items/tool-calls-group";
import { WaitCard, WakeMarker } from "./items/wait-items";
import type { TranscriptState } from "./transcript";
import type { TranscriptItem } from "./transcript-items";
import { markdownContext, transcriptToMarkdown } from "./transcript-markdown";
import {
	rowItems,
	type TranscriptRow,
	transcriptRows,
} from "./transcript-rows";

/**
 * The transcript of one step. An agent step reads as a conversation: session
 * boundaries with their prompt, messages, tool calls, and the step report. A
 * command step reads as a terminal log. A decision step shows what the model
 * was asked and what it picked, or which rule held. A gate step shows its
 * question, and while it is open, the options to answer it with.
 */
export function StepTranscript({
	runId,
	step: summary,
	transcript,
	connecting,
	walker,
	answerPending = false,
	node,
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
	/** The step's node: its outcomes keep their colours. */
	node?: FlowNode;
}) {
	// The prompts load when the step opens.
	const step = useOpenedStep(runId, summary);
	const running = step.outcome === null;
	// A gate step without an outcome waits for a person: it gets the answer form.
	const gateOpen = step.gate !== null && running;
	const elsewhere =
		walker && !walker.thisDevice ? (walker.name ?? "another device") : null;
	// The transcript of a run of another device follows it live, but its
	// gate entry may not be here yet: the open Gate comes from the step itself.
	const openGate =
		gateOpen &&
		step.gate &&
		!transcript.items.some((i) => i.kind === "gate-open")
			? step.gate
			: null;
	// The Gate that waits now is the last one this step opened.
	const openGateKey = gateOpen
		? transcript.items.filter((item) => item.kind === "gate-open").at(-1)?.key
		: undefined;
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

	// Select mode: a checkbox per part, to copy only some of them. While
	// selecting, tool calls are not grouped, so each call can be picked.
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [anchor, setAnchor] = useState<number | null>(null);
	const rows = useMemo(
		() => transcriptRows(transcript.items, { groupTools: !selecting }),
		[transcript.items, selecting],
	);
	const select = (index: number, checked: boolean, range: boolean) => {
		const from = range && anchor !== null ? Math.min(anchor, index) : index;
		const to = range && anchor !== null ? Math.max(anchor, index) : index;
		setSelected((current) => {
			const next = new Set(current);
			for (const row of rows.slice(from, to + 1)) {
				for (const item of rowItems(row)) {
					if (checked) next.add(item.key);
					else next.delete(item.key);
				}
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
							deadline={openGate.deadline}
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
							{rows.map((row, index) => {
								const key = rowKey(row);
								return (
									<MessageScrollerItem key={key} messageId={key}>
										<Selectable
											on={selecting}
											checked={rowItems(row).every((item) =>
												selected.has(item.key),
											)}
											onCheckedChange={(checked, range) =>
												select(index, checked, range)
											}
										>
											{row.kind === "tool-calls" ? (
												<ToolCallsGroup items={row.items} running={running} />
											) : row.kind === "command" ? (
												<CommandRun
													command={row.command}
													{...(row.log ? { log: row.log } : {})}
													{...(row.exit ? { exit: row.exit } : {})}
													running={running}
												/>
											) : row.item.kind === "gate-open" &&
												row.item.key === openGateKey ? (
												<GateConfirmation
													runId={runId}
													stepId={step.id}
													question={row.item.question}
													choices={row.item.choices}
													deadline={row.item.deadline ?? null}
													openedAt={row.item.at}
													{...(elsewhere ? { walkerName: elsewhere } : {})}
												/>
											) : (
												<TranscriptItemView
													item={row.item}
													node={node}
													itemTitle={
														row.item.kind === "item-end"
															? itemTitles.get(row.item.itemId)
															: undefined
													}
													running={running}
													session={
														row.item.sessionId
															? sessionsById.get(row.item.sessionId)
															: undefined
													}
													sessionNumber={
														row.item.sessionId
															? sessionNumbers.get(row.item.sessionId)
															: undefined
													}
												/>
											)}
										</Selectable>
									</MessageScrollerItem>
								);
							})}
							{pendingSessions.map((session) => (
								<MessageScrollerItem
									key={`pending:${session.id}`}
									messageId={`pending:${session.id}`}
								>
									<SessionBoundary
										number={sessionNumbers.get(session.id)}
										at={session.createdAt}
										prompt={session.prompt ?? ""}
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

/** A row's key: its first item's, which stays while calls join a group. */
function rowKey(row: TranscriptRow): string {
	return row.kind === "item"
		? row.item.key
		: row.kind === "command"
			? row.command.key
			: (row.items[0]?.key ?? "tool-calls");
}

const RUNNING_TEXT: Record<StepSummary["nodeType"], string> = {
	agent: "The agent is working…",
	command: "The command is running…",
	decision: "Deciding…",
	call: "The called flow is running…",
	value: "Making the value…",
	wait: "Waiting…",
	tool: "Calling the tool…",
	end: "Ending the run…",
	join: "Waiting for the branches…",
};

const TranscriptItemView = memo(function TranscriptItemView({
	item,
	itemTitle,
	running,
	session,
	sessionNumber,
	node,
}: {
	item: TranscriptItem;
	/** For an item's end: the title from its start. */
	itemTitle?: string;
	running: boolean;
	session: SessionSummary | undefined;
	sessionNumber: number | undefined;
	node?: FlowNode;
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
		case "thinking":
			return <Reasoning item={item} running={running} />;
		case "tool":
			return isSubagentCall(item) ? (
				<SubagentRun item={item} running={running} />
			) : (
				<ToolCallRow item={item} running={running} />
			);
		case "report":
			return <ReportCard item={item} node={node} />;
		case "finished":
			return <SessionFinished item={item} />;
		case "error":
			return <SessionError item={item} />;
		case "command":
			return <CommandRun command={item} running={running} />;
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
			return <GateQuestion item={item} />;
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
		case "end":
			return <EndCard item={item} />;
	}
});
