import { KNOWLEDGE_SOURCE_KINDS } from "@nightshift/flows";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Field, FieldLabel } from "@nightshift/ui/components/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	EllipsisIcon,
	PencilIcon,
	RefreshCwIcon,
	Trash2Icon,
	UsersIcon,
	WorkflowIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { flowQueries, StartRunDialog } from "@/features/flows";
import { type Knowledge, orpc } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { knowledgeMutations } from "./queries";
import type { EditedSource } from "./source-dialog";
import {
	computerText,
	lastSyncText,
	scheduleText,
	sourceActions,
	sourceSummary,
	sourceTitle,
} from "./source-words";

type Sync = Knowledge["syncs"][number];

/** A kit's name for a person, for a sync flow someone drew on the canvas. */
function kitLabel(kit: string): string {
	return KNOWLEDGE_SOURCE_KINDS.find((kind) => kind.kit === kit)?.label ?? kit;
}

/** A source's name for a person: its kind, or the name of the flow someone drew. */
function sourceLabel(sync: Sync): string {
	return sync.source ? sourceTitle(sync.source, sync.computer) : sync.flow;
}

/**
 * Where the knowledge comes from: each source with what it copies, its
 * last sync and Sync now. A source the page added has Edit and Remove. A
 * sync flow someone drew opens in the editor. Each action shows only to a
 * person who may use it.
 */
export function Sources({
	projectId,
	syncs,
	shared,
	can,
	onEdit,
}: {
	projectId: string;
	syncs: Knowledge["syncs"];
	shared: boolean;
	can: Knowledge["can"];
	onEdit: (source: EditedSource) => void;
}) {
	const [removing, setRemoving] = useState<Sync | null>(null);
	return (
		<PageSection
			title="Sources"
			description="Where the knowledge comes from. Each sync replaces what that source added before."
		>
			{shared ? (
				<Alert>
					<UsersIcon />
					<AlertTitle>
						Every Member of this Space can read this knowledge
					</AlertTitle>
					<AlertDescription>
						Before you sync work items or pages here, make sure that each Member
						may see them.
					</AlertDescription>
				</Alert>
			) : null}
			<FailedSyncs syncs={syncs} />
			<ItemGroup className="gap-2">
				{syncs.map((sync) => (
					<SourceItem
						key={sync.flow}
						projectId={projectId}
						sync={sync}
						may={sourceActions(sync, can)}
						onEdit={onEdit}
						onRemove={() => setRemoving(sync)}
					/>
				))}
			</ItemGroup>
			<RemoveSourceDialog
				projectId={projectId}
				sync={removing}
				removesFiles={can.startRuns}
				onClose={() => setRemoving(null)}
			/>
		</PageSection>
	);
}

/**
 * The sources whose last sync failed, in one Alert: what failed, and how
 * to see why. One source links to its last run.
 */
function FailedSyncs({ syncs }: { syncs: Knowledge["syncs"] }) {
	const failed = syncs.filter((sync) => sync.health === "failed");
	const [only] = failed;
	if (!only) return null;
	return (
		<Alert variant="destructive">
			<CircleAlertIcon />
			<AlertTitle>
				{failed.length === 1
					? `${sourceLabel(only)} did not sync`
					: `${failed.length} sources did not sync`}
			</AlertTitle>
			<AlertDescription>
				{failed.length === 1
					? "Your agents read what it copied before. Open the last run to see what went wrong."
					: "Your agents read what these sources copied before. Open the last run of each to see what went wrong."}
			</AlertDescription>
			{failed.length === 1 && only.lastRun ? (
				<AlertAction>
					<Button
						size="sm"
						variant="outline"
						render={
							<Link to="/runs/$runId" params={{ runId: only.lastRun.id }} />
						}
					>
						Open run
					</Button>
				</AlertAction>
			) : null}
		</Alert>
	);
}

function SourceItem({
	projectId,
	sync,
	may,
	onEdit,
	onRemove,
}: {
	projectId: string;
	sync: Sync;
	may: ReturnType<typeof sourceActions>;
	onEdit: (source: EditedSource) => void;
	onRemove: () => void;
}) {
	const { source } = sync;
	const schedule = scheduleText(sync.schedule);
	const last = lastSyncText(sync.lastRun, (at) => formatRelative(at));
	const computer = source ? computerText(source, sync.computer) : null;
	return (
		<Item variant="outline">
			<ItemContent>
				<ItemTitle>
					{source ? (
						sourceTitle(source, sync.computer)
					) : (
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId, name: sync.flow }}
							className="hover:underline"
						>
							{sync.flow}
						</Link>
					)}
					{sync.health === "stale" ? (
						<Badge variant="outline">Out of date</Badge>
					) : null}
				</ItemTitle>
				<ItemDescription className="flex flex-col gap-1">
					{source ? (
						<span className="truncate">{sourceSummary(source)}</span>
					) : (
						<span className="flex flex-wrap gap-1">
							{sync.kits.map((kit) => (
								<Badge key={kit} variant="secondary">
									{kitLabel(kit)}
								</Badge>
							))}
						</span>
					)}
					<span>
						{sync.lastRun ? (
							<Link
								to="/runs/$runId"
								params={{ runId: sync.lastRun.id }}
								className="hover:underline"
							>
								{last}
							</Link>
						) : (
							last
						)}
						{schedule ? ` · ${schedule}` : null}
						{computer ? ` · ${computer}` : null}
					</span>
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				{may.sync ? <SyncNowButton projectId={projectId} sync={sync} /> : null}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`More for ${sourceLabel(sync)}`}
							/>
						}
					>
						<EllipsisIcon aria-hidden="true" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{source && may.edit ? (
							<DropdownMenuItem
								onClick={() =>
									onEdit({
										name: sync.flow,
										source,
										schedule: sync.schedule,
										computer: sync.computer,
									})
								}
							>
								<PencilIcon aria-hidden="true" />
								Edit
							</DropdownMenuItem>
						) : null}
						<DropdownMenuItem
							render={
								<Link
									to="/projects/$projectId/flows/$name"
									params={{ projectId, name: sync.flow }}
								/>
							}
						>
							<WorkflowIcon aria-hidden="true" />
							Open flow
						</DropdownMenuItem>
						{source && may.remove ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive" onClick={onRemove}>
									<Trash2Icon aria-hidden="true" />
									Remove
								</DropdownMenuItem>
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			</ItemActions>
		</Item>
	);
}

/**
 * Runs a source now. A source the page added starts at once: Night Shift
 * runs it where its schedule runs it. A drawn flow asks for its inputs
 * first.
 */
function SyncNowButton({ projectId, sync }: { projectId: string; sync: Sync }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [asking, setAsking] = useState(false);
	const flows = useQuery({
		...flowQueries.list(projectId),
		enabled: !sync.source,
		meta: { quietErrors: true },
	});
	const start = useMutation(
		knowledgeMutations.syncSource({
			onSuccess: (run) => {
				void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
				toast.success("Night Shift syncs it now", {
					action: {
						label: "View run",
						onClick: () =>
							void navigate({ to: "/runs/$runId", params: { runId: run.id } }),
					},
				});
			},
			onError: (error) =>
				toast.error(`The sync did not start: ${error.message}`),
		}),
	);
	const syncing =
		start.isPending ||
		sync.lastRun?.status === "running" ||
		sync.lastRun?.status === "waiting";

	const click = () => {
		if (!sync.source) {
			setAsking(true);
			return;
		}
		start.mutate({ projectId, name: sync.flow });
	};

	return (
		<>
			<Button variant="outline" size="sm" disabled={syncing} onClick={click}>
				{start.isPending ? (
					<Spinner data-icon="inline-start" />
				) : (
					<RefreshCwIcon aria-hidden="true" />
				)}
				Sync now
			</Button>
			{sync.source ? null : (
				<StartRunDialog
					open={asking}
					onOpenChange={setAsking}
					projectId={projectId}
					flowName={sync.flow}
					inputs={
						flows.data?.find((flow) => flow.name === sync.flow)?.inputs ?? []
					}
				/>
			)}
		</>
	);
}

/** Confirms the removal of a source, and asks whether its files go too. */
function RemoveSourceDialog({
	projectId,
	sync,
	removesFiles,
	onClose,
}: {
	projectId: string;
	sync: Sync | null;
	/** The person may remove the files too. */
	removesFiles: boolean;
	onClose: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [removeFiles, setRemoveFiles] = useState(removesFiles);
	const label = sync ? sourceLabel(sync) : "";
	const remove = useMutation(
		knowledgeMutations.removeSource({
			onSuccess: ({ removedFiles }) => {
				void Promise.all([
					queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() }),
					queryClient.invalidateQueries({ queryKey: orpc.flows.key() }),
					queryClient.invalidateQueries({ queryKey: orpc.schedules.key() }),
				]);
				onClose();
				toast.success(
					removedFiles > 0
						? `Source removed, with ${removedFiles} ${removedFiles === 1 ? "file" : "files"}`
						: "Source removed",
				);
			},
			onError: (error) => toast.error(`Could not remove: ${error.message}`),
		}),
	);
	return (
		<AlertDialog
			open={sync !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove {label}?</AlertDialogTitle>
					<AlertDialogDescription>
						{sync?.schedule
							? "Night Shift stops syncing this source and removes its schedule."
							: "Night Shift stops syncing this source."}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{removesFiles ? (
					<Field orientation="horizontal">
						<Checkbox
							id={`${id}-files`}
							checked={removeFiles}
							onCheckedChange={(checked) => setRemoveFiles(checked === true)}
						/>
						<FieldLabel htmlFor={`${id}-files`} className="font-normal">
							Also remove the files it added, on every computer of this Space
						</FieldLabel>
					</Field>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={remove.isPending}
						onClick={() => {
							if (!sync) return;
							remove.mutate({
								projectId,
								name: sync.flow,
								removeFiles: removesFiles && removeFiles,
							});
						}}
					>
						{remove.isPending ? <Spinner data-icon="inline-start" /> : null}
						Remove
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
