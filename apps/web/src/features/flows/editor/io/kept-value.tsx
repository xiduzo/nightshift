/** The value a kept variable carries to the next run, with a way to reset it. */
import { Button } from "@nightshift/ui/components/button";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { flowMutations, flowQueries } from "../../queries";

/** Which flow's kept values the editor shows: the saved flow file. */
export type KeptFlow = { projectId: string; flowName: string };

/** A value on one line: text as it is, anything else as compact JSON, cut short. */
function preview(value: unknown, max = 60): string {
	const text =
		typeof value === "string" ? value : (JSON.stringify(value) ?? "");
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The value the variable keeps for the next run of this flow on this
 * computer, or that it has none yet. Reset forgets it: the next run starts
 * from the initial value.
 */
export function KeptValue({
	kept,
	name,
	id,
}: {
	kept: KeptFlow;
	name: string;
	id: string;
}) {
	const queryClient = useQueryClient();
	const values = useQuery(flowQueries.kept(kept.projectId, kept.flowName));
	const reset = useMutation(
		flowMutations.resetKept({
			onSuccess: () => {
				toast.success(`The next run starts ${name} from its initial value.`);
				void queryClient.invalidateQueries({
					queryKey: flowQueries.kept(kept.projectId, kept.flowName).queryKey,
				});
			},
			onError: (error) => toast.error(`Could not reset: ${error.message}`),
		}),
	);

	if (values.isLoading) return <Skeleton className="h-6 w-full" />;
	const value = values.data?.find((one) => one.name === name);
	if (!value) {
		return (
			<p id={id} className="text-muted-foreground text-xs">
				Nothing kept yet. The next run starts from the initial value.
			</p>
		);
	}
	const full = preview(value.value, 400);
	return (
		<div id={id} className="flex items-center gap-2 text-xs">
			<span className="shrink-0 text-muted-foreground">Kept value</span>
			<code className="min-w-0 flex-1 truncate" title={full}>
				{value.value === null ? "No value" : preview(value.value)}
			</code>
			<Button
				variant="ghost"
				size="xs"
				disabled={reset.isPending}
				aria-label={`Reset the kept value of ${name}`}
				onClick={() =>
					reset.mutate({
						projectId: kept.projectId,
						name: kept.flowName,
						variable: name,
					})
				}
			>
				<RotateCcwIcon data-icon="inline-start" />
				Reset
			</Button>
		</div>
	);
}
