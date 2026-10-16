import { flowNameSchema } from "@nightshift/flows";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Input } from "@nightshift/ui/components/input";
import { Label } from "@nightshift/ui/components/label";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	FileWarningIcon,
	PlusIcon,
	Trash2Icon,
	WorkflowIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useProjectFlows } from "@/hooks/use-project-flows";
import type { FlowListItem } from "@/lib/api-types";
import { callersOf, newFlow } from "@/lib/flow-draft";
import { orpc } from "@/utils/orpc";

export function FlowList({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	const flows = useQuery(
		orpc.flows.list.queryOptions({ input: { projectId } }),
	);
	// Each flow's inputs, and which flows call it.
	const loaded = useProjectFlows(projectId);
	const [creating, setCreating] = useState(false);
	const [toDelete, setToDelete] = useState<FlowListItem | null>(null);

	const removeFlow = useMutation(
		orpc.flows.remove.mutationOptions({
			onSuccess: (_, input) => {
				toast.success(`Deleted ${input.name}`);
				setToDelete(null);
				void queryClient.invalidateQueries({ queryKey: orpc.flows.key() });
			},
			onError: (error) => toast.error(`Could not delete: ${error.message}`),
		}),
	);

	return (
		<section aria-labelledby="flows-heading" className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<h2 id="flows-heading" className="font-medium text-sm">
					Flows
				</h2>
				{creating ? null : (
					<Button
						variant="outline"
						size="xs"
						className="ml-auto"
						onClick={() => setCreating(true)}
					>
						<PlusIcon data-icon="inline-start" />
						New flow
					</Button>
				)}
			</div>

			{creating ? (
				<NewFlowForm
					projectId={projectId}
					taken={flows.data?.map((flow) => flow.name) ?? []}
					onCancel={() => setCreating(false)}
				/>
			) : null}

			{flows.isLoading ? (
				<div className="flex flex-col gap-1.5">
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
				</div>
			) : !flows.data || flows.data.length === 0 ? (
				<Empty className="border p-6 md:p-6">
					<EmptyHeader>
						<EmptyTitle>No flows yet</EmptyTitle>
						<EmptyDescription>
							{flows.error
								? flows.error.message
								: "A flow is a graph of steps, saved in .nightshift/flows/ in the repository. Create one to draw it."}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ul className="flex flex-col divide-y border">
					{flows.data.map((flow) => (
						<li key={flow.name} className="flex items-center gap-2 pr-2">
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId, name: flow.name }}
								className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
							>
								<WorkflowIcon
									className="size-4 shrink-0 text-muted-foreground"
									aria-hidden="true"
								/>
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="truncate font-medium font-mono text-sm">
										{flow.name}
									</span>
									<span className="truncate text-muted-foreground text-xs">
										{flow.description ?? "No description"}
									</span>
									<FlowSignature
										inputs={loaded.flows?.[flow.name]?.inputs}
										callers={
											loaded.flows ? callersOf(flow.name, loaded.flows) : []
										}
									/>
								</span>
								<FlowMeta flow={flow} />
							</Link>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Delete ${flow.name}`}
								title="Delete flow"
								onClick={() => setToDelete(flow)}
							>
								<Trash2Icon />
							</Button>
						</li>
					))}
				</ul>
			)}

			<AlertDialog
				open={toDelete !== null}
				onOpenChange={(open) => {
					if (!open) setToDelete(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {toDelete?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes{" "}
							<span className="font-mono">
								.nightshift/flows/{toDelete?.name}.json
							</span>{" "}
							from the repository. Runs that used it keep their copy.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={removeFlow.isPending}
							onClick={() => {
								if (toDelete)
									removeFlow.mutate({ projectId, name: toDelete.name });
							}}
						>
							{removeFlow.isPending ? "Deleting…" : "Delete flow"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}

/** The flow's inputs, briefly, and the flows that call it. */
function FlowSignature({
	inputs,
	callers,
}: {
	inputs: { name: string; type: string; required?: boolean }[] | undefined;
	callers: string[];
}) {
	if ((!inputs || inputs.length === 0) && callers.length === 0) return null;
	return (
		<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
			{inputs && inputs.length > 0 ? (
				<span className="min-w-0 truncate font-mono" title="Inputs">
					(
					{inputs
						.map(
							(input) =>
								`${input.name}${input.type === "json" ? ": json" : ""}${input.required ? "" : "?"}`,
						)
						.join(", ")}
					)
				</span>
			) : null}
			{callers.length > 0 ? (
				<span className="min-w-0 truncate">
					called by <span className="font-mono">{callers.join(", ")}</span>
				</span>
			) : null}
		</span>
	);
}

function FlowMeta({ flow }: { flow: FlowListItem }) {
	if (flow.nodeCount === null) {
		return (
			<Badge variant="destructive">
				<FileWarningIcon aria-hidden="true" />
				Does not load
			</Badge>
		);
	}
	return (
		<span className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
			<span>
				{flow.nodeCount} {flow.nodeCount === 1 ? "node" : "nodes"}
			</span>
			{flow.errorCount > 0 ? (
				<Badge variant="destructive">
					<CircleAlertIcon aria-hidden="true" />
					{flow.errorCount} {flow.errorCount === 1 ? "error" : "errors"}
				</Badge>
			) : null}
		</span>
	);
}

function NewFlowForm({
	projectId,
	taken,
	onCancel,
}: {
	projectId: string;
	taken: string[];
	onCancel: () => void;
}) {
	const id = useId();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");

	const trimmed = name.trim();
	const parsed = flowNameSchema.safeParse(trimmed);
	const error =
		trimmed === ""
			? null
			: !parsed.success
				? (parsed.error.issues[0]?.message ?? "Not a valid name.")
				: taken.includes(trimmed)
					? "A flow with this name exists."
					: null;

	// Writes the starter flow to disk first, so the editor always opens a real file.
	const createFlow = useMutation(
		orpc.flows.save.mutationOptions({
			onSuccess: (_, input) => {
				void queryClient.invalidateQueries({ queryKey: orpc.flows.key() });
				void navigate({
					to: "/projects/$projectId/flows/$name",
					params: { projectId, name: input.name },
				});
			},
		}),
	);

	const canCreate = trimmed !== "" && error === null && !createFlow.isPending;

	return (
		<form
			className="flex flex-col gap-2 border p-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canCreate) return;
				createFlow.mutate({ projectId, name: trimmed, flow: newFlow() });
			}}
		>
			<Label htmlFor={`${id}-name`}>Flow name</Label>
			<div className="flex items-start gap-2">
				<Input
					id={`${id}-name`}
					value={name}
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") onCancel();
					}}
					placeholder="worker-check"
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={error !== null}
					aria-describedby={`${id}-hint`}
					autoFocus
				/>
				<Button type="submit" disabled={!canCreate}>
					{createFlow.isPending ? "Creating…" : "Create"}
				</Button>
				<Button type="button" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
			</div>
			<p
				id={`${id}-hint`}
				role={error || createFlow.error ? "alert" : undefined}
				className={
					error || createFlow.error
						? "text-destructive text-xs"
						: "text-muted-foreground text-xs"
				}
			>
				{error ??
					createFlow.error?.message ??
					`Saved as .nightshift/flows/${trimmed || "<name>"}.json. Starts with one Agent node, worker.`}
			</p>
		</form>
	);
}
