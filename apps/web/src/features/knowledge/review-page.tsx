import {
	ASK_A_MEMBER,
	canKeep,
	type ReviewTask,
	taskLine,
} from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
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
	ItemContent,
	ItemDescription,
	ItemGroup,
} from "@nightshift/ui/components/item";
import { Kbd } from "@nightshift/ui/components/kbd";
import { Progress } from "@nightshift/ui/components/progress";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	CheckCircle2Icon,
	CheckIcon,
	CircleAlertIcon,
	FileX2Icon,
	LightbulbIcon,
	NetworkIcon,
	SearchXIcon,
	SkipForwardIcon,
	Trash2Icon,
	TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { formatRelative } from "@/shared/format";
import { fileNameOf } from "./folder-tree";
import { KnowledgeSection, useKnowledge } from "./knowledge-layout";
import { SyncNowButton } from "./sources";
import type { Review } from "./use-review";

/** The tasks the list of what comes next shows, at most. */
const NEXT_SHOWN = 5;

/**
 * What waits for a person, one at a time: sources that fail, learnings,
 * questions that found nothing, files no run used. K keeps, D deletes and
 * S puts off.
 */
export function KnowledgeReviewPage() {
	return (
		<KnowledgeSection
			title="Review"
			description="What waits for you. Keep what agents learned, and fix what they could not find."
		>
			<ReviewQueue />
		</KnowledgeSection>
	);
}

function ReviewQueue() {
	const { projectId, knowledge, review, openFile, addSource } = useKnowledge();
	const navigate = useNavigate();
	const can = knowledge.can;
	const fileCount = knowledge.files.length;
	const onShowOnMap = (node: string) =>
		void navigate({
			to: "/projects/$projectId/knowledge/map",
			params: { projectId },
			search: { node },
		});
	const { queue, total } = review;
	const current = queue[0];
	const mayDecide = can.startRuns;

	useEffect(() => {
		if (!current) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, [role='dialog']")) return;
			if (event.key === "s") review.putOff(current.id);
			if (current.kind !== "learning" || !mayDecide) return;
			if (event.key === "k" && canKeep(current.learning)) {
				review.settle(current, "keep");
			}
			if (event.key === "d") review.settle(current, "delete");
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [current, mayDecide, review]);

	if (review.error) {
		return (
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertTitle>The learnings did not load</AlertTitle>
				<AlertDescription>{review.error.message}</AlertDescription>
			</Alert>
		);
	}
	if (review.loading) return <Skeleton className="h-56 w-full" />;
	if (!current) {
		return (
			<Empty className="border py-16">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<CheckCircle2Icon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>Nothing to review</EmptyTitle>
					<EmptyDescription>
						When an agent learns something, it shows here. You keep it or delete
						it.
					</EmptyDescription>
				</EmptyHeader>
				{fileCount > 0 ? (
					<EmptyContent>
						<Button
							variant="outline"
							nativeButton={false}
							render={
								<Link
									to="/projects/$projectId/knowledge/files"
									params={{ projectId }}
								/>
							}
						>
							Open files
						</Button>
					</EmptyContent>
				) : null}
			</Empty>
		);
	}
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
			<div className="flex items-center gap-3">
				<Progress
					value={total > 0 ? ((total - queue.length) / total) * 100 : 0}
					aria-label="Review progress"
					className="h-1.5 flex-1"
				/>
				<span className="whitespace-nowrap text-muted-foreground text-sm tabular-nums">
					{queue.length} left
				</span>
			</div>
			<TaskCard
				projectId={projectId}
				task={current}
				review={review}
				mayDecide={mayDecide}
				onOpenFile={openFile}
				onAddSource={addSource}
				onShowOnMap={onShowOnMap}
			/>
			{queue.length > 1 ? (
				<div className="flex flex-col gap-1">
					<h3 className="font-medium text-muted-foreground text-sm">Next</h3>
					<ItemGroup className="gap-1">
						{queue.slice(1, NEXT_SHOWN + 1).map((task) => (
							<Item
								key={task.id}
								size="xs"
								variant="muted"
								render={
									<button
										type="button"
										className="text-left"
										onClick={() => review.bringForward(task.id)}
									/>
								}
							>
								<ItemContent>
									<ItemDescription className="line-clamp-1">
										{taskLine(task)}
									</ItemDescription>
								</ItemContent>
							</Item>
						))}
					</ItemGroup>
				</div>
			) : null}
		</div>
	);
}

function TaskCard({
	projectId,
	task,
	review,
	mayDecide,
	onOpenFile,
	onAddSource,
	onShowOnMap,
}: {
	projectId: string;
	task: ReviewTask;
	review: Review;
	mayDecide: boolean;
	onOpenFile: (path: string) => void;
	onAddSource: (() => void) | undefined;
	onShowOnMap: (node: string) => void;
}) {
	const later = (
		<Button
			variant="ghost"
			className="ml-auto"
			onClick={() => review.putOff(task.id)}
		>
			<SkipForwardIcon data-icon="inline-start" />
			Later
			<Kbd>S</Kbd>
		</Button>
	);
	const { node } = task;
	const onMap = node ? (
		<Button variant="ghost" onClick={() => onShowOnMap(node)}>
			<NetworkIcon data-icon="inline-start" />
			Show on map
		</Button>
	) : null;
	switch (task.kind) {
		case "learning": {
			const { learning } = task;
			return (
				<Card>
					<CardHeader>
						<CardDescription className="flex flex-wrap items-center gap-x-2">
							<LightbulbIcon aria-hidden="true" className="size-4" />
							An agent learned this ·
							<Link
								to="/runs/$runId"
								params={{ runId: learning.runId }}
								className="underline underline-offset-2"
							>
								Open run
							</Link>
							· {formatRelative(learning.proposedAt)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{learning.notes.length === 0 ? (
							<p className="text-muted-foreground">
								This text is not available now. Try again when the computer that
								keeps this Space is online.
							</p>
						) : (
							<ul className="flex list-disc flex-col gap-3 pl-5 text-lg leading-snug">
								{learning.notes.map((note, index) => (
									// The notes keep their order, and the same note may come twice.
									<li key={index}>{note}</li>
								))}
							</ul>
						)}
					</CardContent>
					<CardFooter className="flex-wrap gap-2">
						{mayDecide ? (
							<>
								<Button
									disabled={!canKeep(learning)}
									onClick={() => review.settle(task, "keep")}
								>
									<CheckIcon data-icon="inline-start" />
									Keep
									<Kbd>K</Kbd>
								</Button>
								<Button
									variant="outline"
									onClick={() => review.settle(task, "delete")}
								>
									<Trash2Icon data-icon="inline-start" />
									Delete
									<Kbd>D</Kbd>
								</Button>
							</>
						) : (
							<p className="text-muted-foreground text-sm">{ASK_A_MEMBER}</p>
						)}
						{onMap}
						{later}
					</CardFooter>
				</Card>
			);
		}
		case "source":
			return (
				<SourceTask
					projectId={projectId}
					task={task}
					mayDecide={mayDecide}
					later={later}
				/>
			);
		case "question":
			return (
				<Card>
					<CardHeader>
						<CardDescription className="flex flex-wrap items-center gap-x-2">
							<SearchXIcon aria-hidden="true" className="size-4" />
							Agents searched for this and found nothing ·{" "}
							{formatRelative(task.question.lastAt)}
						</CardDescription>
						<CardTitle className="text-lg">{task.question.query}</CardTitle>
					</CardHeader>
					<CardFooter className="flex-wrap gap-2">
						{onAddSource ? (
							<Button onClick={onAddSource}>Add a source for this</Button>
						) : null}
						<Button variant="outline" onClick={() => review.dismiss(task.id)}>
							Not important
						</Button>
						{later}
					</CardFooter>
				</Card>
			);
		case "unused":
			return (
				<Card>
					<CardHeader>
						<CardDescription className="flex flex-wrap items-center gap-x-2">
							<FileX2Icon aria-hidden="true" className="size-4" />
							No run used these files lately
						</CardDescription>
						<CardTitle className="text-lg">
							{task.files.length} {task.files.length === 1 ? "file" : "files"}{" "}
							may not be worth syncing
						</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-1">
						{task.files.slice(0, 12).map((file) => (
							<Badge
								key={file.path}
								variant="outline"
								render={
									<button
										type="button"
										title={file.path}
										onClick={() => onOpenFile(file.path)}
									/>
								}
							>
								<span className="max-w-64 truncate">
									{fileNameOf(file.path)}
								</span>
							</Badge>
						))}
						{task.files.length > 12 ? (
							<Badge variant="secondary">
								and {task.files.length - 12} more
							</Badge>
						) : null}
					</CardContent>
					<CardFooter className="flex-wrap gap-2">
						<Button variant="outline" onClick={() => review.dismiss(task.id)}>
							Keep syncing them
						</Button>
						{later}
					</CardFooter>
				</Card>
			);
	}
}

function SourceTask({
	projectId,
	task,
	mayDecide,
	later,
}: {
	projectId: string;
	task: Extract<ReviewTask, { kind: "source" }>;
	mayDecide: boolean;
	later: ReactNode;
}) {
	const { sync } = task;
	return (
		<Card>
			<CardHeader>
				<CardDescription className="flex flex-wrap items-center gap-x-2">
					<TriangleAlertIcon aria-hidden="true" className="size-4" />
					{sync.health === "failed"
						? "The last sync failed"
						: "This source has not synced in a week"}
					{sync.lastRun ? (
						<>
							·
							<Link
								to="/runs/$runId"
								params={{ runId: sync.lastRun.id }}
								className="underline underline-offset-2"
							>
								Open run
							</Link>
						</>
					) : null}
				</CardDescription>
				<CardTitle className="text-lg">{sync.flow}</CardTitle>
			</CardHeader>
			<CardFooter className="flex-wrap gap-2">
				{mayDecide ? <SyncNowButton projectId={projectId} sync={sync} /> : null}
				{later}
			</CardFooter>
		</Card>
	);
}
