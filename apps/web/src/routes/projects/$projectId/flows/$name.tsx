import { flowNameSchema } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { FlowEditor } from "@/components/flow-editor/flow-editor";
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

	if (!validName) {
		return (
			<Problem
				projectId={projectId}
				title="Not a flow name"
				description="Flow names use lowercase letters, digits and -."
			/>
		);
	}

	if (loaded.isLoading) {
		return (
			<main className="flex flex-col gap-3 px-4 py-4">
				<Skeleton className="h-6 w-64" />
				<Skeleton className="h-96 w-full" />
			</main>
		);
	}

	if (!loaded.data) {
		return (
			<Problem
				projectId={projectId}
				title="Flow not available"
				description={loaded.error?.message ?? "This flow does not exist."}
			/>
		);
	}

	if (!loaded.data.flow && !startOver) {
		return (
			<main className="min-h-0 overflow-y-auto px-4 py-6">
				<Empty className="mx-auto max-w-2xl border">
					<EmptyHeader>
						<EmptyTitle>The flow file does not load</EmptyTitle>
						<EmptyDescription>
							<span className="font-mono">{loaded.data.path}</span> does not
							match the flow schema. Fix the file by hand, or start over.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<ul className="w-full text-left text-destructive text-xs">
							{loaded.data.issues.map((issue, index) => (
								<li key={`${issue.message}:${index}`}>{issue.message}</li>
							))}
						</ul>
						<div className="flex gap-2">
							<Button variant="outline" onClick={() => setStartOver(true)}>
								Start over with a new flow
							</Button>
							<Button
								variant="ghost"
								nativeButton={false}
								render={
									<Link to="/projects/$projectId" params={{ projectId }} />
								}
							>
								Back to the project
							</Button>
						</div>
					</EmptyContent>
				</Empty>
			</main>
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

function Problem({
	projectId,
	title,
	description,
}: {
	projectId: string;
	title: string;
	description: string;
}) {
	return (
		<main className="px-4 py-6">
			<Empty className="border">
				<EmptyHeader>
					<EmptyTitle>{title}</EmptyTitle>
					<EmptyDescription>
						{description}{" "}
						<Link to="/projects/$projectId" params={{ projectId }}>
							Back to the project
						</Link>
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</main>
	);
}
