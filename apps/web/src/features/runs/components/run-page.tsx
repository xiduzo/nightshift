import { mergeSteps } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@nightshift/ui/components/resizable";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { cn } from "@nightshift/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDownToLineIcon, SearchXIcon, WorkflowIcon } from "lucide-react";
import { type ComponentProps, useMemo, useRef, useState } from "react";
import { projectQueries } from "@/features/projects";
import type { RunStatus } from "@/shared/api";
import { useMediaQuery } from "@/shared/media-query";
import { type Crumb, SiteHeader } from "@/shared/page";
import { useRunStream } from "../hooks/use-run-stream";
import {
	calledFlowName,
	calledFlowOf,
	derivedTraversals,
	type ItemScope,
	nodeOfStep,
	stepAtScope,
	stepOutcomeColor,
	stepRunsEach,
	stepsIn,
	stepsUnder,
} from "../lib/run-steps";
import { runQueries } from "../queries";
import { StepTranscript } from "../transcript/step-transcript";
import { emptyTranscript } from "../transcript/transcript";
import { RunDetails } from "./details/run-details";
import { FocusBreadcrumb, FocusChip, StepContext } from "./run-focus";
import { RunGraph } from "./run-graph";
import { RunActions, RunTitle } from "./run-header";
import { RunStatusPanel } from "./run-status-panel";
import { RunVariables } from "./run-variables";
import { RunWarnings } from "./run-warnings";
import { StepRowMenu } from "./step-actions";
import { CONSOLE_BAR_PX, StepConsole } from "./step-console";
import { StepSummary as StepSummaryView } from "./step-summary";
import { StepTimeline } from "./step-timeline";

const DESKTOP = "(min-width: 1024px)";
/** A run in one of these runs again from a step. */
const RERUNNABLE: RunStatus[] = [
	"failed",
	"stopped",
	"interrupted",
	"finished",
];

/** The closed console's panel: its bar, and the gaps above and below its card. */
const CONSOLE_CLOSED_PX = CONSOLE_BAR_PX + 8 + 16;

/** The imperative handle of a resizable panel: collapse, expand, resize. */
type PanelHandle = NonNullable<
	Extract<
		NonNullable<ComponentProps<typeof ResizablePanel>["panelRef"]>,
		{ current: unknown }
	>["current"]
>;

/**
 * A run: its steps and the flow behind them fill the page. The selected step
 * sits in a console along the bottom: one line, or open on its summary,
 * transcript and outputs. The run's facts open from the header.
 */
export function RunPage({ runId }: { runId: string }) {
	const run = useQuery(runQueries.get(runId));
	const projects = useQuery(projectQueries.list());
	const stream = useRunStream(runId);
	const desktop = useMediaQuery(DESKTOP);
	/** Null follows the latest step as the run walks. */
	const [pickedStepId, setPickedStepId] = useState<string | null>(null);
	/** The call in focus (a Call step, or one of its elements): the steps and the graph narrow to it. */
	const [focus, setFocus] = useState<ItemScope>(null);
	const [consoleOpen, setConsoleOpen] = useState(false);
	const consolePanel = useRef<PanelHandle>(null);
	/** The height the console last had open, to open it at again. */
	const consoleSize = useRef<string>("45%");

	const steps = useMemo(
		() => mergeSteps(run.data?.steps ?? [], stream.steps),
		[run.data?.steps, stream.steps],
	);

	if (run.isLoading) {
		return (
			<>
				<SiteHeader
					crumbs={[{ label: "Home", link: { to: "/" } }, { label: "Run" }]}
				/>
				<div className="flex flex-1 flex-col gap-3 p-3 lg:p-4">
					<div className="flex items-center gap-3">
						<Skeleton className="h-6 w-64" />
						<Skeleton className="h-5 w-16 rounded-full" />
					</div>
					<div className="grid flex-1 gap-4 lg:grid-cols-[2fr_3fr]">
						<Skeleton className="min-h-72 rounded-xl" />
						<Skeleton className="min-h-72 rounded-xl" />
					</div>
					<Skeleton className="h-11 rounded-xl" />
				</div>
			</>
		);
	}

	if (!run.data) {
		return (
			<>
				<SiteHeader
					crumbs={[{ label: "Home", link: { to: "/" } }, { label: "Run" }]}
				/>
				<div className="flex flex-1 flex-col p-4 md:p-6">
					<Card>
						<CardContent>
							<Empty>
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<SearchXIcon />
									</EmptyMedia>
									<EmptyTitle>Run not available</EmptyTitle>
									<EmptyDescription>
										{run.error?.message ?? "This run does not exist."}
									</EmptyDescription>
								</EmptyHeader>
								<EmptyContent>
									<Button variant="outline" render={<Link to="/" />}>
										Back to projects
									</Button>
								</EmptyContent>
							</Empty>
						</CardContent>
					</Card>
				</div>
			</>
		);
	}

	// The stream reports a status change before the refetched run arrives.
	const status = stream.status ?? run.data.status;
	const runData = run.data;
	const project = projects.data?.find((p) => p.id === runData.projectId);
	// In focus: only the item's steps, nested ones included.
	const visible = stepsUnder(steps, focus);
	const selectedStep =
		steps.find((step) => step.id === pickedStepId) ??
		visible[visible.length - 1];
	const lastStep = steps[steps.length - 1];
	// A run that is not going runs again from a step, on the device that runs it.
	const rerunnable = runData.walker.thisDevice && RERUNNABLE.includes(status);
	const warnedStepIds = new Set(
		runData.warnings.flatMap((warning) =>
			warning.stepId ? [warning.stepId] : [],
		),
	);

	// The newest step of a gate without an outcome is the one the run waits at.
	const openGate =
		status === "waiting"
			? [...steps]
					.reverse()
					.find((step) => step.gate !== null && step.outcome === null)
			: undefined;

	// The graph: the top-level flow, or the called flow of the call in focus.
	const focusStep = focus
		? steps.find((step) => step.id === focus.parentStepId)
		: undefined;
	const focusFlow = focusStep
		? calledFlowOf(runData, steps, focusStep)
		: undefined;
	const graphFlow = (focus && focusFlow) || runData.flow;
	const graphScope: ItemScope = focus && focusFlow ? focus : null;
	const graphSteps = stepsIn(steps, graphScope);
	const graphTraversals = graphScope
		? derivedTraversals(graphFlow, graphSteps)
		: runData.traversals;
	const graphSelected = selectedStep
		? stepAtScope(steps, selectedStep, graphScope)
		: undefined;

	const selectNode = (nodeId: string) => {
		const latest = [...graphSteps]
			.reverse()
			.find((step) => step.nodeId === nodeId);
		if (latest) setPickedStepId(latest.id);
	};

	const selectItem = (scope: ItemScope) => {
		setFocus(scope);
		// Show the item's latest step; the whole run follows the latest again.
		setPickedStepId(
			scope ? (stepsUnder(steps, scope).at(-1)?.id ?? null) : null,
		);
	};

	/** Opens or closes the console. On a desktop it is a panel that drags too. */
	const showConsole = (open: boolean) => {
		setConsoleOpen(open);
		const panel = consolePanel.current;
		if (!panel) return;
		if (open && panel.isCollapsed()) panel.resize(consoleSize.current);
		if (!open && !panel.isCollapsed()) panel.collapse();
	};

	const showGate = () => {
		if (!openGate) return;
		setFocus(null);
		setPickedStepId(openGate.id);
		showConsole(true);
	};

	const crumbs: Crumb[] = [
		{ label: "Home", link: { to: "/" } },
		{
			label: project?.name ?? "Project",
			link: {
				to: "/projects/$projectId",
				params: { projectId: runData.projectId },
			},
		},
		{
			label: "Runs",
			link: {
				to: "/projects/$projectId/runs",
				params: { projectId: runData.projectId },
			},
		},
		{ label: runData.title },
	];

	const stepsPane = (
		<section
			aria-labelledby="steps-heading"
			className={cn("flex flex-col", desktop && "h-full")}
		>
			<div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
				<h2
					id="steps-heading"
					className="flex items-center gap-2 font-medium text-sm"
				>
					Steps
					<Badge variant="secondary" className="tabular-nums">
						{visible.length}
					</Badge>
				</h2>
				{focus ? (
					<FocusChip
						steps={steps}
						focus={focus}
						onClear={() => selectItem(null)}
					/>
				) : null}
				{pickedStepId ? (
					<Button
						variant="ghost"
						size="xs"
						className="ml-auto"
						title="Follow the latest step as the run goes on"
						onClick={() => setPickedStepId(null)}
					>
						<ArrowDownToLineIcon data-icon="inline-start" />
						Follow latest
					</Button>
				) : null}
			</div>
			<ScrollArea
				className={cn(
					"min-h-0 flex-1",
					!desktop && "max-h-96 [&>[data-slot=scroll-area-viewport]]:max-h-96",
				)}
			>
				<StepTimeline
					steps={steps}
					scope={focus}
					runStatus={status}
					selectedStepId={selectedStep?.id ?? null}
					selectedItem={focus}
					onSelect={setPickedStepId}
					onSelectItem={selectItem}
					calledName={(step) => calledFlowName(runData, steps, step)}
					runsEach={(step) => stepRunsEach(runData, steps, step)}
					outcomeColor={(step) => stepOutcomeColor(runData, steps, step)}
					warnedStepIds={warnedStepIds}
					stepAction={
						rerunnable
							? (step) => <StepRowMenu runId={runData.id} step={step} />
							: undefined
					}
				/>
			</ScrollArea>
		</section>
	);

	const flowPane = (
		<section
			aria-label="The flow"
			className={cn("flex min-h-0 flex-col gap-3", desktop && "h-full")}
		>
			<div className="flex h-7 shrink-0 items-center gap-2 px-1 text-sm">
				<WorkflowIcon
					className="size-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				{graphScope ? (
					<FocusBreadcrumb
						run={runData}
						steps={steps}
						focus={graphScope}
						onSelect={selectItem}
					/>
				) : (
					<span className="truncate font-medium font-mono">
						{runData.flowName ?? "Quick run"}
					</span>
				)}
			</div>
			<div
				className={cn(
					"relative min-h-0 overflow-hidden rounded-xl border bg-muted/40 dark:bg-muted/20",
					desktop ? "flex-1" : "h-72",
				)}
			>
				<RunGraph
					key={
						graphScope
							? `${graphScope.parentStepId}:${graphScope.itemId ?? ""}`
							: "top"
					}
					flow={graphFlow}
					steps={graphSteps}
					runStatus={status}
					traversals={graphTraversals}
					selectedNodeId={graphSelected?.nodeId ?? null}
					onSelectNode={selectNode}
					label={graphScope ? "The flow of the call in focus" : undefined}
				/>
			</div>
			<RunStatusPanel
				// Opens again when the status changes.
				key={status}
				run={runData}
				status={status}
				openGateNodeId={openGate?.nodeId ?? null}
				onShowGate={showGate}
				wait={stream.transcript.lastWait}
				lastStep={lastStep}
			/>
			<RunWarnings warnings={runData.warnings} onShowStep={setPickedStepId} />
			<RunVariables run={runData} steps={steps} onShowStep={setPickedStepId} />
		</section>
	);

	const stepConsole = (
		<StepConsole
			step={selectedStep}
			runStatus={status}
			open={consoleOpen}
			onOpenChange={showConsole}
			empty={status === "running" ? "Waiting for the first step…" : "No steps."}
			outcomeColor={
				selectedStep
					? stepOutcomeColor(runData, steps, selectedStep)
					: undefined
			}
			className="h-full"
			summary={
				selectedStep ? (
					<StepSummaryView
						run={runData}
						steps={steps}
						step={selectedStep}
						focus={focus}
						onSelectItem={selectItem}
						context={
							selectedStep.scope ? (
								<StepContext
									run={runData}
									steps={steps}
									step={selectedStep}
									onSelect={selectItem}
								/>
							) : undefined
						}
					/>
				) : null
			}
			transcript={
				selectedStep ? (
					<StepTranscript
						key={selectedStep.id}
						runId={runData.id}
						step={selectedStep}
						transcript={
							stream.transcript.steps.get(selectedStep.id) ?? emptyTranscript
						}
						connecting={stream.connection === "connecting"}
						walker={runData.walker}
						node={nodeOfStep(runData, steps, selectedStep)}
						answerPending={runData.commands.some(
							(c) => c.kind === "gate.resolve",
						)}
					/>
				) : null
			}
		/>
	);

	return (
		<>
			<SiteHeader crumbs={crumbs}>
				<RunActions run={runData} status={status} steps={steps} />
				<RunDetails
					run={runData}
					steps={steps}
					status={status}
					onShowStep={setPickedStepId}
				/>
			</SiteHeader>
			<div className="flex flex-1 flex-col lg:h-[calc(100svh-3.5rem)] lg:min-h-0 lg:flex-none">
				<RunTitle
					run={runData}
					steps={steps}
					status={status}
					reconnecting={stream.connection === "reconnecting"}
				/>
				{desktop ? (
					<ResizablePanelGroup
						orientation="vertical"
						className="min-h-[28rem] flex-1"
					>
						<ResizablePanel minSize="25%">
							<ResizablePanelGroup orientation="horizontal">
								<ResizablePanel
									defaultSize="38%"
									minSize="22%"
									className="min-h-0 min-w-0 pt-3 pr-2 pb-2 pl-4"
								>
									<Card className="h-full gap-0 py-0">{stepsPane}</Card>
								</ResizablePanel>
								<ResizableHandle
									withHandle
									className="bg-transparent focus-visible:bg-ring"
								/>
								<ResizablePanel
									defaultSize="62%"
									minSize="30%"
									className="min-h-0 min-w-0 pt-3 pr-4 pb-2 pl-2"
								>
									{flowPane}
								</ResizablePanel>
							</ResizablePanelGroup>
						</ResizablePanel>
						<ResizableHandle
							withHandle
							className="bg-transparent focus-visible:bg-ring"
						/>
						<ResizablePanel
							panelRef={consolePanel}
							collapsible
							collapsedSize={CONSOLE_CLOSED_PX}
							minSize={220}
							defaultSize={CONSOLE_CLOSED_PX}
							className="min-h-0 px-4 pt-2 pb-4"
							onResize={(size) => {
								const open = size.inPixels > CONSOLE_CLOSED_PX + 1;
								if (open) consoleSize.current = `${size.asPercentage}%`;
								setConsoleOpen(open);
							}}
						>
							<Card className="h-full gap-0 py-0">{stepConsole}</Card>
						</ResizablePanel>
					</ResizablePanelGroup>
				) : (
					<div className="flex flex-col gap-3 p-3">
						<Card className="gap-0 py-0">{stepsPane}</Card>
						{flowPane}
						<Card
							className={cn(
								"gap-0 py-0",
								consoleOpen && "h-[85svh] min-h-[32rem]",
							)}
						>
							{stepConsole}
						</Card>
					</div>
				)}
			</div>
		</>
	);
}
