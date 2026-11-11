import { askWhy, mergeSteps, runActions } from "@nightshift/client";
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
import { MessageScrollerProvider } from "@nightshift/ui/components/message-scroller";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { deviceQueries } from "@/features/devices";
import { projectQueries } from "@/features/projects";
import type { StepSummary } from "@/shared/api";
import { useMediaQuery } from "@/shared/media-query";
import { type Crumb, SiteHeader } from "@/shared/page";
import { useLastSeen } from "../hooks/use-last-seen";
import { useRunStream } from "../hooks/use-run-stream";
import {
	calledFlowName,
	calledFlowOf,
	type ItemScope,
	sameScope,
	stepAtScope,
	stepsIn,
	traversalsIn,
} from "../lib/run-steps";
import { runQueries } from "../queries";
import { AskWhyButton } from "./ask-why-button";
import { RunActions } from "./run-actions";
import { FocusBreadcrumb, StepContext } from "./run-focus";
import { RunGraph } from "./run-graph";
import { RunBadges, RunTitle } from "./run-header";
import { RunLeases } from "./run-leases";
import { RunServices } from "./run-services";
import { RunSidebar } from "./run-sidebar";
import { RunStatusPanel } from "./run-status-panel";
import { RunStory, type StepPick } from "./run-story";
import { RunWarnings } from "./run-warnings";
import { StepRowMenu } from "./step-actions";

const DESKTOP = "(min-width: 1024px)";

/**
 * A run as a story: every step in the order it ran, told like a chat, ending
 * on what the run does now. Beside it, at a fixed width: the visits, the
 * inputs and the variables. The flow opens on request. "Follow latest"
 * keeps the newest step in view.
 */
export function RunPage({
	runId,
	stepId,
}: {
	runId: string;
	/** The step to open the run at. */
	stepId?: string;
}) {
	// The story keeps the newest step in view while you are at its end.
	// A link to a step opens the run there instead.
	return (
		<MessageScrollerProvider
			autoScroll
			defaultScrollPosition={stepId === undefined ? "end" : "start"}
		>
			<RunPageBody runId={runId} stepId={stepId} />
		</MessageScrollerProvider>
	);
}

function RunPageBody({ runId, stepId }: { runId: string; stepId?: string }) {
	const run = useQuery(runQueries.get(runId));
	const projects = useQuery(projectQueries.list());
	// This computer, for its owner only: the assistant is the owner's.
	const devices = useQuery(deviceQueries.overview());
	const stream = useRunStream(runId);
	const desktop = useMediaQuery(DESKTOP);
	const seen = useLastSeen(runId);
	const [pick, setPick] = useState<StepPick | null>(null);
	/** The call in focus (a Call step, or one of its elements): the story and the graph narrow to it. */
	const [focus, setFocus] = useState<ItemScope>(null);
	const [flowOpen, setFlowOpen] = useState(false);

	const steps = useMemo(
		() => mergeSteps(run.data?.steps ?? [], stream.steps),
		[run.data?.steps, stream.steps],
	);
	const liveStatus = stream.status ?? run.data?.status;
	// It needs only the run's id, so it loads beside the run, not after it.
	const artifacts = useQuery(
		runQueries.artifacts(runId, liveStatus === "running"),
	);

	/** Scrolls the story to a step, and narrows it to the call the step is in. */
	const showStep = (id: string) => {
		const step = steps.find((candidate) => candidate.id === id);
		if (step && !sameScope(step.scope, focus)) setFocus(step.scope);
		setPick((current) => ({ stepId: id, seq: (current?.seq ?? 0) + 1 }));
	};

	// A link to a step of this run (`?step=`) scrolls to it, also when the
	// page is open already. Only a new link does: the person's own picks
	// after it stay. It waits for the steps, to know the call it is in.
	const openLinkedStep = useEffectEvent((id: string) => {
		if (steps.some((step) => step.id === id)) showStep(id);
	});
	const loaded = steps.length > 0;
	useEffect(() => {
		if (stepId !== undefined && loaded) openLinkedStep(stepId);
	}, [stepId, loaded]);

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
									<Button
										variant="outline"
										nativeButton={false}
										render={<Link to="/" />}
									>
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
	const ask = askWhy({
		status,
		flowName: runData.flowName,
		project,
		owner: devices.data ? devices.data.thisComputer !== null : undefined,
	});
	const story = stepsIn(steps, focus);
	const artifactList = artifacts.data ?? [];
	// A run that is not going runs again from a step, on the device that runs it.
	const rerunnable = runActions(
		status,
		runData.walker.thisDevice,
		runData.result,
	).rerun;
	const warnedStepIds = new Set(
		runData.warnings.flatMap((warning) =>
			warning.stepId ? [warning.stepId] : [],
		),
	);
	const pickedStep = pick
		? steps.find((step) => step.id === pick.stepId)
		: undefined;
	const lastStep = steps[steps.length - 1];

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
	const graphTraversals = traversalsIn(runData, graphScope);
	// The name of the flow on the graph.
	const graphFlowName = focusStep
		? calledFlowName(runData, steps, focusStep)
		: runData.flowName;
	const graphStep = pickedStep ?? lastStep;
	const graphSelected = graphStep
		? stepAtScope(steps, graphStep, graphScope)
		: undefined;

	const selectNode = (nodeId: string) => {
		const latest = [...graphSteps]
			.reverse()
			.find((step) => step.nodeId === nodeId);
		if (!latest) return;
		setFlowOpen(false);
		showStep(latest.id);
	};

	const selectItem = (scope: ItemScope) => {
		setFocus(scope);
		setPick(null);
	};

	// A run of another of your Spaces opens here too. Its project page
	// shows only in the Space you work in, so its crumbs show only there.
	const projectCrumbs: Crumb[] = project
		? [
				{
					label: project.name,
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
			]
		: [];
	const crumbs: Crumb[] = [
		{ label: "Home", link: { to: "/" } },
		...projectCrumbs,
		{ label: runData.title },
	];

	/** What the run does now, and what went wrong along the way: the end of the story. */
	const ending = (
		<>
			<RunStatusPanel
				// Opens again when the status changes.
				key={status}
				run={runData}
				status={status}
				openGateNodeId={openGate?.nodeId ?? null}
				onShowGate={() => {
					if (openGate) showStep(openGate.id);
				}}
				wait={stream.transcript.lastWait}
				lastStep={lastStep}
				askWhy={
					ask.kind === "hidden" ? undefined : (
						<AskWhyButton runId={runData.id} ask={ask} />
					)
				}
			/>
			<RunLeases run={runData} />
			<RunServices run={runData} />
			<RunWarnings warnings={runData.warnings} onShowStep={showStep} />
		</>
	);

	const storyView = (
		<RunStory
			run={runData}
			steps={steps}
			story={story}
			status={status}
			transcripts={stream.transcript.steps}
			artifacts={artifactList}
			connecting={stream.connection === "connecting"}
			seen={seen}
			pick={pick}
			warnedStepIds={warnedStepIds}
			focus={focus}
			onSelectItem={selectItem}
			onShowStep={showStep}
			stepAction={
				rerunnable
					? (step: StepSummary) => (
							<StepRowMenu runId={runData.id} step={step} />
						)
					: undefined
			}
			stepContext={(step: StepSummary) =>
				step.scope ? (
					<StepContext
						run={runData}
						steps={steps}
						step={step}
						onSelect={selectItem}
					/>
				) : undefined
			}
			ending={ending}
		/>
	);

	const flowSheet = (
		<Sheet open={flowOpen} onOpenChange={setFlowOpen}>
			<SheetContent className="gap-0 data-[side=right]:w-[min(90vw,64rem)] data-[side=right]:sm:max-w-none">
				<SheetHeader className="border-b">
					<SheetTitle>The flow of this run</SheetTitle>
					<SheetDescription>
						Pick a node to show its step in the story.
					</SheetDescription>
				</SheetHeader>
				<div className="relative min-h-0 flex-1 bg-muted/40 dark:bg-muted/20">
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
						routesKey={
							!graphScope && runData.flowName
								? `${runData.projectId}/${runData.flowName}`
								: undefined
						}
						selectedNodeId={graphSelected?.nodeId ?? null}
						onSelectNode={selectNode}
						label={graphScope ? "The flow of the call in focus" : undefined}
						flowLabel={graphFlowName ?? undefined}
					/>
				</div>
			</SheetContent>
		</Sheet>
	);

	const sidebar = (
		<RunSidebar
			run={runData}
			steps={steps}
			artifacts={artifactList}
			onShowStep={showStep}
			className={desktop ? undefined : "w-full border-t border-l-0"}
		/>
	);

	return (
		<>
			<SiteHeader crumbs={crumbs}>
				<RunActions
					key={runData.id}
					run={runData}
					status={status}
					steps={steps}
					onShowStep={showStep}
					onShowFlow={() => setFlowOpen(true)}
				/>
			</SiteHeader>
			<div className="flex flex-1 flex-col lg:h-[calc(100svh-3.5rem)] lg:min-h-0 lg:flex-none">
				<RunTitle run={runData} steps={steps} />
				<div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 pb-3 text-sm lg:px-5">
					<RunBadges
						run={runData}
						status={status}
						reconnecting={stream.connection === "reconnecting"}
					/>
					{focus ? (
						// Inside a call: the way back up to the run's own flow.
						<FocusBreadcrumb
							run={runData}
							steps={steps}
							focus={focus}
							onSelect={selectItem}
						/>
					) : null}
				</div>
				{desktop ? (
					<div className="flex min-h-0 flex-1">
						<div className="flex min-h-0 min-w-0 flex-1 flex-col">
							{storyView}
						</div>
						{sidebar}
					</div>
				) : (
					<div className="flex flex-col">
						<div className="flex h-[80svh] min-h-[28rem] flex-col">
							{storyView}
						</div>
						{sidebar}
					</div>
				)}
				{flowSheet}
			</div>
		</>
	);
}
