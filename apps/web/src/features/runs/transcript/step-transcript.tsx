/**
 * The transcript of one step: its items in order.
 * Each kind of item has its view in `items/`, one file per group of kinds.
 */
import type { FlowNode } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import { Spinner } from "@nightshift/ui/components/spinner";
import { CircleXIcon, SendIcon } from "lucide-react";
import { memo, useMemo } from "react";
import {
	AskForm,
	GateAnswer,
	GateConfirmation,
	GateQuestion as GateQuestionText,
} from "@/features/gates";
import type { RunSummary, SessionSummary, StepSummary } from "@/shared/api";
import { useOpenedStep } from "../hooks/use-opened-step";
import { CommandExit, CommandLog, CommandRun } from "./items/command-items";
import { ConvertCard } from "./items/convert-items";
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
import { LeaseCard } from "./items/lease-items";
import { ItemEnd, ItemStart, ItemsRead } from "./items/list-items";
import { Reasoning } from "./items/reasoning";
import { ServiceCard } from "./items/service-items";
import {
	MessageBlock,
	ReportCard,
	SessionBoundary,
	SessionError,
	SessionFinished,
} from "./items/session-items";
import { SinceLastRunCard } from "./items/since-last-run-items";
import { isSubagentCall, SubagentRun } from "./items/subagent";
import { ToolCallRow } from "./items/tool-call-row";
import { ToolCallsGroup } from "./items/tool-calls-group";
import { WaitCard, WakeMarker } from "./items/wait-items";
import { WebRequestCard } from "./items/web-request-items";
import type { TranscriptState } from "./transcript";
import type { TranscriptItem } from "./transcript-items";
import { type TranscriptRow, transcriptRows } from "./transcript-rows";

/**
 * The transcript of one step, inline in the run's story: the story scrolls,
 * not the transcript. An agent step reads as a conversation: session
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
	projectRoot,
}: {
	runId: string;
	step: StepSummary;
	transcript: TranscriptState;
	/** The project's folder of the run, to show paths relative to it. */
	projectRoot?: string | undefined;
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

	const rows = useMemo(
		() => transcriptRows(transcript.items),
		[transcript.items],
	);

	return (
		<div className="flex min-w-0 flex-col gap-3">
			{openGate ? (
				<div className="flex flex-col gap-4 rounded-xl border p-4">
					<GateQuestionText question={openGate.question} />
					{answerPending ? (
						<Alert>
							<SendIcon />
							<AlertTitle>Answer sent</AlertTitle>
							<AlertDescription>
								Your answer is on its way to {elsewhere ?? "the device"}. The
								run continues when it is online.
							</AlertDescription>
						</Alert>
					) : openGate.form ? (
						<AskForm
							runId={runId}
							stepId={step.id}
							form={openGate.form}
							deadline={openGate.deadline}
							filesHere={!elsewhere}
							{...(elsewhere ? { walkerName: elsewhere } : {})}
						/>
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
			<div
				role="log"
				aria-live="off"
				aria-label={`Transcript of ${step.nodeId}`}
				className="flex min-w-0 flex-col gap-4"
			>
				{rows.map((row) => {
					const key = rowKey(row);
					return (
						<div key={key} className="min-w-0">
							{row.kind === "tool-calls" ? (
								<ToolCallsGroup
									items={row.items}
									running={running}
									projectRoot={projectRoot}
								/>
							) : row.kind === "command" ? (
								<CommandRun
									command={row.command}
									{...(row.log ? { log: row.log } : {})}
									{...(row.exit ? { exit: row.exit } : {})}
									running={running}
								/>
							) : row.item.kind === "gate-open" &&
								row.item.key === openGateKey &&
								step.gate?.form ? (
								<div className="flex flex-col gap-4 rounded-xl border p-4">
									<GateQuestionText question={row.item.question} />
									<AskForm
										runId={runId}
										stepId={step.id}
										form={step.gate.form}
										deadline={step.gate.deadline}
										filesHere={!elsewhere}
										{...(elsewhere ? { walkerName: elsewhere } : {})}
									/>
								</div>
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
									projectRoot={projectRoot}
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
						</div>
					);
				})}
				{pendingSessions.map((session) => (
					<div key={`pending:${session.id}`} className="min-w-0">
						<SessionBoundary
							number={sessionNumbers.get(session.id)}
							at={session.createdAt}
							prompt={session.prompt ?? ""}
						/>
					</div>
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
			</div>
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
	lease: "Taking the lease…",
	service: "Starting the service…",
	"since-last-run": "Comparing with the last run…",
	convert: "Converting…",
	"web-request": "Sending the request…",
};

const TranscriptItemView = memo(function TranscriptItemView({
	item,
	itemTitle,
	running,
	session,
	sessionNumber,
	node,
	projectRoot,
}: {
	item: TranscriptItem;
	/** The project's folder of the run, to show paths relative to it. */
	projectRoot?: string | undefined;
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
				<SubagentRun item={item} running={running} projectRoot={projectRoot} />
			) : (
				<ToolCallRow item={item} running={running} projectRoot={projectRoot} />
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
		case "lease":
			return <LeaseCard item={item} />;
		case "service":
			return <ServiceCard item={item} />;
		case "since-last-run":
			return <SinceLastRunCard item={item} />;
		case "convert":
			return <ConvertCard item={item} />;
		case "web-request":
			return <WebRequestCard item={item} />;
	}
});
