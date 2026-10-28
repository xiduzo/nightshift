import { type FlowInputDef, flowNameSchema, newFlow } from "@nightshift/flows";
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
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	FileWarningIcon,
	PencilIcon,
	PlayIcon,
	PlusIcon,
	Trash2Icon,
	WorkflowIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { settingsQueries } from "@/features/settings/queries";
import type { FlowListItem } from "@/shared/api";
import { PageHeading } from "@/shared/page";

import { chatSearch } from "./chat/chat-link";
import { FlowNotices } from "./flow-notices";
import { ImportFlowButton } from "./move/import-flow-button";
import { flowMutations, flowQueries } from "./queries";
import { StartRunDialog } from "./start/start-run-dialog";

/**
 * The project's flows as a grid of cards: name, description, inputs and
 * callers, size and errors. Run one, open it in the editor, add or delete one.
 */
export function FlowList({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	// Each flow with its inputs, and which flows call it.
	const flows = useQuery(flowQueries.list(projectId));
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
				description="The steps an agent follows. Run one, or open it to edit."
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
					<Skeleton className="h-40 w-full rounded-xl" />
					<Skeleton className="h-40 w-full rounded-xl" />
					<Skeleton className="hidden h-40 w-full rounded-xl xl:block" />
				</div>
			) : !flows.data || flows.data.length === 0 ? (
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
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{flows.data.map((flow) => (
						<FlowCard
							key={flow.name}
							projectId={projectId}
							flow={flow}
							inputs={flow.inputs}
							callers={flow.callers}
							runBlockedBy={
								flow.nodeCount === null
									? "This flow does not load. Open it to see why."
									: flow.errorCount > 0
										? "Fix the errors in the editor first."
										: null
							}
							onRun={() => setStarting({ name: flow.name, open: true })}
							onDelete={() => setToDelete(flow)}
						/>
					))}
				</div>
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
						<AlertDialogDescription>
							This removes the flow from the project. Its past runs stay as they
							are.
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

function FlowCard({
	projectId,
	flow,
	inputs,
	callers,
	runBlockedBy,
	onRun,
	onDelete,
}: {
	projectId: string;
	flow: FlowListItem;
	inputs: readonly FlowInputDef[] | undefined;
	callers: string[];
	/** Why the flow cannot start now, or null. */
	runBlockedBy: string | null;
	onRun: () => void;
	onDelete: () => void;
}) {
	return (
		<Card
			size="sm"
			className="relative transition-colors hover:bg-muted/40 has-[a[data-stretched]:focus-visible]:ring-2 has-[a[data-stretched]:focus-visible]:ring-ring/50"
		>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					<WorkflowIcon
						className="size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					{/* The link covers the card, so the card is one target. */}
					<Link
						to="/projects/$projectId/flows/$name"
						params={{ projectId, name: flow.name }}
						data-stretched=""
						className="truncate font-mono outline-none after:absolute after:inset-0"
					>
						{flow.name}
					</Link>
				</CardTitle>
				<CardDescription className="line-clamp-2">
					{flow.description ?? "No description"}
				</CardDescription>
				<CardAction className="relative z-10">
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Delete ${flow.name}`}
									className="text-muted-foreground"
									onClick={onDelete}
								/>
							}
						>
							<Trash2Icon />
						</TooltipTrigger>
						<TooltipContent>Delete flow</TooltipContent>
					</Tooltip>
				</CardAction>
			</CardHeader>
			<FlowSignature inputs={inputs} callers={callers} />
			<CardFooter className="mt-auto gap-2 border-t">
				<FlowMeta flow={flow} />
				<div className="relative z-10 ml-auto flex items-center gap-1.5">
					<Button
						variant="ghost"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId, name: flow.name }}
							/>
						}
					>
						<PencilIcon data-icon="inline-start" />
						Edit
					</Button>
					<Tooltip>
						<TooltipTrigger
							render={
								// A disabled button gets no hover; the span keeps the tooltip.
								<span className="inline-flex" />
							}
						>
							<Button
								size="sm"
								disabled={runBlockedBy !== null}
								aria-label={`Run ${flow.name}`}
								onClick={onRun}
							>
								<PlayIcon data-icon="inline-start" />
								Run
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{runBlockedBy ?? "Start a run of this flow"}
						</TooltipContent>
					</Tooltip>
				</div>
			</CardFooter>
		</Card>
	);
}

/** The flow's inputs, briefly, and the flows that call it. */
function FlowSignature({
	inputs,
	callers,
}: {
	inputs: readonly FlowInputDef[] | undefined;
	callers: string[];
}) {
	if ((!inputs || inputs.length === 0) && callers.length === 0) return null;
	return (
		<CardContent className="flex flex-col gap-2 text-muted-foreground text-xs">
			{inputs && inputs.length > 0 ? (
				<div className="flex flex-wrap items-center gap-1.5" title="Inputs">
					<span className="sr-only">Inputs:</span>
					{inputs.map((input) => (
						<Badge
							key={input.name}
							variant="secondary"
							className="font-mono font-normal"
						>
							<span>
								{input.name}
								{input.type === "json" ? (
									<span className="text-muted-foreground">: json</span>
								) : null}
								{input.required ? "" : "?"}
							</span>
						</Badge>
					))}
				</div>
			) : null}
			{callers.length > 0 ? (
				<span className="min-w-0 truncate">
					Called by <span className="font-mono">{callers.join(", ")}</span>
				</span>
			) : null}
		</CardContent>
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
		<span className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
			<span className="tabular-nums">
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
