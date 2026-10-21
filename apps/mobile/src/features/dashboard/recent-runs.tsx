import type { RunSummary } from "@nightshift/client";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { type Href, Link } from "expo-router";
import { Fragment } from "react";
import { Pressable, View } from "react-native";

import { runFacts } from "./cards";
import { RunStatusBadge } from "./run-status-badge";

/** The newest runs over every Space. A row opens its live run. */
export function RecentRuns({
	runs,
	now,
}: {
	/** Undefined while it loads. */
	runs: RunSummary[] | undefined;
	now: number;
}) {
	return (
		<Card className="gap-4">
			<CardHeader>
				<CardTitle>Recent runs</CardTitle>
				<CardDescription>
					The newest runs of every Space you are in. Tap one to follow it.
				</CardDescription>
			</CardHeader>
			<CardContent className="gap-3">
				{runs ? (
					runs.map((run, index) => (
						<Fragment key={run.id}>
							{index > 0 ? <Separator /> : null}
							<RunRow run={run} now={now} />
						</Fragment>
					))
				) : (
					<>
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</>
				)}
			</CardContent>
		</Card>
	);
}

/**
 * The live run screen of the Runs tab. A path, not a typed route: the
 * route lives in the runs vertical, which may not have it yet.
 */
function runHref(runId: string): Href {
	return `/runs/${encodeURIComponent(runId)}` as Href;
}

function RunRow({ run, now }: { run: RunSummary; now: number }) {
	const facts = runFacts(run, now);
	return (
		<Link href={runHref(run.id)} asChild>
			<Pressable
				className="flex-row items-center gap-3 active:opacity-70"
				accessibilityRole="link"
				accessibilityHint="Opens the run"
			>
				<View className="min-w-0 flex-1 gap-0.5">
					<Text className="font-medium" numberOfLines={1}>
						{run.title}
					</Text>
					<Text className="text-muted-foreground text-xs" numberOfLines={1}>
						{facts}
					</Text>
				</View>
				<RunStatusBadge status={run.status} />
			</Pressable>
		</Link>
	);
}
