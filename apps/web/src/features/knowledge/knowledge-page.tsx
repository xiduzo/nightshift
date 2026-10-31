import { hasEnded } from "@nightshift/client";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
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
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import {
	BookOpenIcon,
	CircleAlertIcon,
	LightbulbIcon,
	PlusIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { StartRunDialog } from "@/features/flows";
import { ProjectPage } from "@/features/projects";
import type { KnowledgeFile } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatDateTime, formatRelative, formatSize } from "@/shared/format";
import { PageHeading, PageSection } from "@/shared/page";
import { KnowledgeFileSheet } from "./knowledge-file-sheet";
import { KnowledgeSearch } from "./knowledge-search";
import { knowledgeQueries } from "./queries";
import { AskedQuestions } from "./questions";
import { type EditedSource, SourceDialog } from "./source-dialog";
import { Sources } from "./sources";

/** How often the page reads the knowledge again while a source syncs. */
const SYNCING_POLL_MS = 3_000;

/**
 * A project's Knowledge page: the files its agents read, when each changed
 * and its size, and the sources that fill them: add one, edit or remove
 * it, or sync it now.
 */
export function ProjectKnowledgePage({ projectId }: { projectId: string }) {
	return (
		<ProjectPage projectId={projectId} section="Knowledge">
			{(project) => <KnowledgeSection projectId={project.id} />}
		</ProjectPage>
	);
}

/**
 * The page's heading with Add source, the view, and the source dialog. A
 * person who may not save flows does not get Add source.
 */
function KnowledgeSection({ projectId }: { projectId: string }) {
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
	onAdd,
	onEdit,
}: {
	projectId: string;
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
	const [open, setOpen] = useState<string | null>(null);
	const columns = useMemo(() => fileColumns(setOpen), []);

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
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}
	const { files, syncs, tooLarge, proposed, reviews, shared, can, olderHost } =
		knowledge.data;
	if (files.length === 0 && syncs.length === 0 && proposed === 0) {
		return <NoKnowledge onAdd={onAdd} />;
	}
	return (
		<>
			{olderHost ? (
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
			{proposed > 0 ? (
				<Learnings
					projectId={projectId}
					proposed={proposed}
					reviews={reviews}
					mayReview={can.startRuns}
				/>
			) : null}
			{syncs.length > 0 ? (
				<Sources
					projectId={projectId}
					syncs={syncs}
					shared={shared}
					can={can}
					onEdit={onEdit}
				/>
			) : (
				<Alert>
					<BookOpenIcon />
					<AlertTitle>Nothing adds files to this knowledge</AlertTitle>
					<AlertDescription>
						Add a source, such as a folder or web pages, to keep it up to date.
					</AlertDescription>
					{onAdd ? (
						<AlertAction>
							<Button size="sm" variant="outline" onClick={onAdd}>
								Add source
							</Button>
						</AlertAction>
					) : null}
				</Alert>
			)}
			{files.length > 0 ? <KnowledgeSearch projectId={projectId} /> : null}
			{files.length > 0 ? (
				<AskedQuestions
					projectId={projectId}
					files={files.map((file) => file.path)}
				/>
			) : null}
			<PageSection
				title="Files"
				description={`${files.length} ${files.length === 1 ? "file" : "files"}.`}
			>
				{tooLarge ? (
					<Alert>
						<TriangleAlertIcon />
						<AlertTitle>This knowledge is very large</AlertTitle>
						<AlertDescription>
							It has more than 2 000 files. Agents find less in this much text.
							Sync only what they need.
						</AlertDescription>
					</Alert>
				) : null}
				<Card className="py-0">
					<CardContent className="px-0">
						{files.length === 0 ? (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>No files yet</EmptyTitle>
									<EmptyDescription>
										Choose Sync now on a source above to add its files.
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						) : (
							<DataTable
								columns={columns}
								data={files}
								getRowId={(file) => file.path}
								pageSize={50}
							/>
						)}
					</CardContent>
				</Card>
			</PageSection>
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

/**
 * The learnings agents proposed, which wait for a person, and the flow
 * that asks about them.
 */
function Learnings({
	projectId,
	proposed,
	reviews,
	mayReview,
}: {
	projectId: string;
	proposed: number;
	reviews: string[];
	/** The person may start the review: a role that may start runs. */
	mayReview: boolean;
}) {
	const [open, setOpen] = useState(false);
	const review = reviews[0];
	const notes = `${proposed} ${proposed === 1 ? "learning waits" : "learnings wait"} for you`;
	return (
		<Alert>
			<LightbulbIcon />
			<AlertTitle>{notes}</AlertTitle>
			<AlertDescription>
				{!mayReview
					? "Agents learned something about this project. Ask a Member of this Space to review it."
					: review
						? "Agents learned something about this project. Keep what is right. Agents read it in later runs."
						: "Agents learned something about this project. Add the review-learnings starter flow to keep or delete it."}
			</AlertDescription>
			{review && mayReview ? (
				<AlertAction>
					<Button size="sm" onClick={() => setOpen(true)}>
						Review learnings
					</Button>
					<StartRunDialog
						open={open}
						onOpenChange={setOpen}
						projectId={projectId}
						flowName={review}
					/>
				</AlertAction>
			) : null}
		</Alert>
	);
}

const column = dataTableColumns<KnowledgeFile>();

/** The columns of the file list. A file's path opens it. */
function fileColumns(open: (path: string) => void) {
	return column.columns([
		column.accessor("path", {
			header: "File",
			cell: ({ row }) => (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="link"
						className="h-auto whitespace-normal break-all p-0 text-left font-mono text-xs"
						onClick={() => open(row.original.path)}
					>
						{row.original.path}
					</Button>
					{row.original.local ? (
						<Tooltip>
							<TooltipTrigger render={<Badge variant="secondary" />}>
								On one computer
							</TooltipTrigger>
							<TooltipContent>
								Larger than 10 MB. It stays on the computer that synced it.
							</TooltipContent>
						</Tooltip>
					) : null}
				</div>
			),
			meta: {
				headClassName: "pl-6",
				cellClassName: "w-full max-w-0 py-3 pl-6",
			},
		}),
		column.accessor("changedAt", {
			header: "Changed",
			cell: ({ row }) => (
				<time
					dateTime={new Date(row.original.changedAt).toISOString()}
					title={formatDateTime(row.original.changedAt)}
					className="whitespace-nowrap text-muted-foreground text-sm"
				>
					{formatRelative(row.original.changedAt)}
				</time>
			),
			meta: { cellClassName: "py-3" },
		}),
		column.accessor("size", {
			header: "Size",
			cell: ({ row }) => (
				<span className="whitespace-nowrap text-muted-foreground text-sm tabular-nums">
					{formatSize(row.original.size)}
				</span>
			),
			meta: { headClassName: "pr-6", cellClassName: "py-3 pr-6 text-right" },
		}),
	]);
}
