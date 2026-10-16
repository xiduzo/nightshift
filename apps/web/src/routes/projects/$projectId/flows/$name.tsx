import { flowNameSchema } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, CircleAlertIcon, FileWarningIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { FlowEditor } from "@/components/flow-editor/flow-editor";
import { type Crumb, SiteHeader } from "@/components/site-header";
import { newFlow } from "@/lib/flow-draft";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/projects/$projectId/flows/$name")({
	// The canvas measures nodes in the browser; nothing to render on the server.
	ssr: false,
	component: FlowEditorRoute,
});

function FlowEditorRoute() {
	const { projectId, name } = Route.useParams();
	const validName = flowNameSchema.safeParse(name).success;
	const projects = useQuery(orpc.projects.list.queryOptions());
	const loaded = useQuery({
		...orpc.flows.get.queryOptions({ input: { projectId, name } }),
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
				<div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col gap-3 p-3 lg:flex-row lg:p-4">
					<div className="flex min-h-0 flex-1 flex-col gap-3">
						<Skeleton className="h-8 w-full max-w-md" />
						<Skeleton className="min-h-0 flex-1 rounded-xl" />
						<Skeleton className="h-11 w-full rounded-xl" />
					</div>
					<Skeleton className="h-64 rounded-xl lg:h-full lg:w-[30%]" />
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
				<Empty className="mx-auto max-w-2xl flex-none border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<FileWarningIcon />
						</EmptyMedia>
						<EmptyTitle>The flow file does not load</EmptyTitle>
						<EmptyDescription>
							<span className="font-mono">{loaded.data.path}</span> does not
							match the flow schema. Fix the file by hand, or start over.
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
										<li key={`${issue.message}:${index}`}>{issue.message}</li>
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
			<Empty className="mx-auto max-w-2xl flex-none border">
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
							<Link to="/projects/$projectId/flows" params={{ projectId }} />
						}
					>
						<ArrowLeftIcon data-icon="inline-start" />
						Back to flows
					</Button>
				</EmptyContent>
			</Empty>
		</Shell>
	);
}
