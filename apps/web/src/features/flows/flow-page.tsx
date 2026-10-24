import { flowNameSchema, newFlow } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
import { ArrowLeftIcon, CircleAlertIcon, FileWarningIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { projectQueries } from "@/features/projects";
import { type Crumb, SiteHeader } from "@/shared/page";
import { FlowEditor } from "./editor/flow-editor";

import { flowQueries } from "./queries";

export function FlowPage({
	projectId,
	name,
}: {
	projectId: string;
	name: string;
}) {
	const validName = flowNameSchema.safeParse(name).success;
	const projects = useQuery(projectQueries.list());
	const loaded = useQuery({
		...flowQueries.get(projectId, name),
		enabled: validName,
		// The editor owns the draft once it opens; a refetch must not reset it.
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
	});
	const [startOver, setStartOver] = useState(false);
	const projectName = projects.data?.find((p) => p.id === projectId)?.name;
	const crumbs: Crumb[] = [
		{ label: "Home", link: { to: "/" } },
		{
			label: projectName ?? "Project",
			link: { to: "/projects/$projectId", params: { projectId } },
		},
		{
			label: "Flows",
			link: { to: "/projects/$projectId/flows", params: { projectId } },
		},
		{ label: <span className="font-mono">{name}</span> },
	];

	if (!validName) {
		return (
			<Problem
				crumbs={crumbs}
				projectId={projectId}
				title="Not a flow name"
				description="Flow names use lowercase letters, digits and -."
			/>
		);
	}

	if (loaded.isLoading) {
		return (
			<>
				<SiteHeader crumbs={crumbs} />
				<div className="relative h-[calc(100svh-3.5rem)] min-h-0 bg-muted/40 dark:bg-muted/20">
					<Skeleton className="absolute top-3 left-3 h-24 w-[min(24rem,calc(100%-1.5rem))] rounded-xl" />
					<Skeleton className="absolute top-1/2 left-3 h-80 w-[58px] -translate-y-1/2 rounded-2xl" />
				</div>
			</>
		);
	}

	if (!loaded.data) {
		return (
			<Problem
				crumbs={crumbs}
				projectId={projectId}
				title="Flow not available"
				description={loaded.error?.message ?? "This flow does not exist."}
			/>
		);
	}

	if (!loaded.data.flow && !startOver) {
		return (
			<Shell crumbs={crumbs}>
				<Card className="mx-auto w-full max-w-2xl">
					<CardContent>
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FileWarningIcon />
								</EmptyMedia>
								<EmptyTitle>This flow cannot be opened</EmptyTitle>
								<EmptyDescription>
									The saved flow is not valid. Fix the problems below in its
									file, or start over.
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Alert variant="destructive" className="text-left">
									<CircleAlertIcon />
									<AlertTitle>
										{loaded.data.issues.length}{" "}
										{loaded.data.issues.length === 1 ? "problem" : "problems"}
									</AlertTitle>
									<AlertDescription>
										<ul className="flex list-disc flex-col gap-1 pl-4 text-xs">
											{loaded.data.issues.map((issue, index) => (
												<li key={`${issue.message}:${index}`}>
													{issue.message}
												</li>
											))}
										</ul>
									</AlertDescription>
								</Alert>
								<div className="flex flex-wrap justify-center gap-2">
									<Button variant="outline" onClick={() => setStartOver(true)}>
										Start over with a new flow
									</Button>
									<Button
										variant="ghost"
										nativeButton={false}
										render={
											<Link
												to="/projects/$projectId/flows"
												params={{ projectId }}
											/>
										}
									>
										Back to flows
									</Button>
								</div>
							</EmptyContent>
						</Empty>
					</CardContent>
				</Card>
			</Shell>
		);
	}

	return (
		<FlowEditor
			key={`${projectId}/${name}`}
			projectId={projectId}
			projectName={projectName}
			name={name}
			initialFlow={loaded.data.flow ?? newFlow()}
			initiallySaved={loaded.data.flow !== null}
		/>
	);
}

/** The page frame around a message: the header, then centred content. */
function Shell({ crumbs, children }: { crumbs: Crumb[]; children: ReactNode }) {
	return (
		<>
			<SiteHeader crumbs={crumbs} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
		</>
	);
}

function Problem({
	crumbs,
	projectId,
	title,
	description,
}: {
	crumbs: Crumb[];
	projectId: string;
	title: string;
	description: string;
}) {
	return (
		<Shell crumbs={crumbs}>
			<Card className="mx-auto w-full max-w-2xl">
				<CardContent>
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<FileWarningIcon />
							</EmptyMedia>
							<EmptyTitle>{title}</EmptyTitle>
							<EmptyDescription>{description}</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button
								variant="outline"
								nativeButton={false}
								render={
									<Link
										to="/projects/$projectId/flows"
										params={{ projectId }}
									/>
								}
							>
								<ArrowLeftIcon data-icon="inline-start" />
								Back to flows
							</Button>
						</EmptyContent>
					</Empty>
				</CardContent>
			</Card>
		</Shell>
	);
}
