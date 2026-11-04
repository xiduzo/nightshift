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
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	BookOpenIcon,
	CheckCircle2Icon,
	FolderIcon,
	PlusIcon,
	SearchXIcon,
} from "lucide-react";
import { useMemo } from "react";
import { OVERVIEW_ROWS } from "@/features/dashboard";
import { formatRelative } from "@/shared/format";
import { fileUse, isUnused } from "./file-use";
import { folderTree } from "./folder-tree";
import {
	AddSourceButton,
	KnowledgeSection,
	useKnowledge,
} from "./knowledge-layout";
import type { KNOWLEDGE_PAGES } from "./knowledge-nav";
import { KnowledgeSearch } from "./knowledge-search";
import { knowledgeQueries } from "./queries";
import { taskLine } from "./review-queue";
import { lastSyncText } from "./source-words";
import { sourceLabel } from "./sources";

/** The topics the Map card shows, at most. */
const TOPICS_SHOWN = 14;

const count = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

/**
 * A project's Knowledge at a glance: the search, what waits for you, and one
 * card for each child page with the facts that matter.
 */
export function KnowledgeOverviewPage() {
	const { projectId, knowledge, addSource } = useKnowledge();
	const nothing =
		knowledge.files.length === 0 &&
		knowledge.syncs.length === 0 &&
		knowledge.proposed === 0;
	return (
		<KnowledgeSection
			title="Knowledge"
			description="What your agents read besides the code. Every computer in this Space gets the same files."
			actions={<AddSourceButton />}
		>
			{nothing ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<BookOpenIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>No knowledge yet</EmptyTitle>
						<EmptyDescription>
							Add a folder of notes, web pages or a wiki. Night Shift keeps a
							copy, and your agents read it while they work.
						</EmptyDescription>
					</EmptyHeader>
					{addSource ? (
						<EmptyContent>
							<Button onClick={addSource}>
								<PlusIcon data-icon="inline-start" />
								Add source
							</Button>
						</EmptyContent>
					) : null}
				</Empty>
			) : (
				<KnowledgeSearch projectId={projectId} idle={<OverviewCards />} />
			)}
		</KnowledgeSection>
	);
}

function OverviewCards() {
	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<ReviewCard />
			<FilesCard />
			<SourcesCard />
			<QuestionsCard />
			<MapCard />
		</div>
	);
}

/** The link to a child page, in the corner of its card. */
function OpenPage({
	to,
	label,
}: {
	to: (typeof KNOWLEDGE_PAGES)[number]["to"];
	label: string;
}) {
	const { projectId } = useKnowledge();
	return (
		<CardAction>
			<Button
				variant="ghost"
				size="sm"
				nativeButton={false}
				render={<Link to={to} params={{ projectId }} />}
			>
				{label}
				<ArrowRightIcon data-icon="inline-end" />
			</Button>
		</CardAction>
	);
}

function ReviewCard() {
	const { projectId, review } = useKnowledge();
	const [first] = review.queue;
	if (review.loading) {
		return <Skeleton className="h-40 w-full lg:col-span-2" />;
	}
	if (!first) {
		return (
			<Card className="lg:col-span-2">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<CheckCircle2Icon aria-hidden="true" className="size-4" />
						Nothing to review
					</CardTitle>
					<CardDescription>
						When an agent learns something, it shows here.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}
	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<CardDescription>Waiting for you</CardDescription>
				<CardTitle className="text-lg">
					{count(review.queue.length, "item", "items")} to review
				</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="line-clamp-2 text-muted-foreground">{taskLine(first)}</p>
			</CardContent>
			<CardFooter>
				<Button
					nativeButton={false}
					render={
						<Link
							to="/projects/$projectId/knowledge/review"
							params={{ projectId }}
						/>
					}
				>
					Start review
				</Button>
			</CardFooter>
		</Card>
	);
}

function FilesCard() {
	const { projectId, knowledge } = useKnowledge();
	const use = useQuery({
		...knowledgeQueries.use(projectId),
		meta: { quietErrors: true },
	});
	const folders = useMemo(
		() =>
			[...folderTree(knowledge.files.map((file) => file.path)).children].sort(
				(a, b) => b.count - a.count,
			),
		[knowledge.files],
	);
	const used = fileUse(use.data);
	const unused = knowledge.files.filter((file) => isUnused(used, file)).length;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Files</CardTitle>
				<CardDescription>
					{count(knowledge.files.length, "file", "files")}.
					{unused > 0 ? ` ${unused} not used lately.` : ""}
				</CardDescription>
				<OpenPage
					to="/projects/$projectId/knowledge/files"
					label="Open files"
				/>
			</CardHeader>
			<CardContent>
				<ItemGroup className="gap-1">
					{folders.slice(0, OVERVIEW_ROWS).map((folder) => (
						<Item
							key={folder.path}
							size="xs"
							variant="muted"
							render={
								<Link
									to="/projects/$projectId/knowledge/files"
									params={{ projectId }}
								/>
							}
						>
							<ItemMedia variant="icon">
								<FolderIcon aria-hidden="true" />
							</ItemMedia>
							<ItemContent>
								<ItemTitle>{folder.name}</ItemTitle>
							</ItemContent>
							<ItemActions className="text-muted-foreground text-xs tabular-nums">
								{folder.count}
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			</CardContent>
		</Card>
	);
}

function SourcesCard() {
	const { projectId, knowledge } = useKnowledge();
	return (
		<Card>
			<CardHeader>
				<CardTitle>Sources</CardTitle>
				<CardDescription>
					{knowledge.syncs.length > 0
						? "Where your files come from."
						: "No source adds files yet."}
				</CardDescription>
				<OpenPage
					to="/projects/$projectId/knowledge/sources"
					label="Open sources"
				/>
			</CardHeader>
			<CardContent>
				<ItemGroup className="gap-1">
					{knowledge.syncs.slice(0, OVERVIEW_ROWS).map((sync) => (
						<Item
							key={sync.flow}
							size="xs"
							variant="muted"
							render={
								<Link
									to="/projects/$projectId/knowledge/sources"
									params={{ projectId }}
								/>
							}
						>
							<ItemContent>
								<ItemTitle>{sourceLabel(sync)}</ItemTitle>
								<ItemDescription>
									{lastSyncText(sync.lastRun, (at) => formatRelative(at))}
								</ItemDescription>
							</ItemContent>
							{sync.health ? (
								<ItemActions>
									<Badge
										variant={
											sync.health === "failed" ? "destructive" : "outline"
										}
									>
										{sync.health === "failed" ? "Failed" : "Out of date"}
									</Badge>
								</ItemActions>
							) : null}
						</Item>
					))}
				</ItemGroup>
			</CardContent>
		</Card>
	);
}

function QuestionsCard() {
	const { projectId } = useKnowledge();
	const questions = useQuery({
		...knowledgeQueries.questions(projectId),
		meta: { quietErrors: true },
	});
	const asked = questions.data?.asked ?? [];
	const nothing = asked.filter((question) => question.hits.length === 0).length;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Questions</CardTitle>
				<CardDescription>
					{asked.length === 0
						? "When an agent searches your files, its question shows here."
						: `Agents asked ${count(asked.length, "question", "questions")}.${nothing > 0 ? ` ${nothing} found nothing.` : ""}`}
				</CardDescription>
				<OpenPage
					to="/projects/$projectId/knowledge/questions"
					label="Open questions"
				/>
			</CardHeader>
			<CardContent>
				<ItemGroup className="gap-1">
					{asked.slice(0, OVERVIEW_ROWS).map((question) => (
						<Item
							key={question.query}
							size="xs"
							variant="muted"
							render={
								<Link
									to="/projects/$projectId/knowledge/questions"
									params={{ projectId }}
								/>
							}
						>
							{question.hits.length === 0 ? (
								<ItemMedia variant="icon">
									<SearchXIcon aria-hidden="true" />
								</ItemMedia>
							) : null}
							<ItemContent className="min-w-0">
								<ItemTitle className="w-full">
									<span className="truncate">{question.query}</span>
								</ItemTitle>
								<ItemDescription>
									{question.hits.length === 0
										? "Found nothing"
										: `Found ${count(question.hits.length, "file", "files")}`}
								</ItemDescription>
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			</CardContent>
		</Card>
	);
}

function MapCard() {
	const { projectId } = useKnowledge();
	const map = useQuery({
		...knowledgeQueries.map(projectId),
		meta: { quietErrors: true },
	});
	const topics = (map.data?.nodes ?? [])
		.filter((node) => node.kind === "topic")
		.sort((a, b) => b.degree - a.degree)
		.slice(0, TOPICS_SHOWN);
	return (
		<Card>
			<CardHeader>
				<CardTitle>Map</CardTitle>
				<CardDescription>
					{topics.length > 0
						? "The topics your files share most."
						: "How your files connect."}
				</CardDescription>
				<OpenPage to="/projects/$projectId/knowledge/map" label="Open map" />
			</CardHeader>
			<CardContent className="flex flex-wrap gap-1">
				{map.isLoading ? <Skeleton className="h-16 w-full" /> : null}
				{topics.map((topic) => (
					<Badge
						key={topic.id}
						variant="secondary"
						render={
							<Link
								to="/projects/$projectId/knowledge/map"
								params={{ projectId }}
								search={{ node: topic.id }}
							/>
						}
					>
						{topic.label}
					</Badge>
				))}
			</CardContent>
		</Card>
	);
}
