import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@nightshift/ui/components/input-group";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import {
	Background,
	type Edge,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import { CircleAlertIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadElk } from "@/features/flows";
import type { KnowledgeGraph } from "@/shared/api";
import {
	type GraphKind,
	type GraphNode,
	KIND_ICON,
	KIND_NAME,
	type MapNode,
	type MapNodeData,
	mapEdge,
	mapNodeTypes,
} from "./map-node";
import { knowledgeQueries } from "./queries";
import { useKnowledgeHits } from "./use-knowledge-hits";

const KINDS: GraphKind[] = ["file", "topic", "question", "learning"];

/** About how wide a node is, before it is measured, in px. */
function nodeWidth(label: string): number {
	return Math.min(208, 40 + label.length * 6.5);
}

/** Where each node goes: a stress layout keeps connected nodes close. */
async function layoutOf(
	nodes: GraphNode[],
	edges: KnowledgeGraph["edges"],
): Promise<Map<string, { x: number; y: number }>> {
	const layout = await loadElk();
	const laid = await layout({
		id: "root",
		layoutOptions: {
			"elk.algorithm": "stress",
			"elk.stress.desiredEdgeLength": "150",
			"elk.spacing.nodeNode": "40",
		},
		children: nodes.map((node) => ({
			id: node.id,
			width: nodeWidth(node.label),
			height: 28,
		})),
		edges: edges.map((edge) => ({
			id: edge.id,
			sources: [edge.source],
			targets: [edge.target],
		})),
	});
	return new Map(
		(laid.children ?? []).map((child) => [
			child.id,
			{ x: child.x ?? 0, y: child.y ?? 0 },
		]),
	);
}

/** The nodes in a circle, for when the layout does not load. */
function circleOf(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
	const radius = Math.max(200, nodes.length * 30);
	return new Map(
		nodes.map((node, index) => {
			const angle = (index / nodes.length) * 2 * Math.PI;
			return [
				node.id,
				{ x: radius * Math.cos(angle), y: radius * Math.sin(angle) },
			];
		}),
	);
}

/**
 * The knowledge as a map: its files, the topics they share, the questions that
 * found them and the learnings that name their topics. Search shows what an
 * agent would find. A node shows what it connects to.
 */
export function MapTab({
	projectId,
	focus,
	onOpenFile,
	onReview,
}: {
	projectId: string;
	/** The node to start from. */
	focus: string | null;
	onOpenFile: (path: string) => void;
	onReview: (learningId: string) => void;
}) {
	const graph = useQuery(knowledgeQueries.graph(projectId));
	if (graph.error) {
		return (
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertTitle>The map did not load</AlertTitle>
				<AlertDescription>{graph.error.message}</AlertDescription>
			</Alert>
		);
	}
	if (!graph.data) return <Skeleton className="h-96 w-full" />;
	if (graph.data.nodes.length === 0) {
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyTitle>Nothing to map yet</EmptyTitle>
					<EmptyDescription>
						Add a source. Its files show here, with the topics they share.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	return (
		<ReactFlowProvider>
			<MapView
				projectId={projectId}
				graph={graph.data}
				focus={focus}
				onOpenFile={onOpenFile}
				onReview={onReview}
			/>
		</ReactFlowProvider>
	);
}

function MapView({
	projectId,
	graph,
	focus,
	onOpenFile,
	onReview,
}: {
	projectId: string;
	graph: KnowledgeGraph;
	focus: string | null;
	onOpenFile: (path: string) => void;
	onReview: (learningId: string) => void;
}) {
	const [kinds, setKinds] = useState<string[]>(KINDS);
	const [picked, setPicked] = useState<string | null>(focus);
	const [positions, setPositions] = useState<Map<
		string,
		{ x: number; y: number }
	> | null>(null);
	const { text, setText, query, hits } = useKnowledgeHits(projectId);
	const flow = useReactFlow();

	useEffect(() => setPicked(focus), [focus]);

	const visible = useMemo(() => {
		const nodes = graph.nodes.filter((node) => kinds.includes(node.kind));
		const ids = new Set(nodes.map((node) => node.id));
		return {
			nodes,
			edges: graph.edges.filter(
				(edge) => ids.has(edge.source) && ids.has(edge.target),
			),
		};
	}, [graph, kinds]);

	useEffect(() => {
		let current = true;
		layoutOf(visible.nodes, visible.edges)
			.catch((error: unknown) => {
				console.warn("The map layout did not load:", error);
				return circleOf(visible.nodes);
			})
			.then((next) => {
				if (current) setPositions(next);
			});
		return () => {
			current = false;
		};
	}, [visible]);

	const selected =
		picked && visible.nodes.some((node) => node.id === picked) ? picked : null;

	const neighbours = useMemo(() => {
		if (!selected) return null;
		const near = new Set([selected]);
		for (const edge of visible.edges) {
			if (edge.source === selected) near.add(edge.target);
			if (edge.target === selected) near.add(edge.source);
		}
		return near;
	}, [selected, visible.edges]);

	// The view follows a new layout and the node to start from, once placed.
	useEffect(() => {
		if (!positions) return;
		const around =
			focus && positions.has(focus)
				? visible.edges
						.flatMap((edge) =>
							edge.source === focus
								? [edge.target]
								: edge.target === focus
									? [edge.source]
									: [],
						)
						.concat(focus)
						.map((id) => ({ id }))
				: undefined;
		const frame = requestAnimationFrame(() => {
			void flow.fitView({
				...(around ? { nodes: around, maxZoom: 1.2 } : {}),
				padding: around ? 0.3 : 0.1,
				duration: 300,
			});
		});
		return () => cancelAnimationFrame(frame);
	}, [positions, focus, visible.edges, flow]);

	const lit = useMemo(
		() =>
			query === "" || !hits.data
				? null
				: new Set(hits.data.map((hit) => `file:${hit.path}`)),
		[query, hits.data],
	);

	const stateOf = (id: string): MapNodeData["state"] => {
		if (id === selected) return "selected";
		if (neighbours) return neighbours.has(id) ? "normal" : "dim";
		if (lit) return lit.has(id) ? "lit" : "dim";
		return "normal";
	};

	const nodes: MapNode[] = visible.nodes.map((node) => ({
		id: node.id,
		type: "map",
		position: positions?.get(node.id) ?? { x: 0, y: 0 },
		data: { node, state: stateOf(node.id) },
	}));
	const edges: Edge[] = visible.edges.map((edge) =>
		mapEdge(
			edge,
			neighbours
				? !(edge.source === selected || edge.target === selected)
				: lit !== null,
		),
	);
	const chosen = graph.nodes.find((node) => node.id === selected);

	return (
		<div className="flex flex-col gap-4">
			{graph.filesLeftOut > 0 ? (
				<Alert>
					<TriangleAlertIcon />
					<AlertTitle>This map leaves out some topics</AlertTitle>
					<AlertDescription>
						Night Shift did not read {graph.filesLeftOut} of the files for
						topics, because the knowledge is so large. Sync only what your
						agents need.
					</AlertDescription>
				</Alert>
			) : null}
			<div className="flex flex-wrap items-center gap-3">
				<InputGroup className="w-80 max-w-full">
					<InputGroupAddon>
						<SearchIcon aria-hidden="true" />
					</InputGroupAddon>
					<InputGroupInput
						type="text"
						value={text}
						onChange={(event) => {
							setPicked(null);
							setText(event.target.value);
						}}
						placeholder="Show what an agent would find"
						aria-label="Show what an agent would find"
					/>
				</InputGroup>
				<ToggleGroup
					multiple
					value={kinds}
					onValueChange={(next: string[]) => {
						setPicked(null);
						setKinds(next);
					}}
					variant="outline"
					size="sm"
				>
					{KINDS.map((kind) => {
						const Icon = KIND_ICON[kind];
						return (
							<ToggleGroupItem key={kind} value={kind}>
								<Icon />
								{KIND_NAME[kind].many}
								<span className="text-muted-foreground tabular-nums">
									{graph.nodes.filter((node) => node.kind === kind).length}
								</span>
							</ToggleGroupItem>
						);
					})}
				</ToggleGroup>
			</div>
			<div className="flex h-[calc(100svh-17rem)] min-h-96 flex-col gap-4 lg:flex-row">
				<div className="relative min-h-64 min-w-0 flex-1 overflow-hidden rounded-xl border">
					<ReactFlow<MapNode, Edge>
						nodes={nodes}
						edges={edges}
						nodeTypes={mapNodeTypes}
						onNodeClick={(_, node) => setPicked(node.id)}
						onPaneClick={() => setPicked(null)}
						nodesConnectable={false}
						nodesDraggable={false}
						edgesFocusable={false}
						deleteKeyCode={null}
						minZoom={0.15}
						proOptions={{ hideAttribution: true }}
						fitView
					>
						<Background gap={24} size={1} />
					</ReactFlow>
				</div>
				<aside className="flex h-56 shrink-0 flex-col overflow-hidden rounded-xl border lg:h-auto lg:w-80">
					<ScrollArea className="min-h-0 flex-1">
						<div className="flex flex-col gap-4 p-4">
							{chosen ? (
								<NodeDetail
									node={chosen}
									graph={graph}
									onSelect={setPicked}
									onOpenFile={onOpenFile}
									onReview={onReview}
								/>
							) : (
								<div className="flex flex-col gap-1">
									<h3 className="font-medium text-sm">Choose a node</h3>
									<p className="text-muted-foreground text-sm">
										See what it connects to. Search to see what an agent would
										find.
									</p>
								</div>
							)}
						</div>
					</ScrollArea>
				</aside>
			</div>
		</div>
	);
}

/** One node: what it is, what to do with it, and what connects to it. */
function NodeDetail({
	node,
	graph,
	onSelect,
	onOpenFile,
	onReview,
}: {
	node: GraphNode;
	graph: KnowledgeGraph;
	onSelect: (id: string) => void;
	onOpenFile: (path: string) => void;
	onReview: (learningId: string) => void;
}) {
	const Icon = KIND_ICON[node.kind];
	const near = graph.edges.flatMap((edge) =>
		edge.source === node.id
			? [edge.target]
			: edge.target === node.id
				? [edge.source]
				: [],
	);
	const byId = new Map(graph.nodes.map((other) => [other.id, other]));
	const { path } = node;
	return (
		<>
			<div className="flex flex-col gap-1">
				<Badge variant="secondary" className="w-fit">
					<Icon />
					{KIND_NAME[node.kind].one}
				</Badge>
				<h3 className="break-words font-medium text-sm">{node.label}</h3>
				{path ? (
					<>
						<p className="break-all font-mono text-muted-foreground text-xs">
							{path}
						</p>
						<Button
							variant="outline"
							size="sm"
							className="mt-2 w-fit"
							onClick={() => onOpenFile(path)}
						>
							Open file
						</Button>
					</>
				) : null}
				{node.kind === "learning" ? (
					<Button
						variant="outline"
						size="sm"
						className="mt-2 w-fit"
						onClick={() => onReview(node.id.replace(/^learning:/, ""))}
					>
						Review it
					</Button>
				) : null}
			</div>
			{near.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Nothing connects to this yet.
				</p>
			) : null}
			{KINDS.map((kind) => {
				const items = near.flatMap((id) => {
					const other = byId.get(id);
					return other?.kind === kind ? [other] : [];
				});
				if (items.length === 0) return null;
				const KindIcon = KIND_ICON[kind];
				return (
					<div key={kind} className="flex flex-col gap-0.5">
						<h4 className="font-medium text-muted-foreground text-xs">
							{KIND_NAME[kind].many}{" "}
							<span className="tabular-nums">{items.length}</span>
						</h4>
						{items.map((item) => (
							<Button
								key={item.id}
								variant="ghost"
								size="sm"
								className="w-full justify-start"
								onClick={() => onSelect(item.id)}
							>
								<KindIcon data-icon="inline-start" />
								<span className="truncate">{item.label}</span>
							</Button>
						))}
					</div>
				);
			})}
		</>
	);
}
