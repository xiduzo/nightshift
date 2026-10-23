import { createDashboardQueries } from "@nightshift/client";
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
 * How your flows did over every Space you are in: the share of their runs
 * that finished. A sheet from Home and from a project.
 */
export function FlowHealthScreen() {
	const dashboard = useHostQueries(createDashboardQueries);
	const summary = useQuery(dashboard.summary({ everySpace: true }));
	const health = summary.data ? healthOf(summary.data) : null;
	const now = summary.data?.at ?? Date.now();

	return (
		<Screen onRefresh={() => summary.refetch()}>
			<LargeTitleHeader
				compact
				title="Flows"
				summary="How often the runs of each flow finish."
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
