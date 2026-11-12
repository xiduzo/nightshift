import { createRunQueries, runReport } from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react-native";
import { useCallback } from "react";

import { useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { Markdown } from "@/shared/markdown";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";

/**
 * The report of a run, whole: the Markdown the End node wrote, to read and
 * to select. A picture in it shows as a link: nothing loads from another
 * server. Read only. Opened from the run screen and from Watch.
 */
export function ReportScreen({ runId }: { runId: string }) {
	const runQueries = useHostQueries(createRunQueries);
	const queryClient = useQueryClient();
	const run = useQuery({
		...runQueries.get(runId, queryClient),
		...useWhileFocused(),
	});
	const refresh = useCallback(
		() => queryClient.invalidateQueries({ queryKey: runQueries.getKey(runId) }),
		[queryClient, runQueries, runId],
	);
	const report = run.data ? runReport(run.data) : null;
	// A run from a list knows only the start of its report: the rest loads.
	const loading = run.isPlaceholderData && report?.partial === true;

	return (
		<Screen onRefresh={refresh} summary={run.data?.title}>
			{run.isError && !run.data ? (
				<ErrorAlert
					title="This report did not load"
					message={run.error.message}
					fix="Pull down to try again."
					onRetry={() => void run.refetch()}
				/>
			) : !run.data ? (
				<>
					<Skeleton className="h-6 w-1/2" />
					<Skeleton className="h-40 w-full rounded-xl" />
				</>
			) : report ? (
				<>
					{report.cut ? (
						<Text className="text-muted-foreground text-sm">
							Night Shift kept the first 64 KB of this report.
						</Text>
					) : null}
					<Markdown text={report.text} />
					{loading ? (
						<Skeleton className="h-24 w-full rounded-xl" />
					) : report.partial ? (
						<Text className="text-muted-foreground text-sm">
							This is the start of the report.
						</Text>
					) : null}
				</>
			) : (
				<EmptyState
					icon={FileText}
					title="No report"
					description="This run wrote no report. A flow writes one at its End node."
				/>
			)}
		</Screen>
	);
}
