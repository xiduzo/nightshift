import { hasEnded } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import {
	BookOpenIcon,
	CircleAlertIcon,
	LibraryIcon,
	ListChecksIcon,
	NetworkIcon,
	PlusIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { ProjectPage } from "@/features/projects";
import type { Knowledge } from "@/shared/api";
import { PageHeading } from "@/shared/page";
import { FilesTab } from "./files-tab";
import { KnowledgeFileSheet } from "./knowledge-file-sheet";
import { MapTab } from "./map-tab";
import { knowledgeQueries } from "./queries";
import { learningTaskId } from "./review-queue";
import { ReviewTab } from "./review-tab";
import { type EditedSource, SourceDialog } from "./source-dialog";
import { useReview } from "./use-review";

/** How often the page reads the knowledge again while a source syncs. */
const SYNCING_POLL_MS = 3_000;

/** The views of the Knowledge page. */
export type KnowledgeTab = "review" | "knows" | "map";

/** Where on the page a person is, as its address holds it. */
export type KnowledgeLocation = { tab: KnowledgeTab; node?: string };

/**
 * A project's Knowledge page, in three tabs: Review, what waits for a person.
 * What agents know, the files by folder, the sources and the questions. Map,
 * how it connects.
 */
export function ProjectKnowledgePage({
	projectId,
	tab,
	node,
	onView,
}: {
	projectId: string;
	tab?: KnowledgeTab | undefined;
	/** On the Map: the node to start from. */
	node?: string | undefined;
	onView: (view: KnowledgeLocation) => void;
}) {
	return (
		<ProjectPage projectId={projectId} section="Knowledge">
			{(project) => (
				<KnowledgeSection
					projectId={project.id}
					tab={tab}
					node={node}
					onView={onView}
				/>
			)}
		</ProjectPage>
	);
}

/**
 * The page's heading with Add source, the view, and the source dialog. A
 * person who may not save flows does not get Add source.
 */
function KnowledgeSection({
	projectId,
	tab,
	node,
	onView,
}: {
	projectId: string;
	tab: KnowledgeTab | undefined;
	node: string | undefined;
	onView: (view: KnowledgeLocation) => void;
}) {
	const knowledge = useQuery(knowledgeQueries.get(projectId));
	const can = knowledge.data?.can;
	// Null: closed. "new": a new source. Else the source to edit.
	const [dialog, setDialog] = useState<EditedSource | "new" | null>(null);
	const [shown, setShown] = useState<EditedSource | null>(null);
	const open = (source: EditedSource | "new") => {
		setShown(source === "new" ? null : source);
		setDialog(source);
	};
	return (
		<section
			aria-labelledby="knowledge-heading"
			className="flex flex-col gap-6"
		>
			<PageHeading
				id="knowledge-heading"
				title="Knowledge"
				description="Files your agents read before they work. Every computer in this Space gets the same files."
				actions={
					can?.save ? (
						<Button onClick={() => open("new")}>
							<PlusIcon data-icon="inline-start" />
							Add source
						</Button>
					) : undefined
				}
			/>
			<KnowledgeView
				projectId={projectId}
				tab={tab}
				node={node}
				onView={onView}
				onAdd={can?.save ? () => open("new") : undefined}
				onEdit={open}
			/>
			<SourceDialog
				open={dialog !== null}
				onOpenChange={(next) => {
					if (!next) setDialog(null);
				}}
				projectId={projectId}
				edited={shown}
				shared={knowledge.data?.shared ?? false}
				schedules={can?.schedules ?? false}
				startRuns={can?.startRuns ?? false}
			/>
		</section>
	);
}

function KnowledgeView({
	projectId,
	tab,
	node,
	onView,
	onAdd,
	onEdit,
}: {
	projectId: string;
	tab: KnowledgeTab | undefined;
	node: string | undefined;
	onView: (view: KnowledgeLocation) => void;
	/** Unset: the person may not add a source. */
	onAdd: (() => void) | undefined;
	onEdit: (source: EditedSource) => void;
}) {
	const knowledge = useQuery({
		...knowledgeQueries.get(projectId),
		// While a source syncs: its files and its last sync come in.
		refetchInterval: (query) =>
			query.state.data?.syncs.some(
				(sync) => sync.lastRun !== null && !hasEnded(sync.lastRun.status),
			)
				? SYNCING_POLL_MS
				: false,
	});

	if (knowledge.error) {
		return (
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertTitle>The knowledge did not load</AlertTitle>
				<AlertDescription>{knowledge.error.message}</AlertDescription>
			</Alert>
		);
	}
	if (knowledge.isLoading || !knowledge.data) {
		return (
			<div className="flex flex-col gap-2">
				<Skeleton className="h-9 w-72" />
				<Skeleton className="h-56 w-full" />
			</div>
		);
	}
	const { files, syncs, proposed } = knowledge.data;
	if (files.length === 0 && syncs.length === 0 && proposed === 0) {
		return <NoKnowledge onAdd={onAdd} />;
	}
	return (
		<KnowledgeTabs
			projectId={projectId}
			knowledge={knowledge.data}
			tab={tab}
			node={node}
			onView={onView}
			onAdd={onAdd}
			onEdit={onEdit}
		/>
	);
}

/**
 * The three views of the knowledge. It starts on Review when something waits
 * for a person, and on What agents know when nothing does.
 */
function KnowledgeTabs({
	projectId,
	knowledge,
	tab,
	node,
	onView,
	onAdd,
	onEdit,
}: {
	projectId: string;
	knowledge: Knowledge;
	tab: KnowledgeTab | undefined;
	node: string | undefined;
	onView: (view: KnowledgeLocation) => void;
	onAdd: (() => void) | undefined;
	onEdit: (source: EditedSource) => void;
}) {
	const review = useReview(projectId, knowledge);
	const [open, setOpen] = useState<string | null>(null);
	const startsOnReview =
		knowledge.proposed > 0 ||
		knowledge.syncs.some((sync) => sync.health !== null);
	const shown = tab ?? (startsOnReview ? "review" : "knows");
	const waiting = review.queue.length;
	return (
		<>
			{knowledge.olderHost ? (
				<Alert>
					<TriangleAlertIcon />
					<AlertTitle>This knowledge stays on this computer for now</AlertTitle>
					<AlertDescription>
						The computer that keeps this Space runs an older version of Night
						Shift. Update Night Shift there to share this knowledge with your
						other devices.
					</AlertDescription>
				</Alert>
			) : null}
			<Tabs
				value={shown}
				onValueChange={(next) => onView({ tab: next as KnowledgeTab })}
				className="gap-4"
			>
				<TabsList>
					<TabsTrigger value="review">
						<ListChecksIcon aria-hidden="true" />
						Review
						{waiting > 0 ? (
							<Badge variant="secondary" className="tabular-nums">
								{waiting}
							</Badge>
						) : null}
					</TabsTrigger>
					<TabsTrigger value="knows">
						<LibraryIcon aria-hidden="true" />
						What agents know
					</TabsTrigger>
					<TabsTrigger value="map">
						<NetworkIcon aria-hidden="true" />
						Map
					</TabsTrigger>
				</TabsList>
				<TabsContent value="review">
					<ReviewTab
						projectId={projectId}
						review={review}
						can={knowledge.can}
						fileCount={knowledge.files.length}
						active={shown === "review"}
						onOpenFile={setOpen}
						onAddSource={onAdd}
						onShowOnMap={(next) => onView({ tab: "map", node: next })}
						onShowFiles={() => onView({ tab: "knows" })}
					/>
				</TabsContent>
				<TabsContent value="knows">
					<FilesTab
						projectId={projectId}
						knowledge={knowledge}
						onOpenFile={setOpen}
						onAdd={onAdd}
						onEdit={onEdit}
					/>
				</TabsContent>
				<TabsContent value="map">
					<MapTab
						projectId={projectId}
						focus={node ?? null}
						onOpenFile={setOpen}
						onReview={(learningId) => {
							review.bringForward(learningTaskId(learningId));
							onView({ tab: "review" });
						}}
					/>
				</TabsContent>
			</Tabs>
			<KnowledgeFileSheet
				projectId={projectId}
				path={open}
				onClose={() => setOpen(null)}
			/>
		</>
	);
}

/** Nothing yet: what knowledge is, and how to start. */
function NoKnowledge({ onAdd }: { onAdd: (() => void) | undefined }) {
	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<BookOpenIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>No knowledge yet</EmptyTitle>
				<EmptyDescription>
					Knowledge is what your agents read besides the code. Add a folder of
					notes, web pages or a wiki, and Night Shift keeps a copy here.
				</EmptyDescription>
			</EmptyHeader>
			{onAdd ? (
				<EmptyContent>
					<Button onClick={onAdd}>
						<PlusIcon data-icon="inline-start" />
						Add source
					</Button>
				</EmptyContent>
			) : null}
		</Empty>
	);
}
