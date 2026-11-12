/** The Memory section of a node: what it remembers between runs of the flow, and Forget what it saw. */
import {
	type CallNode,
	MAX_MEMORY_KEYS,
	type SinceLastRunNode,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/shared/format";
import { flowMutations, flowQueries } from "../../queries";
import { InspectorSection, Note } from "../fields";
import { memoryOfNode } from "./node-memory";

/** What one entry holds: the last value, or how many items. */
function heldText(entry: { keys: number; value?: unknown }): string {
	return entry.value !== undefined
		? `Last value: ${JSON.stringify(entry.value)}`
		: `${entry.keys} ${entry.keys === 1 ? "item" : "items"}`;
}

/**
 * What the node remembers from the runs of this flow, per scope, and
 * Forget what it saw. A Subflow node lists what the nodes inside its flow
 * saw (a kit's Since last run), and shows the section only when they
 * remember something.
 */
export function MemorySection({
	projectId,
	flowName,
	node,
}: {
	projectId: string;
	/** The flow open in the editor: its runs keep the memory. */
	flowName: string;
	node: SinceLastRunNode | CallNode;
}) {
	const memory = useQuery(flowQueries.memory(projectId, flowName));
	const forget = useMutation(
		flowMutations.forgetMemory({
			onSuccess: () => {
				toast.success("Forgotten. The next run is a first run.");
			},
			onError: (error) => toast.error(`Could not forget: ${error.message}`),
		}),
	);
	const rows = memoryOfNode(memory.data ?? [], node);
	const subflow = node.type === "call";
	if (subflow && rows.length === 0) return null;
	return (
		<InspectorSection title="Memory" tab="results">
			{memory.isLoading ? (
				<Skeleton className="h-6 w-full" />
			) : rows.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					Nothing remembered yet. The next run is a first run.
				</p>
			) : (
				<ItemGroup className="gap-1">
					{rows.map((entry) => (
						<Item
							key={`${entry.node} ${entry.scope}`}
							variant="muted"
							size="xs"
						>
							<ItemContent className="min-w-0">
								<ItemTitle className="text-xs">
									{entry.inside ?? heldText(entry)}
								</ItemTitle>
								<ItemDescription className="truncate text-xs">
									{entry.inside === undefined ? "" : `${heldText(entry)} · `}
									{entry.scope === "" ? "" : `${entry.scope} · `}
									Saved {formatRelative(entry.updatedAt)}
								</ItemDescription>
							</ItemContent>
							{rows.length > 1 ? (
								<ItemActions>
									<Button
										variant="ghost"
										size="xs"
										disabled={forget.isPending}
										aria-label={
											entry.inside === undefined
												? `Forget what it saw for ${entry.scope}`
												: `Forget what ${entry.inside} saw${entry.scope === "" ? "" : ` for ${entry.scope}`}`
										}
										onClick={() =>
											forget.mutate({
												projectId,
												name: flowName,
												node: entry.node,
												scope: entry.scope,
											})
										}
									>
										<RotateCcwIcon data-icon="inline-start" />
										Forget
									</Button>
								</ItemActions>
							) : null}
						</Item>
					))}
				</ItemGroup>
			)}
			{rows.length > 0 ? (
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					disabled={forget.isPending}
					onClick={() =>
						forget.mutate({ projectId, name: flowName, node: node.id })
					}
				>
					<RotateCcwIcon data-icon="inline-start" />
					Forget what it saw
				</Button>
			) : null}
			{subflow ? (
				<Note>
					What the nodes inside the called flow remember. Another Subflow node
					that calls the same flow keeps its own memory.
				</Note>
			) : (
				<Note>
					It saves what it saw when its step ends, also when a later step fails.
					It keeps up to {MAX_MEMORY_KEYS.toLocaleString("en")} items. A quick
					run remembers nothing.
				</Note>
			)}
		</InspectorSection>
	);
}
