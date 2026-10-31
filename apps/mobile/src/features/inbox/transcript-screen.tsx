import {
	createRunQueries,
	nodeLabels,
	type StepSummary,
	stepName,
} from "@nightshift/client";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
	Bot,
	Info,
	ListChecks,
	type LucideIcon,
	SquareTerminal,
} from "lucide-react-native";
import { Fragment, useMemo } from "react";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { LargeTitleHeader } from "@/shared/header";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";
import { type TranscriptLine, transcriptLines } from "./transcript-lines";
import { useRunTranscript } from "./use-run-transcript";

/**
 * A run's transcript as a sheet: `transcript/<runId>`. What each agent
 * said, what its tools did (one line per run of calls), the commands and
 * what they wrote, and what Night Shift did, step by step. It follows the run while it is open.
 */
export function TranscriptScreen() {
	const { runId } = useLocalSearchParams<{ runId: string }>();
	const runQueries = useHostQueries(createRunQueries);
	const run = useQuery({ ...runQueries.get(runId), ...useWhileFocused() });
	const { entries, connection } = useRunTranscript(runId);

	const lines = useMemo(() => {
		const steps = new Map<string, StepSummary>(
			(run.data?.steps ?? []).map((step) => [step.id, step]),
		);
		const labels = run.data ? nodeLabels(run.data) : new Map<string, string>();
		return transcriptLines(entries, (stepId) => {
			const step = steps.get(stepId);
			return step ? stepName(step, labels) : "Step";
		});
	}, [entries, run.data]);

	return (
		<Screen>
			<LargeTitleHeader
				compact
				title="Transcript"
				summary={
					connection === "reconnecting"
						? "Reconnecting…"
						: (run.data?.title ?? undefined)
				}
			/>
			{lines.length > 0 ? (
				lines.map((line, index) => (
					<Fragment key={line.key}>
						{line.kind === "step" && index > 0 ? <Separator /> : null}
						<Line line={line} />
					</Fragment>
				))
			) : connection === "connecting" ? (
				<>
					<Skeleton className="h-5 w-1/3" />
					<Skeleton className="h-20 w-full rounded-xl" />
					<Skeleton className="h-12 w-full rounded-md" />
				</>
			) : (
				<EmptyState
					icon={SquareTerminal}
					title="Nothing here yet"
					description="New lines show here while the run works."
				/>
			)}
		</Screen>
	);
}

const WHO: Record<
	Exclude<TranscriptLine["kind"], "step" | "output" | "tools">,
	{ icon: LucideIcon; label: string }
> = {
	agent: { icon: Bot, label: "Agent" },
	command: { icon: SquareTerminal, label: "Command" },
	"night-shift": { icon: Info, label: "Night Shift" },
};

function Line({ line }: { line: TranscriptLine }) {
	switch (line.kind) {
		case "step":
			return (
				<Text
					accessibilityRole="header"
					className="font-mono font-semibold text-sm"
				>
					{line.text}
				</Text>
			);
		case "tools":
			return (
				<View className="flex-row items-center gap-1.5" accessible>
					<Icon as={ListChecks} className="size-4 text-muted-foreground" />
					<Text className="flex-1 text-muted-foreground text-sm">
						{line.text}
					</Text>
				</View>
			);
		case "output":
			return (
				<View className="rounded-md bg-muted p-3">
					<Text selectable className="font-mono text-muted-foreground text-xs">
						{line.text.trimEnd()}
					</Text>
				</View>
			);
		default: {
			const who = WHO[line.kind];
			return (
				<View className="gap-1" accessible>
					<View className="flex-row items-center gap-1.5">
						<Icon as={who.icon} className="size-4 text-muted-foreground" />
						<Text className="font-medium text-muted-foreground text-xs">
							{who.label}
						</Text>
					</View>
					{line.kind === "agent" ? (
						<Card className="gap-0 px-3 py-2.5">
							<Text selectable className="text-sm">
								{line.text}
							</Text>
						</Card>
					) : line.kind === "command" ? (
						<View className="rounded-md bg-muted p-3">
							<Text selectable className="font-mono text-xs">
								{line.text}
							</Text>
						</View>
					) : (
						<Text selectable className="text-muted-foreground text-sm">
							{line.text}
						</Text>
					)}
				</View>
			);
		}
	}
}
