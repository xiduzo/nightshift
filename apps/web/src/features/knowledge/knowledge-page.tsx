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
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	BookOpenIcon,
	CircleAlertIcon,
	LightbulbIcon,
	RefreshCwIcon,
	TriangleAlertIcon,
	UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { flowQueries, StartRunDialog } from "@/features/flows";
import { ProjectPage } from "@/features/projects";
import type { Knowledge, KnowledgeFile } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatDateTime, formatRelative, formatSize } from "@/shared/format";
import { PageHeading, PageSection } from "@/shared/page";
import { KnowledgeFileSheet } from "./knowledge-file-sheet";
import { KnowledgeSearch } from "./knowledge-search";
import { knowledgeQueries } from "./queries";

/** What each knowledge kit fills the folder from, for a person. */
const KIT_LABELS: Record<string, string> = {
	"kit:knowledge/files": "Project files",
	"kit:knowledge/github-wiki": "GitHub wiki",
	"kit:knowledge/web": "Web pages",
	"kit:knowledge/jira": "Jira",
	"kit:knowledge/confluence": "Confluence",
};

/**
 * A project's Knowledge page: the files its agents read on this computer,
 * when each changed and its size, and the flows that fill them, each with
 * a button that runs it now.
 */
export function ProjectKnowledgePage({ projectId }: { projectId: string }) {
	return (
		<ProjectPage projectId={projectId} section="Knowledge">
			{(project) => (
				<section
					aria-labelledby="knowledge-heading"
					className="flex flex-col gap-6"
				>
					<PageHeading
						id="knowledge-heading"
						title="Knowledge"
						description="Files your agents read before they work. Every computer in this Space gets the same files."
					/>
					<KnowledgeView projectId={project.id} />
				</section>
			)}
		</ProjectPage>
	);
}

function KnowledgeView({ projectId }: { projectId: string }) {
	const knowledge = useQuery(knowledgeQueries.get(projectId));
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
	const { files, syncs, tooLarge, proposed, reviews, shared } = knowledge.data;
	if (files.length === 0 && syncs.length === 0 && proposed === 0) {
		return <NoKnowledge projectId={projectId} />;
	}
	return (
		<>
			{proposed > 0 ? (
				<Learnings
					projectId={projectId}
					proposed={proposed}
					reviews={reviews}
				/>
			) : null}
			<Syncs projectId={projectId} syncs={syncs} shared={shared} />
			{files.length > 0 ? <KnowledgeSearch projectId={projectId} /> : null}
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
										Choose Sync now above to add files.
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
function NoKnowledge({ projectId }: { projectId: string }) {
	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<BookOpenIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>No knowledge yet</EmptyTitle>
				<EmptyDescription>
					Knowledge is what your agents read besides the code, such as a wiki or
					web pages. Add a flow with a knowledge kit, then run it.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button
					render={
						<Link to="/projects/$projectId/flows" params={{ projectId }} />
					}
				>
					Go to flows
				</Button>
			</EmptyContent>
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
}: {
	projectId: string;
	proposed: number;
	reviews: string[];
}) {
	const [open, setOpen] = useState(false);
	const review = reviews[0];
	const notes = `${proposed} ${proposed === 1 ? "learning waits" : "learnings wait"} for you`;
	return (
		<Alert>
			<LightbulbIcon />
			<AlertTitle>{notes}</AlertTitle>
			<AlertDescription>
				{review
					? "Agents learned something about this project. Keep what is right. Agents read it in later runs."
					: "Agents learned something about this project. Add the review-learnings starter flow to keep or delete it."}
			</AlertDescription>
			{review ? (
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

/**
 * The flows that fill the knowledge, each with a button that runs it now.
 * In a shared Space, a note that every Member reads what they sync.
 */
function Syncs({
	projectId,
	syncs,
	shared,
}: {
	projectId: string;
	syncs: Knowledge["syncs"];
	shared: boolean;
}) {
	const flows = useQuery({
		...flowQueries.list(projectId),
		meta: { quietErrors: true },
	});
	const [starting, setStarting] = useState<{
		name: string;
		open: boolean;
	} | null>(null);

	return (
		<PageSection
			title="Syncs"
			description="The flows that add files. Schedule one, or run it now."
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
			{syncs.length === 0 ? (
				<Alert>
					<BookOpenIcon />
					<AlertTitle>No flow fills this knowledge</AlertTitle>
					<AlertDescription>
						Add a flow with a knowledge kit, then run it.
					</AlertDescription>
				</Alert>
			) : (
				<ItemGroup className="gap-2">
					{syncs.map((sync) => (
						<Item key={sync.flow} variant="outline">
							<ItemContent>
								<ItemTitle>
									<Link
										to="/projects/$projectId/flows/$name"
										params={{ projectId, name: sync.flow }}
										className="hover:underline"
									>
										{sync.flow}
									</Link>
								</ItemTitle>
								<ItemDescription className="flex flex-wrap gap-1">
									{sync.kits.map((kit) => (
										<Badge key={kit} variant="secondary">
											{KIT_LABELS[kit] ?? kit}
										</Badge>
									))}
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setStarting({ name: sync.flow, open: true })}
								>
									<RefreshCwIcon aria-hidden="true" />
									Sync now
								</Button>
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			)}
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
		</PageSection>
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
