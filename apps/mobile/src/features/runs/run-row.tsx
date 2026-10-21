import {
	costLabel,
	flowLabel,
	type RunSummary,
	whenLabel,
} from "@nightshift/client";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { RunStatusBadge } from "./status-badge";

/** Opens the live view of a run. */
export function openRun(runId: string): void {
	router.push({ pathname: "/runs/[runId]", params: { runId } });
}

/**
 * What the run's title adds to its flow's name: the inputs it started
 * with ("ticket WEB-142"). Null when it adds nothing.
 */
export function titleDetail(
	run: Pick<RunSummary, "flowName" | "title">,
): string | null {
	const flow = flowLabel(run);
	if (run.title.startsWith(`${flow} · `))
		return run.title.slice(flow.length + 3);
	return run.title === flow ? null : run.title;
}

/** One run in a list: its flow, project, status, start and cost. Tap opens it. */
export function RunRow({
	run,
	projectName,
	now,
}: {
	run: RunSummary;
	projectName: string | null;
	now: number;
}) {
	const flow = flowLabel(run);
	const detail = titleDetail(run);
	const cost = costLabel(run);
	const facts = [projectName, whenLabel(run.createdAt, now), cost].filter(
		(fact): fact is string => fact !== null,
	);
	return (
		<Pressable
			onPress={() => openRun(run.id)}
			accessibilityRole="button"
			accessibilityHint="Opens the run"
			className="active:opacity-70"
		>
			<Card className="gap-3 py-4">
				<CardHeader className="flex-row items-start justify-between gap-3 px-4">
					<View className="flex-1 gap-1">
						<CardTitle numberOfLines={1}>{flow}</CardTitle>
						{detail ? (
							<CardDescription numberOfLines={2}>{detail}</CardDescription>
						) : null}
					</View>
					<RunStatusBadge status={run.status} />
				</CardHeader>
				<CardContent className="px-4">
					<Text
						variant="muted"
						className="text-muted-foreground"
						numberOfLines={1}
					>
						{facts.join(" · ")}
					</Text>
				</CardContent>
			</Card>
		</Pressable>
	);
}
