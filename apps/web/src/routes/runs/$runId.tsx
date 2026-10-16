import { Badge } from "@nightshift/ui/components/badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@nightshift/ui/components/breadcrumb";
import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
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
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowDownToLineIcon,
	ChevronRightIcon,
	SearchXIcon,
	WorkflowIcon,
	XIcon,
} from "lucide-react";
import {
	type ComponentProps,
	Fragment,
	type ReactNode,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { RunGraph } from "@/components/run/run-graph";
import { RunActions, RunDetails, RunTitle } from "@/components/run/run-header";
import { RunStatusPanel } from "@/components/run/run-status-panel";
import { CONSOLE_BAR_PX, StepConsole } from "@/components/run/step-console";
import { StepSummary as StepSummaryView } from "@/components/run/step-summary";
import { StepTimeline } from "@/components/run/step-timeline";
import { type Crumb, SiteHeader } from "@/components/site-header";
import { StepTranscript } from "@/components/transcript/step-transcript";
import { mergeSteps, useRunStream } from "@/hooks/use-run-stream";
import type { RunDetail, StepSummary } from "@/lib/api-types";
import {
	calledFlowName,
	calledFlowOf,
	derivedTraversals,
	type ItemScope,
	itemsOf,
	scopeChain,
	stepAtScope,
	stepsIn,
	stepsUnder,
} from "@/lib/run-steps";
import { emptyTranscript } from "@/lib/transcript";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/runs/$runId")({
	// The transcript streams from the browser; nothing to render on the server.
	ssr: false,
	component: RunComponent,
});

const DESKTOP = "(min-width: 1024px)";

/** The closed console's panel: its bar, and the gaps above and below its card. */
const CONSOLE_CLOSED_PX = CONSOLE_BAR_PX + 8 + 16;

/** The imperative handle of a resizable panel: collapse, expand, resize. */
type PanelHandle = NonNullable<
	Extract<
		NonNullable<ComponentProps<typeof ResizablePanel>["panelRef"]>,
		{ current: unknown }
	>["current"]
>;

/** Whether a media query matches, following changes. The route renders in the browser only. */
function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		() => window.matchMedia(query).matches,
		() => false,
	);
}

/**
 * A run: its steps and the flow behind them fill the page. The selected step
 * sits in a console along the bottom: one line, or open on its summary,
 * transcript and outputs. The run's facts open from the header.
 */
function RunComponent() {
	const { runId } = Route.useParams();
	const run = useQuery(orpc.runs.get.queryOptions({ input: { runId } }));
	const projects = useQuery(orpc.projects.list.queryOptions());
	const stream = useRunStream(runId);
	const desktop = useMediaQuery(DESKTOP);
	/** Null follows the latest step as the run walks. */
	const [pickedStepId, setPickedStepId] = useState<string | null>(null);
	/** The call in focus (a Subflow step or a For Each element): the steps and the graph narrow to it. */
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
					<Empty className="flex-1 border">
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

	// The newest step of a gate without an outcome is the one the run waits at.
	const openGate =
		status === "waiting"
			? [...steps]
					.reverse()
					.find((step) => step.nodeType === "gate" && step.outcome === null)
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
		</section>
	);

	const stepConsole = (
		<StepConsole
			step={selectedStep}
			runStatus={status}
			open={consoleOpen}
			onOpenChange={showConsole}
			empty={status === "running" ? "Waiting for the first step…" : "No steps."}
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
					/>
				) : null
			}
		/>
	);

	return (
		<>
			<SiteHeader crumbs={crumbs}>
				<RunActions run={runData} status={status} />
				<RunDetails run={runData} />
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

/** One crumb per call, from the run's flow down to the call in focus. */
function useCrumbs(
	run: RunDetail,
	steps: StepSummary[],
	focus: ItemScope,
): { key: string; label: ReactNode; scope: ItemScope }[] {
	const crumbs: { key: string; label: ReactNode; scope: ItemScope }[] = [
		{
			key: "top",
			label: <span className="font-mono">{run.flowName ?? "Run"}</span>,
			scope: null,
		},
	];
	for (const { parentStep, itemId } of scopeChain(steps, focus)) {
		const called = calledFlowName(run, steps, parentStep);
		const item =
			itemId === null
				? undefined
				: itemsOf(parentStep, steps).find((one) => one.id === itemId);
		crumbs.push({
			key: `${parentStep.id}:${itemId ?? ""}`,
			label: (
				<>
					<span className="font-mono text-muted-foreground">
						{parentStep.nodeId} ·
					</span>{" "}
					{itemId === null ? (
						<span className="font-mono">{called ?? "called flow"}</span>
					) : (
						<>
							{item?.title ?? itemId}
							{called ? (
								<span className="font-mono text-muted-foreground">
									{" "}
									· {called}
								</span>
							) : null}
						</>
					)}
				</>
			),
			scope: { parentStepId: parentStep.id, itemId },
		});
	}
	return crumbs;
}

/** Over the graph: where the called flow sits, with a way back up. */
function FocusBreadcrumb({
	run,
	steps,
	focus,
	onSelect,
}: {
	run: RunDetail;
	steps: StepSummary[];
	focus: ItemScope;
	onSelect: (scope: ItemScope) => void;
}) {
	const crumbs = useCrumbs(run, steps, focus);
	return (
		<Breadcrumb aria-label="Where in the run" className="min-w-0">
			<BreadcrumbList className="flex-nowrap gap-1 text-xs sm:gap-1.5">
				{crumbs.map((crumb, index) => (
					<Fragment key={crumb.key}>
						{index > 0 ? <BreadcrumbSeparator /> : null}
						<BreadcrumbItem
							className={index === crumbs.length - 1 ? "min-w-0" : "shrink-0"}
						>
							{index === crumbs.length - 1 ? (
								<BreadcrumbPage
									aria-current="location"
									className="truncate font-normal"
								>
									{crumb.label}
								</BreadcrumbPage>
							) : (
								<BreadcrumbLink
									render={
										<button
											type="button"
											className="rounded-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
											onClick={() => onSelect(crumb.scope)}
										/>
									}
								>
									{crumb.label}
								</BreadcrumbLink>
							)}
						</BreadcrumbItem>
					</Fragment>
				))}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

/** Above the step list: which call it shows, and a way back to the whole run. */
function FocusChip({
	steps,
	focus,
	onClear,
}: {
	steps: StepSummary[];
	focus: NonNullable<ItemScope>;
	onClear: () => void;
}) {
	const parentStep = steps.find((step) => step.id === focus.parentStepId);
	const item =
		parentStep && focus.itemId !== null
			? itemsOf(parentStep, steps).find((one) => one.id === focus.itemId)
			: undefined;
	return (
		<Badge variant="outline" className="h-6 min-w-0 max-w-56 gap-1 pr-0.5">
			<span className="min-w-0 truncate">
				{focus.itemId === null
					? `${parentStep?.nodeId ?? "call"}`
					: (item?.title ?? focus.itemId)}
			</span>
			<Button
				variant="ghost"
				size="icon-xs"
				className="size-5 rounded-full"
				onClick={onClear}
				aria-label="Show all"
				title="Show all"
			>
				<XIcon />
			</Button>
		</Badge>
	);
}

/** For a step in a called flow: the calls it ran under. Clicking one focuses it. */
function StepContext({
	run,
	steps,
	step,
	onSelect,
}: {
	run: RunDetail;
	steps: StepSummary[];
	step: StepSummary;
	onSelect: (scope: ItemScope) => void;
}) {
	const crumbs = useCrumbs(run, steps, step.scope).slice(1);
	return (
		<div className="flex min-w-0 items-baseline gap-1.5">
			<span className="shrink-0">In</span>
			<Breadcrumb
				aria-label="The calls this step ran under"
				className="min-w-0"
			>
				<BreadcrumbList className="gap-1 text-xs sm:gap-1.5">
					{crumbs.map((crumb, index) => (
						<BreadcrumbItem key={crumb.key} className="min-w-0">
							{index > 0 ? (
								<ChevronRightIcon
									className="size-3.5 shrink-0"
									aria-hidden="true"
								/>
							) : null}
							<BreadcrumbLink
								render={
									<button
										type="button"
										title="Focus on this call"
										className="min-w-0 truncate rounded-sm text-left text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
										onClick={() => onSelect(crumb.scope)}
									/>
								}
							>
								{crumb.label}
							</BreadcrumbLink>
						</BreadcrumbItem>
					))}
				</BreadcrumbList>
			</Breadcrumb>
		</div>
	);
}
