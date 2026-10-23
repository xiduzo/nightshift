import { createProjectQueries } from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { History, Inbox, Workflow } from "lucide-react-native";

import { useHostQueries } from "@/features/host";
import { ErrorAlert } from "@/shared/feedback";
import { LargeTitleHeader } from "@/shared/header";
import { ListGroup, ListRow } from "@/shared/list";
import { Screen } from "@/shared/page";

/** One project: the way to its Gates, its runs and its flows. */
export function ProjectScreen({ projectId }: { projectId: string }) {
	const projectQueries = useHostQueries(createProjectQueries);
	const projects = useQuery(projectQueries.list());
	const project = projects.data?.find((p) => p.id === projectId);

	return (
		<Screen onRefresh={() => projects.refetch()}>
			<Stack.Screen options={{ title: project?.name ?? "Project" }} />
			{project ? (
				<>
					<LargeTitleHeader
						title={project.name}
						summary={project.remote ?? undefined}
					/>
					<ListGroup>
						<ListRow icon={Inbox} title="Gates" href="/inbox" />
						<ListRow icon={History} title="Runs" href="/runs" />
						<ListRow icon={Workflow} title="Flows" href="/flows" />
					</ListGroup>
				</>
			) : projects.data ? (
				<ErrorAlert
					title="This project is not in this Space"
					message="It may belong to another Space."
					fix="Choose that Space on the Projects tab."
				/>
			) : projects.isError ? (
				<ErrorAlert
					title="This project did not load"
					message={projects.error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void projects.refetch()}
				/>
			) : (
				<Skeleton className="h-40 w-full rounded-xl" />
			)}
		</Screen>
	);
}
