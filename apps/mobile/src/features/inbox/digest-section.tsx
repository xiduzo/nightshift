import {
	createNotificationQueries,
	type Digest,
	digestShown,
	hoverTime,
	useRunPrefetch,
} from "@nightshift/client";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { type Href, Link } from "expo-router";
import { Pressable, View } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import { useClock } from "@/shared/clock";
import { formatTime } from "@/shared/format";
import { ListGroup } from "@/shared/list";
import { UsefulChoice } from "./useful-choice";

/** The person's last morning digest. Null when none went out yet. */
export function useLastDigest(subscribed: boolean) {
	const queries = useHostQueries(createNotificationQueries);
	return useQuery({ ...queries.digest(), subscribed });
}

/**
 * The last morning digest on top of Needs you: its sum, one row per run
 * that ended before it, and one per knowledge source that needs you.
 * A run that opened a pull request asks whether it was useful.
 * Nothing when no digest went out in the last day.
 */
export function DigestSection({
	digest,
}: {
	digest: Digest | null | undefined;
}) {
	const now = useClock(60_000);
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	if (!digestShown(digest, now)) return null;
	const hasRows = digest.runs.length > 0 || digest.sources.length > 0;
	return (
		<View className="gap-3">
			<View className="gap-0.5">
				<Text
					accessibilityRole="header"
					className="font-semibold text-xl tracking-tight"
				>
					Your last digest
				</Text>
				<Text
					className="text-muted-foreground text-sm"
					accessibilityHint={hoverTime(digest.to)}
				>
					{`Sent at ${formatTime(digest.to)}`}
				</Text>
			</View>
			<Text className="text-muted-foreground text-sm">{digest.body}</Text>
			{hasRows ? (
				<ListGroup>
					{digest.runs.map((run) => (
						<DigestRun key={run.runId} run={run} prefetch={prefetch} />
					))}
					{digest.sources.map((source) => (
						<DigestSource
							key={`${source.projectId} ${source.title}`}
							source={source}
							prefetch={prefetch}
						/>
					))}
				</ListGroup>
			) : null}
		</View>
	);
}

function runFacts(run: Digest["runs"][number]): string {
	return [
		run.statusText,
		run.prUrl ? "Opened a pull request" : null,
		run.detail,
	]
		.filter((part): part is string => part !== null && part !== "")
		.join(" · ");
}

function DigestRun({
	run,
	prefetch,
}: {
	run: Digest["runs"][number];
	prefetch: (runId: string) => void;
}) {
	const facts = runFacts(run);
	return (
		<View className="gap-2 px-4 py-3">
			<RunLink
				runId={run.runId}
				title={run.title}
				detail={facts}
				onPressIn={() => prefetch(run.runId)}
			/>
			<UsefulChoice run={run} />
		</View>
	);
}

function DigestSource({
	source,
	prefetch,
}: {
	source: Digest["sources"][number];
	prefetch: (runId: string) => void;
}) {
	return (
		<View className="px-4 py-3">
			<RunLink
				runId={source.runId}
				title={source.title}
				detail={source.statusText}
				onPressIn={() => prefetch(source.runId)}
			/>
		</View>
	);
}

function RunLink({
	runId,
	title,
	detail,
	onPressIn,
}: {
	runId: string;
	title: string;
	detail: string;
	onPressIn: () => void;
}) {
	const href: Href = { pathname: "/runs/[runId]", params: { runId } };
	return (
		<Link href={href} asChild>
			<Pressable
				accessibilityRole="button"
				accessibilityHint="Opens the run"
				onPressIn={onPressIn}
				className="gap-0.5 active:opacity-80"
			>
				<Text className="font-medium text-base" numberOfLines={2}>
					{title}
				</Text>
				{detail ? (
					<Text className="text-muted-foreground text-sm" numberOfLines={2}>
						{detail}
					</Text>
				) : null}
			</Pressable>
		</Link>
	);
}
