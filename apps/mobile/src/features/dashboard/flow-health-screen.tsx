import {
	createDashboardQueries,
	createProjectQueries,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { Workflow } from "lucide-react-native";

import { useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";
import { healthOf } from "./health";
import { RunHealth } from "./run-health";

/**
 * How your flows did: the share of their runs that finished. With a
 * project, each flow of it; without one, each project over every Space you
 * are in. A sheet from Home (`/flows`) and from a project
 * (`/flows?projectId=…`).
 */
export function FlowHealthScreen({ projectId }: { projectId?: string }) {
	const dashboard = useHostQueries(createDashboardQueries);
	const projectQueries = useHostQueries(createProjectQueries);
	const summary = useQuery({
		...dashboard.summary(projectId ? { projectId } : { everySpace: true }),
		...useWhileFocused(),
	});
	const projects = useQuery({
		...projectQueries.list(),
		enabled: projectId !== undefined,
		...useWhileFocused(),
	});
	const project = projectId
		? projects.data?.find((p) => p.id === projectId)
		: undefined;
	const health = summary.data ? healthOf(summary.data) : null;
	const now = summary.data?.at ?? Date.now();

	return (
		<Screen
			onRefresh={() => summary.refetch()}
			summary="How often their runs finish."
		>
			<Stack.Screen
				options={{ title: project ? `Flows in ${project.name}` : "Flows" }}
			/>
			{summary.data ? (
				health ? (
					<RunHealth health={health} now={now} />
				) : (
					<EmptyState
						icon={Workflow}
						title="No runs yet"
						description="Start a run. Then see here how often each flow finishes."
					/>
				)
			) : summary.isError ? (
				<ErrorAlert
					title="The flows did not load"
					message={summary.error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void summary.refetch()}
				/>
			) : (
				<Skeleton className="h-48 w-full rounded-xl" />
			)}
		</Screen>
	);
}
