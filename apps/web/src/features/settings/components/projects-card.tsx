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
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FolderGitIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { flowQueries } from "@/features/flows";
import {
	projectFolder,
	projectMutations,
	projectQueries,
} from "@/features/projects";
import { runQueries } from "@/features/runs";
import type { Project } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { PageSection } from "@/shared/page";

export function ProjectsCard() {
	const queryClient = useQueryClient();
	const projects = useQuery(projectQueries.list());
	const flows = useQueries({
		queries: (projects.data ?? []).map((project) => ({
			...flowQueries.list(project.id),
			staleTime: 30_000,
			meta: { quietErrors: true },
		})),
	});
	const [toRemove, setToRemove] = useState<Project | null>(null);
	const removeProject = useMutation(
		projectMutations.remove({
			onSuccess: () => {
				setToRemove(null);
				void queryClient.invalidateQueries({ queryKey: projectQueries.all() });
				void queryClient.invalidateQueries({ queryKey: runQueries.all() });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<PageSection
			title="Projects"
			description="The git repositories Night Shift works in. Each run works on its own copy, so your checkout stays as it is."
		>
			<Card className="py-0">
				<CardContent className="px-0">
					{projects.isLoading ? (
						<div className="flex flex-col gap-3 p-6">
							<Skeleton className="h-6 w-full" />
							<Skeleton className="h-6 w-2/3" />
						</div>
					) : !projects.data || projects.data.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FolderGitIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>No projects yet</EmptyTitle>
								<EmptyDescription>
									Add a git repository with + next to Projects in the sidebar.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<DataTable
							columns={projectColumns({
								flowCounts: flows.map((flow) => flow.data?.length),
								removing: removeProject.isPending,
								onRemove: setToRemove,
							})}
							data={projects.data}
							getRowId={(project) => project.id}
						/>
					)}
				</CardContent>
				<AlertDialog
					open={toRemove !== null}
					onOpenChange={(open) => {
						if (!open) setToRemove(null);
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								Remove {toRemove?.name} from Night Shift?
							</AlertDialogTitle>
							<AlertDialogDescription>
								Night Shift forgets the project and its runs. The repository at{" "}
								<span className="font-mono">
									{toRemove ? projectFolder(toRemove) : null}
								</span>{" "}
								stays as it is.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								disabled={removeProject.isPending}
								onClick={() => {
									if (toRemove)
										removeProject.mutate({ projectId: toRemove.id });
								}}
							>
								{removeProject.isPending ? (
									<Spinner data-icon="inline-start" />
								) : null}
								{removeProject.isPending ? "Removing…" : "Remove project"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</Card>
		</PageSection>
	);
}

const projectColumn = dataTableColumns<Project>();

function projectColumns({
	flowCounts,
	removing,
	onRemove,
}: {
	/** The number of flows of each project, in list order; undefined while it loads. */
	flowCounts: (number | undefined)[];
	removing: boolean;
	onRemove: (project: Project) => void;
}) {
	return projectColumn.columns([
		projectColumn.accessor("name", {
			header: "Project",
			cell: ({ row: { original: project, index } }) => {
				const count = flowCounts[index];
				return (
					<div className="flex min-w-0 flex-col gap-0.5">
						<Link
							to="/projects/$projectId"
							params={{ projectId: project.id }}
							className="truncate font-medium underline-offset-4 hover:underline"
						>
							{project.name}
						</Link>
						<span className="text-muted-foreground text-xs tabular-nums">
							{count === undefined
								? "Flows…"
								: `${count} ${count === 1 ? "flow" : "flows"}`}
						</span>
						<span
							className="truncate font-mono text-muted-foreground text-xs md:hidden"
							title={projectFolder(project)}
						>
							{projectFolder(project)}
						</span>
					</div>
				);
			},
			meta: {
				headClassName: "pl-6",
				cellClassName: "max-w-0 pl-6 md:max-w-none",
			},
		}),
		projectColumn.accessor("repoPath", {
			header: "Folder",
			cell: ({ row }) => (
				<span
					className="block truncate font-mono text-muted-foreground text-xs"
					title={projectFolder(row.original)}
				>
					{projectFolder(row.original)}
				</span>
			),
			meta: {
				headClassName: "hidden md:table-cell",
				cellClassName: "hidden max-w-80 md:table-cell",
			},
		}),
		projectColumn.display({
			id: "actions",
			header: () => <span className="sr-only">Actions</span>,
			cell: ({ row: { original: project } }) => (
				<Button
					variant="ghost"
					size="sm"
					className="text-muted-foreground hover:text-destructive"
					disabled={removing}
					aria-label={`Remove ${project.name}`}
					onClick={() => onRemove(project)}
				>
					<Trash2Icon data-icon="inline-start" />
					<span className="hidden sm:inline">Remove</span>
				</Button>
			),
			meta: {
				headClassName: "pr-6 text-right",
				cellClassName: "w-0 pr-6 text-right",
			},
		}),
	]);
}
