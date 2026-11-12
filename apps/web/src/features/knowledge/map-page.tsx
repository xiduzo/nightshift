import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
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
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	Background,
	type Edge,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import {
	CircleAlertIcon,
	EyeOffIcon,
	SearchIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { loadElk } from "@/features/flows";
import type { KnowledgeMap } from "@/shared/api";
import { PanelHeader } from "@/shared/panel";
import { KnowledgeSection, useKnowledge } from "./knowledge-layout";
import {
	KIND_ICON,
	KIND_NAME,
	type KnowledgeNode,
	type MapNode,
	type MapNodeData,
	mapEdge,
	mapNodeTypes,
	type NodeKind,
} from "./map-node";
import { knowledgeMutations, knowledgeQueries } from "./queries";
import { useKnowledgeHits } from "./use-knowledge-hits";

const KINDS: NodeKind[] = ["file", "topic", "question", "learning"];

/** About how wide a node is, before it is measured, in px. */
function nodeWidth(label: string): number {
	return Math.min(208, 40 + label.length * 6.5);
}

/** Where each node goes: a stress layout keeps connected nodes close. */
async function layoutOf(
	nodes: KnowledgeNode[],
	edges: KnowledgeMap["edges"],
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
function circleOf(
	nodes: KnowledgeNode[],
): Map<string, { x: number; y: number }> {
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
export function KnowledgeMapPage({ node }: { node: string | undefined }) {
	return (
		<KnowledgeSection
			title="Map"
			description="How your files, topics, questions and learnings connect."
		>
			<MapLoader focus={node ?? null} />
		</KnowledgeSection>
	);
}

function MapLoader({ focus }: { focus: string | null }) {
	const { projectId, knowledge, review, openFile } = useKnowledge();
	const navigate = useNavigate();
	const onOpenFile = openFile;
	const onReview = (node: string) => {
		review.bringForwardNode(node);
		void navigate({
			to: "/projects/$projectId/knowledge/review",
			params: { projectId },
		});
	};
	const map = useQuery(knowledgeQueries.map(projectId));
	if (map.error) {
		return (
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertTitle>The map did not load</AlertTitle>
				<AlertDescription>{map.error.message}</AlertDescription>
			</Alert>
		);
	}
	if (!map.data) return <Skeleton className="h-96 w-full" />;
	if (map.data.nodes.length === 0) {
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
				map={map.data}
				focus={focus}
				mayChange={knowledge.can.startRuns}
				onOpenFile={onOpenFile}
				onReview={onReview}
			/>
		</ReactFlowProvider>
	);
}

/** Marks a word as not a topic, with a way back, or puts one back. */
function useNotTopic(projectId: string) {
	const { mutate, isPending } = useMutation(
		knowledgeMutations.markNotTopic({
			onSuccess: (_words, { word, notTopic }) => {
				if (!notTopic) {
					toast.success(`${word} is a topic again`);
					return;
				}
				toast.success(`${word} is no longer a topic`, {
					action: {
						label: "Undo",
						onClick: () => mutate({ projectId, word, notTopic: false }),
					},
				});
			},
			onError: (error) =>
				toast.error(`The topics did not change: ${error.message}`),
		}),
	);
	return {
		isPending,
		mark: (word: string, notTopic: boolean) =>
			mutate({ projectId, word, notTopic }),
	};
}

function MapView({
	projectId,
	map,
	focus,
	mayChange,
	onOpenFile,
	onReview,
}: {
	projectId: string;
	map: KnowledgeMap;
	focus: string | null;
	mayChange: boolean;
	onOpenFile: (path: string) => void;
	onReview: (node: string) => void;
}) {
	const [kinds, setKinds] = useState<string[]>(KINDS);
	const [picked, setPicked] = useState<string | null>(focus);
	const [positions, setPositions] = useState<Map<
		string,
		{ x: number; y: number }
	> | null>(null);
	const { text, setText, query, hits } = useKnowledgeHits(projectId);
	const notTopic = useNotTopic(projectId);
	const flow = useReactFlow();

	useEffect(() => setPicked(focus), [focus]);

	const visible = useMemo(() => {
		const nodes = map.nodes.filter((node) => kinds.includes(node.kind));
		const ids = new Set(nodes.map((node) => node.id));
		return {
			nodes,
			edges: map.edges.filter(
				(edge) => ids.has(edge.source) && ids.has(edge.target),
			),
		};
	}, [map, kinds]);

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
	const chosen = map.nodes.find((node) => node.id === selected);

	return (
		<div className="flex flex-col gap-4">
			{map.filesLeftOut > 0 ? (
				<Alert>
					<TriangleAlertIcon />
					<AlertTitle>This map leaves out some topics</AlertTitle>
					<AlertDescription>
						Night Shift skipped {map.filesLeftOut} files, because you have so
						many. Sync only what your agents need.
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
						placeholder="Search to see what an agent finds"
						aria-label="Search to see what an agent finds"
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
									{map.nodes.filter((node) => node.kind === kind).length}
								</span>
							</ToggleGroupItem>
						);
					})}
				</ToggleGroup>
				{mayChange && map.notTopics.length > 0 ? (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={<Button variant="outline" size="sm" />}
						>
							<EyeOffIcon />
							Not topics
							<span className="text-muted-foreground tabular-nums">
								{map.notTopics.length}
							</span>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start">
							<DropdownMenuGroup>
								<DropdownMenuLabel>
									Choose one to show it again
								</DropdownMenuLabel>
								{map.notTopics.map((word) => (
									<DropdownMenuItem
										key={word}
										disabled={notTopic.isPending}
										onClick={() => notTopic.mark(word, false)}
									>
										{word}
									</DropdownMenuItem>
								))}
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
			</div>
			<div className="flex h-[calc(100svh-15.5rem)] min-h-96 flex-col gap-4 lg:flex-row">
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
				<Card className="h-56 shrink-0 gap-0 overflow-hidden py-0 lg:h-auto lg:w-80">
					{chosen ? (
						<NodeDetail
							node={chosen}
							map={map}
							onSelect={setPicked}
							onOpenFile={onOpenFile}
							onReview={onReview}
							onNotTopic={
								mayChange && chosen.kind === "topic"
									? () => notTopic.mark(chosen.label, true)
									: undefined
							}
						/>
					) : (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>Choose an item</EmptyTitle>
								<EmptyDescription>
									This panel shows what connects to it.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					)}
				</Card>
			</div>
		</div>
	);
}

/** One node: what it is, what to do with it, and what connects to it. */
function NodeDetail({
	node,
	map,
	onSelect,
	onOpenFile,
	onReview,
	onNotTopic,
}: {
	node: KnowledgeNode;
	map: KnowledgeMap;
	onSelect: (id: string) => void;
	onOpenFile: (path: string) => void;
	onReview: (node: string) => void;
	/** Unset: the person may not change the topics, or this is no topic. */
	onNotTopic: (() => void) | undefined;
}) {
	const Icon = KIND_ICON[node.kind];
	const near = map.edges.flatMap((edge) =>
		edge.source === node.id
			? [edge.target]
			: edge.target === node.id
				? [edge.source]
				: [],
	);
	const byId = new Map(map.nodes.map((other) => [other.id, other]));
	const { path } = node;
	return (
		<>
			<PanelHeader
				icon={Icon}
				kicker={KIND_NAME[node.kind].one}
				title={node.label}
				mono={false}
				className="shrink-0 border-b"
				actions={
					path ? (
						<Button
							variant="outline"
							size="sm"
							onClick={() => onOpenFile(path)}
						>
							Open file
						</Button>
					) : node.kind === "learning" ? (
						<Button
							variant="outline"
							size="sm"
							onClick={() => onReview(node.id)}
						>
							Review it
						</Button>
					) : onNotTopic ? (
						<Button variant="outline" size="sm" onClick={onNotTopic}>
							Not a topic
						</Button>
					) : undefined
				}
			/>
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-4 p-4">
					{path ? (
						<p className="break-all font-mono text-muted-foreground text-xs">
							{path}
						</p>
					) : null}
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
							<div key={kind} className="flex flex-col gap-1">
								<h4 className="font-medium text-muted-foreground text-xs">
									{KIND_NAME[kind].many}{" "}
									<span className="tabular-nums">{items.length}</span>
								</h4>
								<ItemGroup className="gap-0.5">
									{items.map((item) => (
										<Item
											key={item.id}
											size="xs"
											render={
												<button
													type="button"
													className="text-left"
													onClick={() => onSelect(item.id)}
												/>
											}
										>
											<ItemMedia variant="icon">
												<KindIcon aria-hidden="true" />
											</ItemMedia>
											<ItemContent className="min-w-0">
												<ItemTitle className="w-full font-normal">
													<span className="truncate">{item.label}</span>
												</ItemTitle>
											</ItemContent>
										</Item>
									))}
								</ItemGroup>
							</div>
						);
					})}
				</div>
			</ScrollArea>
		</>
	);
}
