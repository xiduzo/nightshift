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
import {
	Card,
	CardAction,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
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
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import { cn } from "@nightshift/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowDownToLineIcon,
	BracesIcon,
	ChevronRightIcon,
	ListTreeIcon,
	MessagesSquareIcon,
	SearchXIcon,
	WorkflowIcon,
	XIcon,
} from "lucide-react";
import {
	Fragment,
	type ReactNode,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";

import { ItemList } from "@/components/run/item-list";
import { ResumeComposer } from "@/components/run/resume-composer";
import { RunGraph } from "@/components/run/run-graph";
import { RunActions, RunHeader } from "@/components/run/run-header";
import { StepHeader, StepOutputs } from "@/components/run/step-header";
import { StepTimeline } from "@/components/run/step-timeline";
import { SubflowDetail } from "@/components/run/subflow-detail";
import { SiteHeader } from "@/components/site-header";
import { StepTranscript } from "@/components/transcript/step-transcript";
import { mergeSteps, useRunStream } from "@/hooks/use-run-stream";
import type { RunDetail, RunStatus, StepSummary } from "@/lib/api-types";
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

const RESUMABLE: RunStatus[] = ["stopped", "failed", "interrupted"];

/** The views of the selected step. */
type DetailTab = "transcript" | "elements" | "called" | "outputs";

const DESKTOP = "(min-width: 1024px)";

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
	/** The view of the step detail; one the step lacks falls back to the transcript. */
	const [tab, setTab] = useState<DetailTab>("transcript");

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
				<div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
					<Skeleton className="h-36 w-full rounded-xl" />
					<div className="grid flex-1 gap-4 lg:grid-cols-[5fr_7fr]">
						<div className="flex flex-col gap-4">
							<Skeleton className="h-64 rounded-xl" />
							<Skeleton className="h-72 rounded-xl" />
						</div>
						<Skeleton className="min-h-96 rounded-xl" />
					</div>
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

	const graphCard = (
		<Card className="h-full gap-0 py-0">
			<CardHeader className="flex min-h-11 items-center gap-2 border-b py-2!">
				<CardTitle className="flex min-w-0 items-center gap-2 text-sm">
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
						<span className="truncate font-mono">
							{runData.flowName ?? "Quick run"}
						</span>
					)}
				</CardTitle>
			</CardHeader>
			<div className="min-h-0 flex-1 bg-muted/20">
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
		</Card>
	);

	const stepsCard = (
		<Card
			role="region"
			aria-labelledby="steps-heading"
			className={cn("gap-0 py-0", desktop && "h-full")}
		>
			<CardHeader className="flex min-h-11 flex-wrap items-center gap-2 border-b py-2!">
				<CardTitle
					id="steps-heading"
					className="flex items-center gap-2 text-sm"
				>
					Steps
					<Badge variant="secondary" className="tabular-nums">
						{visible.length}
					</Badge>
				</CardTitle>
				{focus ? (
					<FocusChip
						steps={steps}
						focus={focus}
						onClear={() => selectItem(null)}
					/>
				) : null}
				{pickedStepId ? (
					<CardAction className="col-start-auto row-span-1 ml-auto self-center">
						<Button
							variant="ghost"
							size="xs"
							title="Follow the latest step as the run walks"
							onClick={() => setPickedStepId(null)}
						>
							<ArrowDownToLineIcon data-icon="inline-start" />
							Follow latest
						</Button>
					</CardAction>
				) : null}
			</CardHeader>
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
		</Card>
	);

	const tabs: DetailTab[] = selectedStep
		? [
				"transcript",
				...(selectedStep.nodeType === "foreach" ? (["elements"] as const) : []),
				...(selectedStep.nodeType === "subflow" ? (["called"] as const) : []),
				"outputs",
			]
		: [];
	const activeTab = tabs.includes(tab) ? tab : "transcript";
	const outputCount = selectedStep
		? Object.keys(selectedStep.outputs).length
		: 0;

	const detailCard = (
		<Card
			role="region"
			aria-label="The selected step"
			className="h-full gap-0 py-0"
		>
			{selectedStep ? (
				<>
					<StepHeader
						step={selectedStep}
						runStatus={status}
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
					<Tabs
						value={activeTab}
						onValueChange={(value) => setTab(value as DetailTab)}
						className="min-h-0 flex-1 gap-0"
					>
						<div className="overflow-x-auto border-b px-3">
							<TabsList variant="line" className="h-10">
								<TabsTrigger value="transcript">
									<MessagesSquareIcon aria-hidden="true" />
									Transcript
								</TabsTrigger>
								{tabs.includes("elements") ? (
									<TabsTrigger value="elements">
										<ListTreeIcon aria-hidden="true" />
										Elements
										<Badge variant="secondary" className="tabular-nums">
											{selectedStep.items.length}
										</Badge>
									</TabsTrigger>
								) : null}
								{tabs.includes("called") ? (
									<TabsTrigger value="called">
										<WorkflowIcon aria-hidden="true" />
										Called flow
									</TabsTrigger>
								) : null}
								<TabsTrigger value="outputs">
									<BracesIcon aria-hidden="true" />
									Outputs
									{outputCount > 0 ? (
										<Badge variant="secondary" className="tabular-nums">
											{outputCount}
										</Badge>
									) : null}
								</TabsTrigger>
							</TabsList>
						</div>
						<TabsContent
							value="transcript"
							className="flex min-h-0 flex-1 flex-col"
						>
							<StepTranscript
								key={selectedStep.id}
								runId={runData.id}
								step={selectedStep}
								transcript={
									stream.transcript.steps.get(selectedStep.id) ??
									emptyTranscript
								}
								connecting={stream.connection === "connecting"}
							/>
						</TabsContent>
						{tabs.includes("elements") ? (
							<TabsContent value="elements" className="min-h-0 flex-1">
								<ScrollArea className="size-full">
									<ItemList
										step={selectedStep}
										steps={steps}
										selectedItem={focus}
										onSelectItem={selectItem}
									/>
								</ScrollArea>
							</TabsContent>
						) : null}
						{tabs.includes("called") ? (
							<TabsContent value="called" className="min-h-0 flex-1">
								<ScrollArea className="size-full">
									<SubflowDetail
										run={runData}
										steps={steps}
										step={selectedStep}
										focused={
											focus?.parentStepId === selectedStep.id &&
											focus.itemId === null
										}
										onFocus={selectItem}
									/>
								</ScrollArea>
							</TabsContent>
						) : null}
						<TabsContent value="outputs" className="min-h-0 flex-1">
							<ScrollArea className="size-full">
								<StepOutputs step={selectedStep} />
							</ScrollArea>
						</TabsContent>
					</Tabs>
				</>
			) : (
				<Empty className="flex-1">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<MessagesSquareIcon />
						</EmptyMedia>
						<EmptyTitle>
							{status === "running" ? "Starting" : "No steps"}
						</EmptyTitle>
						<EmptyDescription>
							{status === "running"
								? "Waiting for the first step…"
								: "This run has no steps."}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
			{RESUMABLE.includes(status) ? (
				<ResumeComposer runId={runData.id} lastStep={lastStep} />
			) : null}
		</Card>
	);

	return (
		<>
			<SiteHeader
				crumbs={[
					{ label: "Home", link: { to: "/" } },
					{
						label: project?.name ?? "Project",
						link: {
							to: "/projects/$projectId",
							params: { projectId: runData.projectId },
						},
					},
					{ label: runData.title },
				]}
			>
				<RunActions run={runData} status={status} />
			</SiteHeader>
			<div className="flex flex-1 flex-col gap-4 p-4 md:p-6 lg:h-[calc(100svh-3.5rem)] lg:min-h-0 lg:flex-none">
				<RunHeader
					run={runData}
					status={status}
					reconnecting={stream.connection === "reconnecting"}
					openGateNodeId={openGate?.nodeId ?? null}
					onShowGate={() => {
						if (!openGate) return;
						setFocus(null);
						setPickedStepId(openGate.id);
						setTab("transcript");
					}}
					wait={stream.transcript.lastWait}
				/>
				{desktop ? (
					<ResizablePanelGroup
						orientation="horizontal"
						className="min-h-[28rem] flex-1"
					>
						<ResizablePanel defaultSize="42%" minSize="28%" className="p-px">
							<ResizablePanelGroup orientation="vertical">
								<ResizablePanel
									defaultSize="45%"
									minSize="20%"
									className="p-px"
								>
									{graphCard}
								</ResizablePanel>
								<ResizableHandle withHandle className="my-1.5 bg-transparent" />
								<ResizablePanel
									defaultSize="55%"
									minSize="20%"
									className="p-px"
								>
									{stepsCard}
								</ResizablePanel>
							</ResizablePanelGroup>
						</ResizablePanel>
						<ResizableHandle withHandle className="mx-1.5 bg-transparent" />
						<ResizablePanel defaultSize="58%" minSize="35%" className="p-px">
							{detailCard}
						</ResizablePanel>
					</ResizablePanelGroup>
				) : (
					<div className="flex flex-col gap-4">
						<div className="h-72">{graphCard}</div>
						{stepsCard}
						<div className="h-[85svh] min-h-[32rem]">{detailCard}</div>
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
