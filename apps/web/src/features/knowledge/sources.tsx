import { KNOWLEDGE_SOURCE_KINDS, knowledgeSourceKind } from "@nightshift/flows";
import {
	Alert,
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
	lastSyncText,
	scheduleText,
	sourceActions,
	sourceSummary,
} from "./source-words";

type Sync = Knowledge["syncs"][number];

/** A kit's name for a person, for a sync flow someone drew on the canvas. */
function kitLabel(kit: string): string {
	return KNOWLEDGE_SOURCE_KINDS.find((kind) => kind.kit === kit)?.label ?? kit;
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
	return (
		<Item variant="outline">
			<ItemContent>
				<ItemTitle>
					{source ? (
						knowledgeSourceKind(source.kit).label
					) : (
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId, name: sync.flow }}
							className="hover:underline"
						>
							{sync.flow}
						</Link>
					)}
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
								aria-label={`More for ${source ? knowledgeSourceKind(source.kit).label : sync.flow}`}
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
	const label = sync?.source ? knowledgeSourceKind(sync.source.kit).label : "";
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
