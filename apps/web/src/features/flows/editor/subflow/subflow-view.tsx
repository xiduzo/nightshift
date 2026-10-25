import type { Flow } from "@nightshift/flows";
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
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Kbd } from "@nightshift/ui/components/kbd";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import {
	Background,
	BackgroundVariant,
	ReactFlow,
	ReactFlowProvider,
	useNodesInitialized,
	useReactFlow,
} from "@xyflow/react";
import {
	ArrowUpIcon,
	EyeIcon,
	FileWarningIcon,
	RepeatIcon,
	SearchXIcon,
	SquarePenIcon,
} from "lucide-react";
import {
	Fragment,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { FlowCanvasNode } from "../../canvas/flow-node";
import { EnterSubflowContext } from "../../canvas/open-flow-context";
import {
	canvasEdges,
	edgeTypes,
	type FlowCanvasEdge,
	OutcomeMarkers,
} from "../../canvas/outcome-edge";
import {
	type CanvasNode,
	canvasNodeTypes,
	SectionActionsContext,
} from "../../canvas/sections/section-nodes";
import {
	useFoldedSections,
	useSectionCanvas,
} from "../../canvas/sections/use-section-canvas";
import { useMeasured } from "../../canvas/use-measured";
import { CanvasControls } from "../canvas-controls";
import {
	type SubflowStack,
	type SubflowViewport,
	subflowContent,
	subflowCrumbs,
} from "./subflow-stack";
import { readSubflowKey } from "./use-subflow-stack";

const FIT = { maxZoom: 1, padding: 0.15 } as const;

/**
 * The flow a Subflow runs, shown in place of the editor's canvas, read only.
 * A breadcrumb leads back up, and a button opens the flow's own editor.
 */
export function SubflowView({
	projectId,
	rootFlow,
	stack,
	flows,
	onEnter,
	onGoTo,
	onEdit,
	className,
}: {
	/** For the Sections this browser keeps folded in each flow. */
	projectId: string;
	/** The flow open in the editor. */
	rootFlow: string;
	/** At least one level. */
	stack: SubflowStack;
	/** The project's other flow files, by name. Null for a file that is not valid. */
	flows: Readonly<Record<string, Flow | null>> | undefined;
	onEnter: (nodeId: string, flow: string, viewport: SubflowViewport) => void;
	/** Back up to this many levels below the editor's flow. */
	onGoTo: (depth: number) => void;
	/** Opens the editor of this flow. */
	onEdit: (flow: string) => void;
	className?: string;
}) {
	const current = stack.at(-1);
	const content = subflowContent(rootFlow, stack, flows);
	if (!current || !content) return null;
	const depth = stack.length;
	const above = stack.at(-2)?.flow ?? rootFlow;
	const goUp = () => onGoTo(depth - 1);

	return (
		// Opaque, so the editor's canvas under it does not show through.
		<div className={cn("absolute inset-0 bg-background", className)}>
			<div className="absolute inset-0 bg-muted/40 dark:bg-muted/20">
				{content.kind === "flow" ? (
					<ReactFlowProvider key={`${depth}:${current.flow}`}>
						<ReadOnlyCanvas
							flow={content.flow}
							name={current.flow}
							foldKey={`${projectId}/${current.flow}`}
							viewport={current.viewport}
							onEnter={onEnter}
						/>
					</ReactFlowProvider>
				) : content.kind === "loading" ? (
					<div className="flex size-full items-center justify-center">
						<Spinner className="size-6 text-muted-foreground" />
						<span className="sr-only">Loading {current.flow}</span>
					</div>
				) : (
					<SubflowProblem
						kind={content.kind}
						flow={current.flow}
						nodeId={current.nodeId}
						above={above}
						onGoUp={goUp}
						onEdit={onEdit}
					/>
				)}
			</div>

			<Card
				size="sm"
				className="absolute top-3 left-3 max-w-[calc(100%-1.5rem)] gap-2 px-3 py-2 shadow-sm"
			>
				<SubflowBreadcrumb rootFlow={rootFlow} stack={stack} onGoTo={onGoTo} />
				<div className="flex flex-wrap items-center gap-1.5">
					<Badge variant="outline" className="text-muted-foreground">
						<EyeIcon aria-hidden="true" />
						Read only
					</Badge>
					<Tooltip>
						<TooltipTrigger
							render={<Button variant="ghost" size="xs" onClick={goUp} />}
						>
							<ArrowUpIcon data-icon="inline-start" />
							Go up
						</TooltipTrigger>
						<TooltipContent side="bottom">
							Back to {above}
							<Kbd>U</Kbd>
						</TooltipContent>
					</Tooltip>
					{content.kind === "flow" || content.kind === "invalid" ? (
						<Button
							variant="outline"
							size="xs"
							onClick={() => onEdit(current.flow)}
						>
							<SquarePenIcon data-icon="inline-start" />
							Edit {current.flow}
						</Button>
					) : null}
				</div>
			</Card>
		</div>
	);
}

/** From the editor's flow down to the one on the canvas, like the run page shows calls. */
function SubflowBreadcrumb({
	rootFlow,
	stack,
	onGoTo,
}: {
	rootFlow: string;
	stack: SubflowStack;
	onGoTo: (depth: number) => void;
}) {
	const crumbs = subflowCrumbs(rootFlow, stack);
	return (
		<Breadcrumb aria-label="Where in the flow" className="min-w-0">
			<BreadcrumbList className="flex-nowrap gap-1 text-xs sm:gap-1.5">
				{crumbs.map((crumb, index) => {
					const last = index === crumbs.length - 1;
					const label =
						crumb.nodeId === null ? (
							<span className="font-mono">{crumb.flow}</span>
						) : (
							<>
								<span className="font-mono text-muted-foreground">
									{crumb.nodeId} ·
								</span>{" "}
								<span className="font-mono">{crumb.flow}</span>
							</>
						);
					return (
						<Fragment key={crumb.depth}>
							{index > 0 ? <BreadcrumbSeparator /> : null}
							<BreadcrumbItem className={last ? "min-w-0" : "shrink-0"}>
								{last ? (
									<BreadcrumbPage
										aria-current="location"
										className="truncate font-normal"
									>
										{label}
									</BreadcrumbPage>
								) : (
									<BreadcrumbLink
										render={
											<button
												type="button"
												className="rounded-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
												onClick={() => onGoTo(crumb.depth)}
											/>
										}
									>
										{label}
									</BreadcrumbLink>
								)}
							</BreadcrumbItem>
						</Fragment>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

const PROBLEM = {
	missing: {
		icon: SearchXIcon,
		title: (flow: ReactNode) => <>{flow} is not in this project</>,
		description: (_flow: string, nodeId: string, above: string) =>
			`The Subflow ${nodeId} runs a flow that does not exist. Go up to ${above} and pick another flow.`,
	},
	invalid: {
		icon: FileWarningIcon,
		title: (flow: ReactNode) => <>{flow} is not valid</>,
		description: (flow: string) =>
			`Night Shift cannot show this flow. Edit ${flow} to see its problems and fix them.`,
	},
	cycle: {
		icon: RepeatIcon,
		title: (flow: ReactNode) => <>{flow} is open above already</>,
		description: (_flow: string, nodeId: string, above: string) =>
			`The Subflow ${nodeId} runs a flow that contains it. A flow cannot contain itself. Pick another flow in ${above}.`,
	},
} as const;

/** In place of the canvas: why the flow does not show, and the way out. */
function SubflowProblem({
	kind,
	flow,
	nodeId,
	above,
	onGoUp,
	onEdit,
}: {
	kind: keyof typeof PROBLEM;
	flow: string;
	nodeId: string;
	above: string;
	onGoUp: () => void;
	onEdit: (flow: string) => void;
}) {
	const problem = PROBLEM[kind];
	const Icon = problem.icon;
	return (
		<div className="flex size-full items-center justify-center p-4">
			<Card className="w-full max-w-md">
				<CardContent>
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Icon />
							</EmptyMedia>
							<EmptyTitle className="wrap-anywhere">
								{problem.title(<span className="font-mono">{flow}</span>)}
							</EmptyTitle>
							<EmptyDescription>
								{problem.description(flow, nodeId, above)}
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<div className="flex flex-wrap justify-center gap-2">
								<Button variant="outline" onClick={onGoUp}>
									<ArrowUpIcon data-icon="inline-start" />
									Go up
								</Button>
								{kind === "invalid" ? (
									<Button onClick={() => onEdit(flow)}>
										<SquarePenIcon data-icon="inline-start" />
										Edit {flow}
									</Button>
								) : null}
							</div>
						</EmptyContent>
					</Empty>
				</CardContent>
			</Card>
		</div>
	);
}

/**
 * One flow, read only: no drag, no connect, no delete. The same nodes,
 * edges and Section frames as the editor. Its Sections fold as in that
 * flow's own editor: the fold is per browser, not a change of the flow. A Subflow in it opens deeper: click its flow name,
 * double-click the node, or select it and press `i`.
 */
function ReadOnlyCanvas({
	flow,
	name,
	foldKey,
	viewport,
	onEnter,
}: {
	flow: Flow;
	name: string;
	foldKey: string;
	/** Where this canvas looked before: restored instead of a fit. */
	viewport: SubflowViewport | undefined;
	onEnter: (nodeId: string, flow: string, viewport: SubflowViewport) => void;
}) {
	const [measured, applyDimensions] = useMeasured();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const { getViewport, fitView } = useReactFlow();

	const enter = useCallback(
		(nodeId: string, calledFlow: string) => {
			if (calledFlow === "") return;
			onEnter(nodeId, calledFlow, getViewport());
		},
		[onEnter, getViewport],
	);

	// Fit once more when every node has its size, as the editor does. Not
	// when coming back up: then the canvas looks where it looked before.
	const initialized = useNodesInitialized();
	const [fitted, setFitted] = useState(viewport !== undefined);
	useEffect(() => {
		if (!initialized || fitted) return;
		setFitted(true);
		const frame = requestAnimationFrame(() => void fitView(FIT));
		return () => cancelAnimationFrame(frame);
	}, [initialized, fitted, fitView]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (readSubflowKey(event) !== "in") return;
			const node = flow.nodes.find((candidate) => candidate.id === selectedId);
			if (node?.type !== "call" || node.flow === "") return;
			event.preventDefault();
			enter(node.id, node.flow);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [flow.nodes, selectedId, enter]);

	const { folded, setFolded } = useFoldedSections(foldKey);
	const sections = useSectionCanvas(flow, {
		folded,
		measured,
		editable: false,
	});
	const sectionActions = useMemo(() => ({ setFolded }), [setFolded]);

	const nodes = useMemo<CanvasNode[]>(
		() => [
			...sections.frames,
			...flow.nodes.flatMap((node): FlowCanvasNode[] =>
				sections.hidden.has(node.id)
					? []
					: [
							{
								id: node.id,
								type: node.type,
								position: node.position,
								measured: measured[node.id],
								selected: node.id === selectedId,
								draggable: false,
								connectable: false,
								deletable: false,
								data: { node, isStart: flow.start === node.id, issues: [] },
							},
						],
			),
			...sections.boxes,
		],
		[flow.nodes, flow.start, measured, selectedId, sections],
	);

	// The called flow draws its edges as plain step paths: its layout routes
	// belong to its own editor.
	const edges = useMemo<FlowCanvasEdge[]>(
		() =>
			canvasEdges(flow, sections.groups, {
				boxes: sections.boxPositions,
			}).map((edge) => ({
				...edge,
				selectable: false,
				focusable: false,
				deletable: false,
			})),
		[flow, sections.groups, sections.boxPositions],
	);

	return (
		<EnterSubflowContext.Provider value={enter}>
			<SectionActionsContext.Provider value={sectionActions}>
				<OutcomeMarkers />
				<ReactFlow<CanvasNode, FlowCanvasEdge>
					nodes={nodes}
					edges={edges}
					nodeTypes={canvasNodeTypes}
					edgeTypes={edgeTypes}
					onNodesChange={applyDimensions}
					onNodeClick={(_, node) => setSelectedId(node.id)}
					onNodeDoubleClick={(_, canvasNode) => {
						if (
							canvasNode.type === "sectionFrame" ||
							canvasNode.type === "sectionBox"
						)
							return;
						const { node } = canvasNode.data;
						if (node.type === "call") enter(node.id, node.flow);
					}}
					onPaneClick={() => setSelectedId(null)}
					nodesDraggable={false}
					nodesConnectable={false}
					edgesFocusable={false}
					deleteKeyCode={null}
					selectionKeyCode={null}
					multiSelectionKeyCode={null}
					zoomOnDoubleClick={false}
					fitView={viewport === undefined}
					fitViewOptions={FIT}
					defaultViewport={viewport}
					minZoom={0.2}
					className="[--xy-background-color:transparent]"
					aria-label={`Flow ${name}, read only`}
				>
					<Background
						variant={BackgroundVariant.Dots}
						gap={16}
						size={1.25}
						color="color-mix(in oklch, var(--foreground) 16%, transparent)"
					/>
					<CanvasControls />
				</ReactFlow>
			</SectionActionsContext.Provider>
		</EnterSubflowContext.Provider>
	);
}
