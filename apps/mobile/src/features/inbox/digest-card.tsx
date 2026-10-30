import { createNotificationQueries, type Digest } from "@nightshift/client";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";
import { formatTime } from "@/shared/format";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { runStatusLook } from "@/shared/tone";

/** A digest older than this no longer shows: the next one comes soon. */
const SHOWN_FOR_MS = 24 * 60 * 60_000;

/**
 * The last morning digest on top of the inbox: its sum, and one row per
 * run that ended before it, with its status, cost and why it ended. A tap
 * opens the run. Nothing when no digest went out in the last day.
 */
export function DigestCard({ now }: { now: number }) {
	const queries = useHostQueries(createNotificationQueries);
	const digest = useQuery(queries.digest());
	const data = digest.data;
	if (!data || now - data.to > SHOWN_FOR_MS) return null;
	return (
		<View className="gap-2">
			<SectionHead
				title="Your last digest"
				hint={`Sent at ${formatTime(data.to)}`}
			/>
			<Text className="text-muted-foreground text-sm">{data.body}</Text>
			{data.runs.length > 0 ? <DigestRuns runs={data.runs} /> : null}
		</View>
	);
}

function DigestRuns({ runs }: { runs: Digest["runs"] }) {
	return (
		<ListGroup>
			{runs.map((run) => {
				const look = { ...runStatusLook(run.status), label: run.statusText };
				return (
					<ListRow
						key={run.runId}
						look={look}
						title={run.title}
						caption={[
							{ text: run.statusText, tone: look.tone },
							run.prUrl ? "Opened a pull request" : "",
						]}
						detail={run.detail ?? undefined}
						href={{ pathname: "/runs/[runId]", params: { runId: run.runId } }}
						accessibilityHint="Opens the run"
					/>
				);
			})}
		</ListGroup>
	);
}
