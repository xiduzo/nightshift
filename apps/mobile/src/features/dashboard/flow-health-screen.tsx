import {
	createDashboardQueries,
	createProjectQueries,
} from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { WifiOff, Workflow } from "lucide-react-native";

import { useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";
import { healthOf, offlineAlert } from "./health";
import { RunHealth } from "./run-health";
import { useOfflineNeeds } from "./use-offline-needs";

/**
 * How your flows did: the share of their runs that finished. With a
 * project, each flow of it; without one, each project over every Space you
 * are in. In a project, a flow that needs a computer that is offline says
 * so. A sheet from Home (`/flows`) and from a project
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
	// Only the flows of a project name their computers.
	const offline = useOfflineNeeds(projectId);
	const health = summary.data ? healthOf(summary.data, offline) : null;
	const alert = offline ? offlineAlert(offline) : null;
	const now = summary.data?.at ?? Date.now();

	return (
		<Screen
			onRefresh={() => summary.refetch()}
			summary="How often their runs finish."
		>
			<Stack.Screen
				options={{ title: project ? `Flows in ${project.name}` : "Flows" }}
			/>
			{alert ? (
				<Alert icon={WifiOff} variant="destructive">
					<AlertTitle>{alert.title}</AlertTitle>
					<AlertDescription>{alert.description}</AlertDescription>
				</Alert>
			) : null}
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
