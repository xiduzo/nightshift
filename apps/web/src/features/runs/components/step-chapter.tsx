import { changedFiles, stepTodos } from "@nightshift/client";
import type { FlowNode, OutcomeColor } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import { HandIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { NODE_TYPE, OutcomeBadge, stepState } from "@/features/flows";
import type { Artifact, RunDetail, RunStatus, StepSummary } from "@/shared/api";
import { reportFileName, stepReport } from "../lib/report";
import type { ItemScope } from "../lib/run-steps";
import { stepLearnings } from "../lib/step-learnings";
import { StepTranscript } from "../transcript/step-transcript";
import type { TranscriptState } from "../transcript/transcript";
import { ChangedFiles } from "./changed-files";
import { StepDuration } from "./elapsed";
import { RunArtifacts } from "./run-artifacts";
import { RunReport } from "./run-report";
import { StepLearnings } from "./step-learnings";
import { StepPlan } from "./step-plan";
import { StepSources } from "./step-sources";
import { StepSummary as StepSummaryView } from "./step-summary";
import { StandInBadge } from "./test-run-badge";

type ChapterProps = {
	run: RunDetail;
	steps: StepSummary[];
	step: StepSummary;
	runStatus: RunStatus;
	transcript: TranscriptState;
	/** The files this step kept. */
	artifacts: Artifact[];
	/** The first replay has not arrived yet. */
	connecting: boolean;
	/** An answer to this run's Gate is on its way to the device that runs it. */
	answerPending: boolean;
	outcomeColor?: OutcomeColor;
	/** The step's node: its outcomes keep their colours. */
	node?: FlowNode;
	/** The run warned about this step. */
	warned: boolean;
	focus: ItemScope;
	onSelectItem: (scope: ItemScope) => void;
	onShowStep: (stepId: string) => void;
	/** Where the step ran, for a step inside a called flow. */
	context?: ReactNode;
	/** A button for the step's actions. */
	action?: ReactNode;
};

/**
 * One step of the run's story, told in full: a checkpoint with its name,
 * time and outcome, then the agent's plan, the sources it used, its
 * transcript, and what it left: an End step's report, its summary,
 * learnings, changed files and artifacts.
 */
export function StepChapter(props: ChapterProps) {
	const { step, runStatus, outcomeColor, warned, action } = props;
	const Icon = step.gate !== null ? HandIcon : NODE_TYPE[step.nodeType].icon;
	return (
		<section aria-label={step.nodeId} className="flex flex-col gap-4">
			<div className="flex items-center gap-2">
				<Marker variant="separator" className="min-w-0 flex-1 text-xs">
					<MarkerIcon>
						<Icon />
					</MarkerIcon>
					<MarkerContent className="flex items-center gap-2">
						<span className="font-medium font-mono text-foreground">
							{step.nodeId}
						</span>
						{step.visit > 1 ? <span>visit {step.visit}</span> : null}
						<span className="tabular-nums">
							<StepDuration step={step} />
						</span>
						<OutcomeBadge
							state={stepState(step, runStatus)}
							color={outcomeColor}
						/>
						{step.test ? <StandInBadge test={step.test} /> : null}
						{warned ? (
							<TriangleAlertIcon
								className="size-3.5 text-status-waiting"
								aria-label="This step has a warning"
							/>
						) : null}
					</MarkerContent>
				</Marker>
				{action}
			</div>
			<ChapterBody {...props} />
		</section>
	);
}

function ChapterBody({
	run,
	steps,
	step,
	transcript,
	artifacts,
	connecting,
	answerPending,
	node,
	focus,
	onSelectItem,
	onShowStep,
	context,
}: ChapterProps) {
	const items = transcript.items;
	// A subagent's calls change files too: they sit inside the call that started it.
	const calls = useMemo(
		() =>
			items.flatMap((item) =>
				item.kind === "tool"
					? [
							item,
							...(item.steps ?? []).filter((inner) => inner.kind === "tool"),
						]
					: [],
			),
		[items],
	);
	const todos = useMemo(() => stepTodos(calls), [calls]);
	const learnings = useMemo(() => stepLearnings(items), [items]);
	const files = useMemo(
		() => changedFiles(calls, run.worktreePath, transcript.changes),
		[calls, run.worktreePath, transcript.changes],
	);
	const ended = step.outcome !== null;
	// From the step's outputs: it shows when the transcript is out of reach too.
	const report = stepReport(step, run.warnings);

	return (
		<>
			{context ? (
				<div className="min-w-0 text-muted-foreground text-xs">{context}</div>
			) : null}
			{todos ? <StepPlan todos={todos} running={!ended} /> : null}
			{step.sources && step.sources.length > 0 ? (
				<StepSources sources={step.sources} />
			) : null}
			{/* A step that stood in for its node in a test run has no transcript. */}
			{step.test ? null : (
				<StepTranscript
					runId={run.id}
					step={step}
					transcript={transcript}
					projectRoot={run.worktreePath}
					connecting={connecting}
					walker={run.walker}
					answerPending={answerPending}
					node={node}
				/>
			)}
			{report ? (
				<RunReport
					text={report.text}
					cut={report.cut}
					fileName={reportFileName(run.flowName)}
				/>
			) : null}
			{ended || step.nodeType === "call" ? (
				<StepSummaryView
					run={run}
					steps={steps}
					step={step}
					focus={focus}
					onSelectItem={onSelectItem}
				/>
			) : null}
			{learnings.length > 0 ? <StepLearnings notes={learnings} /> : null}
			{files.length > 0 ? (
				<ChangedFiles
					files={files}
					marksCommands={step.nodeType === "agent"}
					overlapped={transcript.changes?.overlapped === true}
					omitted={transcript.changes?.omitted ?? 0}
					title={
						<h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs">
							Changed files
							<Badge variant="secondary" className="tabular-nums">
								{files.length}
							</Badge>
						</h4>
					}
				/>
			) : null}
			{artifacts.length > 0 ? (
				<RunArtifacts
					run={run}
					steps={steps}
					artifacts={artifacts}
					onShowStep={onShowStep}
					className="p-0"
				/>
			) : null}
		</>
	);
}
