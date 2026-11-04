import { cn } from "@nightshift/ui/lib/utils";
import {
	type Edge,
	Handle,
	type Node,
	type NodeProps,
	Position,
} from "@xyflow/react";
import {
	FileTextIcon,
	HashIcon,
	LightbulbIcon,
	MessageCircleQuestionIcon,
} from "lucide-react";
import type { KnowledgeGraph } from "@/shared/api";

export type GraphNode = KnowledgeGraph["nodes"][number];
export type GraphEdge = KnowledgeGraph["edges"][number];
export type GraphKind = GraphNode["kind"];

export const KIND_ICON = {
	file: FileTextIcon,
	topic: HashIcon,
	question: MessageCircleQuestionIcon,
	learning: LightbulbIcon,
} as const;

export const KIND_NAME: Record<GraphKind, { one: string; many: string }> = {
	file: { one: "File", many: "Files" },
	topic: { one: "Topic", many: "Topics" },
	question: { one: "Question", many: "Questions" },
	learning: { one: "Learning", many: "Learnings" },
};

export type MapNodeData = {
	node: GraphNode;
	/** `dim`: outside what the person looks at. `lit`: a search found it. */
	state: "normal" | "lit" | "dim" | "selected";
};
export type MapNode = Node<MapNodeData, "map">;

/** A larger topic has more files around it. */
function topicFontSize(degree: number): string {
	return `${Math.min(16, 11 + degree * 0.4)}px`;
}

/** One node of the map. The handles sit in its middle, so edges meet there. */
function MapNodeView({ data }: NodeProps<MapNode>) {
	const { node, state } = data;
	const Icon = KIND_ICON[node.kind];
	const center = "!left-1/2 !top-1/2 !opacity-0 !pointer-events-none";
	return (
		<div
			title={node.path ?? node.label}
			className={cn(
				"flex max-w-52 items-center gap-1.5 border bg-card px-2.5 py-1 text-card-foreground text-xs shadow-xs transition-opacity",
				node.kind === "file" && "rounded-md",
				node.kind === "topic" &&
					"rounded-full border-transparent bg-primary font-medium text-primary-foreground",
				node.kind === "question" && "rounded-md border-dashed italic",
				node.kind === "learning" && "rounded-full border-dashed bg-muted",
				state === "dim" && "opacity-20",
				state === "lit" && "ring-2 ring-ring",
				state === "selected" &&
					"ring-2 ring-ring ring-offset-2 ring-offset-background",
			)}
			style={
				node.kind === "topic"
					? { fontSize: topicFontSize(node.degree) }
					: undefined
			}
		>
			<Handle type="target" position={Position.Top} className={center} />
			<Handle type="source" position={Position.Top} className={center} />
			<Icon className="size-3 shrink-0" aria-hidden="true" />
			<span className="truncate">{node.label}</span>
		</div>
	);
}

export const mapNodeTypes = { map: MapNodeView };

/** How one edge looks: a question's edge is dashed, a link between files heavier. */
export function mapEdge(edge: GraphEdge, dim: boolean): Edge {
	return {
		id: edge.id,
		source: edge.source,
		target: edge.target,
		type: "straight",
		style: {
			stroke: edge.kind === "found" ? "var(--ring)" : "var(--muted-foreground)",
			strokeDasharray: edge.kind === "found" ? "4 3" : undefined,
			strokeWidth: edge.kind === "links" ? 2 : 1,
			opacity: dim ? 0.05 : 0.35,
		},
	};
}
