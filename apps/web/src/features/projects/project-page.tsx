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
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, FolderXIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Project } from "@/shared/api";
import { type Crumb, SiteHeader } from "@/shared/page";
import { projectQueries } from "./queries";

/**
 * The frame of every page inside a project folder: the header with
 * Home › project › section, and the loading and not-found states. The
 * children render once the project is known.
 */
export function ProjectPage({
	projectId,
	section,
	actions,
	children,
}: {
	projectId: string;
	/** The page inside the project, such as "Flows". None for the dashboard. */
	section?: string;
	/** Header actions, given the project. */
	actions?: (project: Project) => ReactNode;
	children: (project: Project) => ReactNode;
}) {
	const projects = useQuery(projectQueries.list());
	const project = projects.data?.find((p) => p.id === projectId);

	const crumbs = (projectLabel: ReactNode): Crumb[] => [
		{ label: "Home", link: { to: "/" } },
		{
			label: projectLabel,
			link: { to: "/projects/$projectId", params: { projectId } },
		},
		...(section ? [{ label: section }] : []),
	];

	if (projects.isLoading) {
		return (
			<>
				<SiteHeader crumbs={crumbs(<Skeleton className="h-4 w-24" />)} />
				<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
					<div className="flex flex-col gap-2">
						<Skeleton className="h-8 w-56" />
						<Skeleton className="h-4 w-80 max-w-full" />
					</div>
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						<Skeleton className="h-40 w-full rounded-xl" />
						<Skeleton className="h-40 w-full rounded-xl" />
					</div>
				</div>
			</>
		);
	}

	if (!project) {
		return (
			<>
				<SiteHeader
					crumbs={[
						{ label: "Home", link: { to: "/" } },
						{ label: "Not found" },
					]}
				/>
				<div className="flex flex-1 flex-col p-4 md:p-6">
					<Card>
						<CardContent>
							<Empty>
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<FolderXIcon aria-hidden="true" />
									</EmptyMedia>
									<EmptyTitle>Project not found</EmptyTitle>
									<EmptyDescription>It may have been removed.</EmptyDescription>
								</EmptyHeader>
								<EmptyContent>
									<Button
										variant="outline"
										nativeButton={false}
										render={<Link to="/" />}
									>
										<ArrowLeftIcon data-icon="inline-start" />
										Back to Home
									</Button>
								</EmptyContent>
							</Empty>
						</CardContent>
					</Card>
				</div>
			</>
		);
	}

	return (
		<>
			<SiteHeader crumbs={crumbs(project.name)}>
				{actions?.(project)}
			</SiteHeader>
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				{children(project)}
			</div>
		</>
	);
}
