import {
	createDashboardQueries,
	createProjectQueries,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Workflow } from "lucide-react-native";

import { useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { LargeTitleHeader } from "@/shared/header";
import { Screen } from "@/shared/page";
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
	const summary = useQuery(
		dashboard.summary(projectId ? { projectId } : { everySpace: true }),
	);
	const projects = useQuery({
		...projectQueries.list(),
		enabled: projectId !== undefined,
	});
	const project = projectId
		? projects.data?.find((p) => p.id === projectId)
		: undefined;
	const health = summary.data ? healthOf(summary.data) : null;
	const now = summary.data?.at ?? Date.now();

	return (
		<Screen onRefresh={() => summary.refetch()}>
			<LargeTitleHeader
				compact
				title={project ? `Flows in ${project.name}` : "Flows"}
				summary="How often their runs finish."
			/>
			{summary.data ? (
				health ? (
					<RunHealth health={health} now={now} />
				) : (
					<EmptyState
						icon={Workflow}
						title="No runs yet"
						description="When your flows have run, you see here how often their runs finish."
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
