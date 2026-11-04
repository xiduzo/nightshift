import { hasEnded } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useMatchRoute } from "@tanstack/react-router";
import { CircleAlertIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useId,
	useState,
} from "react";
import { ProjectPage } from "@/features/projects";
import type { Knowledge } from "@/shared/api";
import { PageHeading } from "@/shared/page";
import { KnowledgeFileSheet } from "./knowledge-file-sheet";
import { KNOWLEDGE_PAGES } from "./knowledge-nav";
import { knowledgeQueries } from "./queries";
import { type EditedSource, SourceDialog } from "./source-dialog";
import { type Review, useReview } from "./use-review";

/** How often the page reads the knowledge again while a source syncs. */
const SYNCING_POLL_MS = 3_000;

type KnowledgeShared = {
	projectId: string;
	knowledge: Knowledge;
	/** The review queue. It stays while a person moves between the pages. */
	review: Review;
	openFile: (path: string) => void;
	/** Unset: the person may not add a source. */
	addSource: (() => void) | undefined;
	editSource: (source: EditedSource) => void;
};

const KnowledgeContext = createContext<KnowledgeShared | null>(null);

/** What every page of a project's Knowledge shares. */
export function useKnowledge(): KnowledgeShared {
	const shared = useContext(KnowledgeContext);
	if (!shared) throw new Error("useKnowledge needs a KnowledgeLayout");
	return shared;
}

/**
 * The frame of a project's Knowledge: the toolbar breadcrumb, where a child
 * page opens the others, and what the pages share.
 */
export function KnowledgeLayout({
	projectId,
	children,
}: {
	projectId: string;
	children: ReactNode;
}) {
	const matchRoute = useMatchRoute();
	const params = { projectId };
	const current = KNOWLEDGE_PAGES.find((page) =>
		matchRoute({ to: page.to, params }),
	);
	return (
		<ProjectPage
			projectId={projectId}
			trail={
				current
					? [
							{
								label: "Knowledge",
								link: { to: "/projects/$projectId/knowledge", params },
							},
							{
								label: current.label,
								menu: KNOWLEDGE_PAGES.map((page) => ({
									label: page.label,
									icon: page.icon,
									link: { to: page.to, params },
									current: page === current,
								})),
							},
						]
					: [{ label: "Knowledge" }]
			}
		>
			{() => (
				<KnowledgeLoader projectId={projectId}>{children}</KnowledgeLoader>
			)}
		</ProjectPage>
	);
}

function KnowledgeLoader({
	projectId,
	children,
}: {
	projectId: string;
	children: ReactNode;
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
				<AlertTitle>Your knowledge did not load</AlertTitle>
				<AlertDescription>{knowledge.error.message}</AlertDescription>
			</Alert>
		);
	}
	if (!knowledge.data) {
		return (
			<div className="flex flex-col gap-2">
				<Skeleton className="h-9 w-72" />
				<Skeleton className="h-56 w-full" />
			</div>
		);
	}
	return (
		<KnowledgeProvider projectId={projectId} knowledge={knowledge.data}>
			{children}
		</KnowledgeProvider>
	);
}

function KnowledgeProvider({
	projectId,
	knowledge,
	children,
}: {
	projectId: string;
	knowledge: Knowledge;
	children: ReactNode;
}) {
	const review = useReview(projectId);
	const [open, setOpen] = useState<string | null>(null);
	// Null: closed. "new": a new source. Else the source to edit.
	const [dialog, setDialog] = useState<EditedSource | "new" | null>(null);
	const [shown, setShown] = useState<EditedSource | null>(null);
	const openDialog = (source: EditedSource | "new") => {
		setShown(source === "new" ? null : source);
		setDialog(source);
	};
	return (
		<KnowledgeContext.Provider
			value={{
				projectId,
				knowledge,
				review,
				openFile: setOpen,
				addSource: knowledge.can.save ? () => openDialog("new") : undefined,
				editSource: openDialog,
			}}
		>
			{children}
			<KnowledgeFileSheet
				projectId={projectId}
				path={open}
				onClose={() => setOpen(null)}
			/>
			<SourceDialog
				open={dialog !== null}
				onOpenChange={(next) => {
					if (!next) setDialog(null);
				}}
				projectId={projectId}
				edited={shown}
				shared={knowledge.shared}
				schedules={knowledge.can.schedules}
				startRuns={knowledge.can.startRuns}
			/>
		</KnowledgeContext.Provider>
	);
}

/** The Add source button of a page heading, for a person who may save flows. */
export function AddSourceButton() {
	const { addSource } = useKnowledge();
	if (!addSource) return null;
	return (
		<Button onClick={addSource}>
			<PlusIcon data-icon="inline-start" />
			Add source
		</Button>
	);
}

/** One Knowledge page: its heading, what it must say first, and its content. */
export function KnowledgeSection({
	title,
	description,
	actions,
	children,
}: {
	title: string;
	description: string;
	actions?: ReactNode;
	children: ReactNode;
}) {
	const id = useId();
	const { knowledge } = useKnowledge();
	return (
		<section aria-labelledby={id} className="flex flex-col gap-6">
			<PageHeading
				id={id}
				title={title}
				description={description}
				actions={actions}
			/>
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
			{children}
		</section>
	);
}
