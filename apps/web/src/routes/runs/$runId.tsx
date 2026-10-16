import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";

import { ItemList } from "@/components/run/item-list";
import { ResumeComposer } from "@/components/run/resume-composer";
import { RunGraph } from "@/components/run/run-graph";
import { RunHeader } from "@/components/run/run-header";
import { StepHeader } from "@/components/run/step-header";
import { StepTimeline } from "@/components/run/step-timeline";
import { SubflowDetail } from "@/components/run/subflow-detail";
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

function RunComponent() {
	const { runId } = Route.useParams();
	const run = useQuery(orpc.runs.get.queryOptions({ input: { runId } }));
	const stream = useRunStream(runId);
	/** Null follows the latest step as the run walks. */
	const [pickedStepId, setPickedStepId] = useState<string | null>(null);
	/** The call in focus (a Subflow step or a For Each element): the steps and the graph narrow to it. */
	const [focus, setFocus] = useState<ItemScope>(null);

	const steps = useMemo(
		() => mergeSteps(run.data?.steps ?? [], stream.steps),
		[run.data?.steps, stream.steps],
	);

	if (run.isLoading) {
		return (
			<main className="flex flex-col gap-3 px-4 py-4">
				<Skeleton className="h-5 w-64" />
				<Skeleton className="h-4 w-full max-w-2xl" />
				<Skeleton className="h-40 w-full" />
			</main>
		);
	}

	if (!run.data) {
		return (
			<main className="px-4 py-6">
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>Run not available</EmptyTitle>
						<EmptyDescription>
							{run.error?.message ?? "This run does not exist."}{" "}
							<Link to="/">Back to projects</Link>
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</main>
		);
	}

	// The stream reports a status change before the refetched run arrives.
	const status = stream.status ?? run.data.status;
	const runData = run.data;
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

	const breadcrumb = graphScope ? (
		<FocusBreadcrumb
			run={runData}
			steps={steps}
			focus={graphScope}
			onSelect={selectItem}
		/>
	) : null;

	return (
		<main className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
			<RunHeader
				run={run.data}
				status={status}
				reconnecting={stream.connection === "reconnecting"}
				openGateNodeId={openGate?.nodeId ?? null}
				onShowGate={() => {
					if (!openGate) return;
					setFocus(null);
					setPickedStepId(openGate.id);
				}}
				wait={stream.transcript.lastWait}
			/>
			<div className="grid min-h-0 auto-rows-max grid-cols-[minmax(0,1fr)] overflow-y-auto lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
				<div className="grid min-h-0 grid-rows-[18rem_auto] border-b lg:grid-rows-[minmax(18rem,1fr)_auto] lg:border-r lg:border-b-0">
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
						breadcrumb={breadcrumb}
						label={graphScope ? "The flow of the call in focus" : undefined}
					/>
					<section
						aria-labelledby="steps-heading"
						className="flex max-h-72 min-h-0 flex-col border-t lg:max-h-[45vh]"
					>
						<header className="flex items-center gap-2 px-3 py-2">
							<h2 id="steps-heading" className="font-medium text-xs">
								Steps
							</h2>
							<span className="text-muted-foreground text-xs">
								{visible.length}
							</span>
							{focus ? (
								<FocusChip
									steps={steps}
									focus={focus}
									onClear={() => selectItem(null)}
								/>
							) : null}
							{pickedStepId ? (
								<button
									type="button"
									className="ml-auto text-muted-foreground text-xs underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
									onClick={() => setPickedStepId(null)}
								>
									Follow the latest step
								</button>
							) : null}
						</header>
						<div className="min-h-0 overflow-y-auto">
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
						</div>
					</section>
				</div>
				<div
					className={
						selectedStep?.nodeType === "foreach" ||
						selectedStep?.nodeType === "subflow"
							? "grid h-[75vh] grid-rows-[auto_auto_1fr_auto] lg:h-auto lg:min-h-0"
							: "grid h-[75vh] grid-rows-[auto_1fr_auto] lg:h-auto lg:min-h-0"
					}
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
							{selectedStep.nodeType === "foreach" ? (
								<ItemList
									step={selectedStep}
									steps={steps}
									selectedItem={focus}
									onSelectItem={selectItem}
								/>
							) : null}
							{selectedStep.nodeType === "subflow" ? (
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
							) : null}
							<StepTranscript
								key={selectedStep.id}
								runId={run.data.id}
								step={selectedStep}
								transcript={
									stream.transcript.steps.get(selectedStep.id) ??
									emptyTranscript
								}
								connecting={stream.connection === "connecting"}
							/>
						</>
					) : (
						<p className="row-span-2 px-4 py-8 text-center text-muted-foreground text-xs">
							{status === "running"
								? "Waiting for the first step…"
								: "This run has no steps."}
						</p>
					)}
					{RESUMABLE.includes(status) ? (
						<ResumeComposer runId={run.data.id} lastStep={lastStep} />
					) : null}
				</div>
			</div>
		</main>
	);
}

/** One crumb per call, from the run's flow down to the call in focus. */
function useCrumbs(
	run: RunDetail,
	steps: StepSummary[],
	focus: ItemScope,
): { key: string; label: ReactNode; scope: ItemScope }[] {
	const crumbs: { key: string; label: ReactNode; scope: ItemScope }[] = [
		{ key: "top", label: run.flowName ?? "Run", scope: null },
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
					<span className="text-muted-foreground">{parentStep.nodeId} ·</span>{" "}
					{itemId === null ? (
						<span className="font-mono">{called ?? "called flow"}</span>
					) : (
						<>
							{item?.title ?? itemId}
							{called ? (
								<span className="text-muted-foreground"> · {called}</span>
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
		<nav
			aria-label="Where in the run"
			className="flex max-w-[calc(100vw-2rem)] items-center gap-1 border bg-card px-2 py-1 text-xs shadow-xs lg:max-w-md"
		>
			{crumbs.map((crumb, index) => (
				<Fragment key={crumb.key}>
					{index > 0 ? (
						<ChevronRightIcon
							className="size-3 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					) : null}
					{index === crumbs.length - 1 ? (
						<span aria-current="location" className="min-w-0 truncate">
							{crumb.label}
						</span>
					) : (
						<button
							type="button"
							className="shrink-0 font-mono underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
							onClick={() => onSelect(crumb.scope)}
						>
							{crumb.label}
						</button>
					)}
				</Fragment>
			))}
		</nav>
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
		<span className="flex min-w-0 items-center gap-1 border bg-muted px-1.5 text-xs">
			<span className="min-w-0 truncate">
				{focus.itemId === null
					? `${parentStep?.nodeId ?? "call"}`
					: (item?.title ?? focus.itemId)}
			</span>
			<button
				type="button"
				onClick={onClear}
				className="shrink-0 text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
			>
				Show all
			</button>
		</span>
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
		<span className="flex flex-wrap items-center gap-1">
			In
			{crumbs.map((crumb, index) => (
				<Fragment key={crumb.key}>
					{index > 0 ? (
						<ChevronRightIcon className="size-3" aria-hidden="true" />
					) : null}
					<button
						type="button"
						className="text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
						title="Focus on this call"
						onClick={() => onSelect(crumb.scope)}
					>
						{crumb.label}
					</button>
				</Fragment>
			))}
		</span>
	);
}
