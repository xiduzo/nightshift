import { flowOverviews } from "@nightshift/client";
import { flowNameSchema, newFlow } from "@nightshift/flows";
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
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, WorkflowIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { dashboardQueries } from "@/features/dashboard/queries";
import { scheduleQueries } from "@/features/schedules/queries";
import { settingsQueries } from "@/features/settings/queries";
import type { FlowListItem } from "@/shared/api";
import { PageHeading } from "@/shared/page";

import { chatSearch } from "./chat/chat-link";
import { FlowCard } from "./flow-card";
import { useFlowFilter } from "./flow-filter";
import { FlowNotices } from "./flow-notices";
import { ImportFlowButton } from "./move/import-flow-button";
import { flowMutations, flowQueries } from "./queries";
import { StartRunDialog } from "./start/start-run-dialog";

/**
 * The project's flows as a grid of cards (`FlowCard`): what each is, what
 * starts it, what is in it and how its last runs went. A search and
 * filters above them. Run one, open it in the editor, add or delete one.
 */
export function FlowList({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	// Each flow with its inputs, and which flows call it.
	const flows = useQuery(flowQueries.list(projectId));
	// What starts each flow, and its last runs. The cards show without them while they load.
	const schedules = useQuery(scheduleQueries.listLive(projectId));
	const summary = useQuery(dashboardQueries.summary({ projectId }));
	const overviews = flows.data
		? flowOverviews(
				flows.data,
				schedules.data?.schedules ?? [],
				summary.data?.flowHealth?.rows ?? [],
			)
		: undefined;
	const filter = useFlowFilter(overviews);
	const [creating, setCreating] = useState(false);
	const [toDelete, setToDelete] = useState<FlowListItem | null>(null);
	// The flow to start. Kept after the dialog closes, so it does not empty while it fades.
	const [starting, setStarting] = useState<{
		name: string;
		open: boolean;
	} | null>(null);

	const removeFlow = useMutation(
		flowMutations.remove({
			onSuccess: (_, input) => {
				toast.success(`Deleted ${input.name}`);
				setToDelete(null);
				void queryClient.invalidateQueries({ queryKey: flowQueries.all() });
			},
			onError: (error) => toast.error(`Could not delete: ${error.message}`),
		}),
	);

	return (
		<section aria-labelledby="flows-heading" className="flex flex-col gap-4">
			<PageHeading
				id="flows-heading"
				title="Flows"
				description="Night Shift runs the steps of a flow for you. Run a flow, or open it to edit."
				actions={
					<>
						<ImportFlowButton projectId={projectId} />
						<Button
							variant="outline"
							size="sm"
							onClick={() => setCreating(true)}
						>
							<PlusIcon data-icon="inline-start" />
							New flow
						</Button>
					</>
				}
			/>

			<FlowNotices projectId={projectId} />

			{flows.isLoading ? (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					<Skeleton className="h-64 w-full rounded-xl" />
					<Skeleton className="h-64 w-full rounded-xl" />
					<Skeleton className="hidden h-64 w-full rounded-xl xl:block" />
				</div>
			) : !overviews || overviews.length === 0 ? (
				<Card>
					<CardContent>
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<WorkflowIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>No flows yet</EmptyTitle>
								<EmptyDescription>
									{flows.error
										? flows.error.message
										: "A flow is the set of steps an agent follows. Create one, or import a flow file, to start."}
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button onClick={() => setCreating(true)}>
									<PlusIcon data-icon="inline-start" />
									New flow
								</Button>
							</EmptyContent>
						</Empty>
					</CardContent>
				</Card>
			) : (
				<>
					{filter.bar}
					{filter.shown.length === 0 ? (
						<Empty className="border">
							<EmptyHeader>
								<EmptyTitle>No flows match</EmptyTitle>
								<EmptyDescription>
									Try another search or filter.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
							{filter.shown.map((overview) => (
								<FlowCard
									key={overview.flow.name}
									projectId={projectId}
									overview={overview}
									onRun={() =>
										setStarting({ name: overview.flow.name, open: true })
									}
									onDelete={() => setToDelete(overview.flow)}
								/>
							))}
						</div>
					)}
				</>
			)}

			<NewFlowDialog
				open={creating}
				onOpenChange={setCreating}
				projectId={projectId}
				taken={flows.data?.map((flow) => flow.name) ?? []}
			/>

			{starting ? (
				<StartRunDialog
					open={starting.open}
					onOpenChange={(open) =>
						setStarting((current) => (current ? { ...current, open } : null))
					}
					projectId={projectId}
					flowName={starting.name}
					inputs={
						flows.data?.find((flow) => flow.name === starting.name)?.inputs ??
						[]
					}
				/>
			) : null}

			<AlertDialog
				open={toDelete !== null}
				onOpenChange={(open) => {
					if (!open) setToDelete(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {toDelete?.name}?</AlertDialogTitle>
						<AlertDialogDescription>Its past runs stay.</AlertDialogDescription>
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
							{removeFlow.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							{removeFlow.isPending ? "Deleting…" : "Delete flow"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}

function NewFlowDialog({
	open,
	onOpenChange,
	projectId,
	taken,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	taken: string[];
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{open ? <NewFlowForm projectId={projectId} taken={taken} /> : null}
			</DialogContent>
		</Dialog>
	);
}

function NewFlowForm({
	projectId,
	taken,
}: {
	projectId: string;
	taken: string[];
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
		flowMutations.save({
			onSuccess: (_, input) => {
				void queryClient.invalidateQueries({ queryKey: flowQueries.all() });
				// The new flow opens with the chat, to build it with an agent.
				void navigate({
					to: "/projects/$projectId/flows/$name",
					params: { projectId, name: input.name },
					search: { chat: chatSearch({ kind: "open" }) },
				});
			},
		}),
	);

	// The first Agent node starts with the daemon's defaults (Settings → New Agent nodes).
	const settings = useQuery(settingsQueries.get());
	const canCreate = trimmed !== "" && error === null && !createFlow.isPending;
	const problem = error ?? createFlow.error?.message ?? null;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canCreate) return;
				createFlow.mutate({
					projectId,
					name: trimmed,
					flow: newFlow(settings.data?.values),
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>New flow</DialogTitle>
				<DialogDescription>
					The flow starts with one Agent node. The editor opens next.
				</DialogDescription>
			</DialogHeader>
			<Field data-invalid={error !== null || undefined}>
				<FieldLabel htmlFor={`${id}-name`}>Flow name</FieldLabel>
				<Input
					id={`${id}-name`}
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="worker-check"
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={error !== null}
					aria-describedby={`${id}-hint`}
					autoFocus
				/>
				{problem ? (
					<FieldError id={`${id}-hint`}>{problem}</FieldError>
				) : (
					<FieldDescription id={`${id}-hint`}>
						Use lowercase letters, digits and dashes.
					</FieldDescription>
				)}
			</Field>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={!canCreate}>
					{createFlow.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<PlusIcon data-icon="inline-start" />
					)}
					{createFlow.isPending ? "Creating…" : "Create"}
				</Button>
			</DialogFooter>
		</form>
	);
}
