import { type Flow, type FlowIssue, flowDiffSummary } from "@nightshift/flows";
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
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EyeIcon, HistoryIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { FlowRevisionItem } from "@/shared/api";
import { formatDateTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { summaryLabels } from "../../chat/proposal-canvas";
import { flowMutations, flowQueries } from "../../queries";
import {
	diffLines,
	REVISION_KIND_LABEL,
	revisionAuthor,
} from "./revision-words";

/** A revision to show on the canvas: its flow, and the flow before it. */
export type RevisionOnCanvas = {
	revisionId: string;
	at: number;
	before: Flow;
	after: Flow;
};

/**
 * The revisions of a flow in a Sheet, newest first: who saved each, when,
 * on which computer, and what it changed. One opens to list its changes,
 * to show them on the canvas, or to restore it.
 */
export function RevisionsSheet({
	projectId,
	name,
	open,
	onOpenChange,
	selectedId,
	onSelect,
	dirty,
	onShow,
	onRestored,
}: {
	projectId: string;
	name: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The revision open in the list. */
	selectedId: string | null;
	onSelect: (revisionId: string | null) => void;
	/** The draft has changes that are not saved. A restore replaces them. */
	dirty: boolean;
	onShow: (revision: RevisionOnCanvas) => void;
	onRestored: (flow: Flow, issues: FlowIssue[]) => void;
}) {
	const revisions = useQuery({
		...flowQueries.revisions(projectId, name),
		enabled: open,
	});
	const items = revisions.data ?? [];

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="gap-0 data-[side=right]:sm:max-w-md">
				<SheetHeader className="border-b">
					<SheetTitle>Revisions</SheetTitle>
					<SheetDescription>
						Newest first. Open one to see what it changed, or to restore it.
					</SheetDescription>
				</SheetHeader>
				<ScrollArea className="min-h-0 flex-1">
					<div className="p-4">
						{revisions.isLoading ? (
							<div className="flex flex-col gap-2">
								<Skeleton className="h-14 w-full" />
								<Skeleton className="h-14 w-full" />
								<Skeleton className="h-14 w-full" />
							</div>
						) : items.length === 0 ? (
							<Empty>
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<HistoryIcon aria-hidden="true" />
									</EmptyMedia>
									<EmptyTitle>No revisions yet</EmptyTitle>
									<EmptyDescription>
										{revisions.error
											? revisions.error.message
											: "Each save adds a revision. Save the flow to add the first one."}
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						) : (
							<ItemGroup className="gap-2">
								{items.map((item, index) => (
									<RevisionRow
										key={item.id}
										projectId={projectId}
										name={name}
										item={item}
										previous={items[index + 1] ?? null}
										selected={item.id === selectedId}
										dirty={dirty}
										onToggle={() =>
											onSelect(item.id === selectedId ? null : item.id)
										}
										onShow={onShow}
										onRestored={onRestored}
									/>
								))}
							</ItemGroup>
						)}
					</div>
				</ScrollArea>
			</SheetContent>
		</Sheet>
	);
}

function RevisionRow({
	projectId,
	name,
	item,
	previous,
	selected,
	dirty,
	onToggle,
	onShow,
	onRestored,
}: {
	projectId: string;
	name: string;
	item: FlowRevisionItem;
	/** The revision before this one, or null for the first. */
	previous: FlowRevisionItem | null;
	selected: boolean;
	dirty: boolean;
	onToggle: () => void;
	onShow: (revision: RevisionOnCanvas) => void;
	onRestored: (flow: Flow, issues: FlowIssue[]) => void;
}) {
	const labels = item.changes ? summaryLabels(item.changes) : [];
	return (
		<div className="flex flex-col rounded-lg border">
			<Item
				size="sm"
				render={<button type="button" />}
				aria-expanded={selected}
				onClick={onToggle}
				className="w-full rounded-lg border-0 text-left"
			>
				<ItemContent className="min-w-0 gap-1">
					<ItemTitle className="flex flex-wrap items-center gap-1.5">
						<LocalTime at={item.at} className="tabular-nums">
							{formatDateTime(item.at)}
						</LocalTime>
						<Badge variant="outline">{REVISION_KIND_LABEL[item.kind]}</Badge>
						{item.current ? <Badge variant="secondary">Current</Badge> : null}
					</ItemTitle>
					<ItemDescription className="truncate">
						{revisionAuthor(item)}
					</ItemDescription>
					{item.changes && !selected ? (
						<ItemDescription className="text-xs">
							{labels.length > 0 ? labels.join(" · ") : "Only node positions"}
						</ItemDescription>
					) : null}
				</ItemContent>
			</Item>
			{selected ? (
				<RevisionDetail
					projectId={projectId}
					name={name}
					item={item}
					previous={previous}
					dirty={dirty}
					onShow={onShow}
					onRestored={onRestored}
				/>
			) : null}
		</div>
	);
}

/** What a revision changed from the one before, and what a person can do with it. */
function RevisionDetail({
	projectId,
	name,
	item,
	previous,
	dirty,
	onShow,
	onRestored,
}: {
	projectId: string;
	name: string;
	item: FlowRevisionItem;
	previous: FlowRevisionItem | null;
	dirty: boolean;
	onShow: (revision: RevisionOnCanvas) => void;
	onRestored: (flow: Flow, issues: FlowIssue[]) => void;
}) {
	const view = useQuery(
		flowQueries.revision(projectId, name, item.id, previous?.id),
	);
	const flow = view.data?.revision.flow ?? null;
	const before = previous ? (view.data?.against.flow ?? null) : null;
	const lines =
		previous && view.data?.diff
			? diffLines(view.data.diff, view.data.revision.flow ?? undefined)
			: [];
	const [confirming, setConfirming] = useState(false);

	return (
		<div className="flex flex-col gap-3 border-t p-3 text-sm">
			{view.isLoading ? (
				<Skeleton className="h-10 w-full" />
			) : view.error ? (
				<p className="text-destructive">{view.error.message}</p>
			) : flow === null ? (
				<p className="text-muted-foreground">
					This revision is not a valid flow. You cannot show or restore it.
				</p>
			) : previous === null ? (
				<p className="text-muted-foreground">The first save of this flow.</p>
			) : lines.length === 0 ? (
				<p className="text-muted-foreground">
					Nothing changed from the revision before.
				</p>
			) : (
				<ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs">
					{lines.map((line) => (
						<li key={line}>{line}</li>
					))}
				</ul>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={flow === null}
					onClick={() => {
						if (flow)
							onShow({
								revisionId: item.id,
								at: item.at,
								before: before ?? flow,
								after: flow,
							});
					}}
				>
					<EyeIcon data-icon="inline-start" />
					Show on canvas
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={flow === null || (item.current && !dirty)}
					title={
						item.current && !dirty
							? "The flow is this revision now."
							: undefined
					}
					onClick={() => setConfirming(true)}
				>
					<RotateCcwIcon data-icon="inline-start" />
					Restore this revision
				</Button>
			</div>
			{confirming ? (
				<RestoreDialog
					projectId={projectId}
					name={name}
					item={item}
					dirty={dirty}
					onClose={() => setConfirming(false)}
					onRestored={onRestored}
				/>
			) : null}
		</div>
	);
}

/** Asks before a restore, with what it changes in the flow as it is now. */
function RestoreDialog({
	projectId,
	name,
	item,
	dirty,
	onClose,
	onRestored,
}: {
	projectId: string;
	name: string;
	item: FlowRevisionItem;
	dirty: boolean;
	onClose: () => void;
	onRestored: (flow: Flow, issues: FlowIssue[]) => void;
}) {
	const againstNow = useQuery(flowQueries.revision(projectId, name, item.id));
	const flow = againstNow.data?.revision.flow ?? null;
	const diff = againstNow.data?.diff;
	const labels = diff ? summaryLabels(flowDiffSummary(diff)) : [];
	const when = formatDateTime(item.at);

	const restore = useMutation(
		flowMutations.restore({
			onSuccess: (issues) => {
				if (flow) onRestored(flow, issues);
				toast.success(`Restored the revision of ${when}`);
				onClose();
			},
			onError: (error) => toast.error(`Could not restore: ${error.message}`),
		}),
	);

	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Restore the revision of {when}?</AlertDialogTitle>
					<AlertDialogDescription>
						The flow becomes this revision again. Night Shift saves it as a new
						revision, so you lose nothing.
						{dirty ? " Your unsaved changes are lost." : ""}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{labels.length > 0 ? (
					<div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
						What changes in the saved flow:
						{labels.map((label) => (
							<Badge key={label} variant="outline">
								{label}
							</Badge>
						))}
					</div>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={flow === null || restore.isPending}
						onClick={() =>
							restore.mutate({ projectId, name, revisionId: item.id })
						}
					>
						{restore.isPending ? (
							<Spinner data-icon="inline-start" />
						) : (
							<RotateCcwIcon data-icon="inline-start" />
						)}
						{restore.isPending ? "Restoring…" : "Restore"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
