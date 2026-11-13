import { type RunSummary, useRunPrefetch } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { CirclePlay, TriangleAlert } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { View } from "react-native";

import { useSignedIn } from "@/features/host";
import { ChoiceCards } from "@/features/inbox";
import { ActionBar } from "@/shared/action-bar";
import { formatTime } from "@/shared/format";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { StatusBadge } from "@/shared/status";
import { runStatusLook } from "@/shared/tone";
import { stoppedFacts, stoppedOptions } from "./stopped-view";

const NO_ROUTES = new Map();

/**
 * A run that stopped, in full, as Needs you shows it: its status, title,
 * where it is from and when it stopped, why it stopped, the run to check
 * first, then what you can do as cards in their color (Retry or Resume,
 * Leave it). The bar at the bottom confirms the choice in its color.
 * Once Night Shift takes a Retry or Resume, `onRetried` moves the queue on.
 */
export function RunBriefing({
	run,
	projectName,
	retry,
	onRetry,
	onRetried,
	onLeave,
	onRefresh,
	lead,
}: {
	run: RunSummary;
	projectName: string | null;
	/** A tap on Retry or Resume is on its way, or Night Shift took it (`retryState`). */
	retry: "sending" | "sent" | null;
	onRetry: (run: RunSummary) => void;
	onRetried: (run: RunSummary, label: string) => void;
	onLeave: (run: RunSummary) => void;
	onRefresh: () => Promise<unknown>;
	/** What shows above the run: where it is in the queue, and Skip. */
	lead: ReactNode;
}) {
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	const look = runStatusLook(run.status, run.result);
	const options = stoppedOptions(run);
	const [chosen, setChosen] = useState<string | null>(null);
	const option = options.find((each) => each.name === chosen) ?? null;
	const retryName = options.find((each) => each.do === "retry")?.name;

	useEffect(() => {
		if (retry === "sent" && retryName) onRetried(run, retryName);
	}, [retry, retryName, run, onRetried]);

	function act() {
		if (!option) return;
		if (option.do === "retry") onRetry(run);
		else onLeave(run);
	}

	return (
		<Screen
			onRefresh={onRefresh}
			footer={
				<ActionBar
					caption={option ? "Your choice" : undefined}
					label={option ? option.name : "Choose what happens"}
					color={option?.color}
					action={{
						label: option ? option.act : "Confirm",
						onPress: act,
						disabled: !option,
						busy: retry !== null,
						busyLabel: "Sending…",
					}}
				/>
			}
		>
			{lead}

			<View className="gap-3">
				<Text
					accessibilityRole="header"
					selectable
					className="font-bold text-2xl tracking-tight"
				>
					{run.title}
				</Text>
				<View className="flex-row flex-wrap items-center gap-2">
					<StatusBadge look={look} />
				</View>
				<Text className="text-muted-foreground text-sm">
					{stoppedFacts(run, {
						projectName,
						statusLabel: look.label,
						time: formatTime,
					})}
				</Text>
			</View>

			{run.reason ? (
				<Alert icon={TriangleAlert} variant="destructive">
					<AlertTitle>Why it stopped</AlertTitle>
					<AlertDescription>{run.reason}</AlertDescription>
				</Alert>
			) : null}

			<View className="gap-2">
				<SectionHead
					title="Check first"
					hint="Look at the run before you choose."
				/>
				<ListGroup>
					<ListRow
						icon={CirclePlay}
						title="Open the run"
						caption="Its steps and where it stopped"
						href={{ pathname: "/runs/[runId]", params: { runId: run.id } }}
						onPressIn={() => prefetch(run.id)}
					/>
				</ListGroup>
			</View>

			<View className="gap-3">
				<SectionHead title="What happens now" />
				<ChoiceCards
					choices={options}
					routes={NO_ROUTES}
					chosen={chosen}
					onChoose={setChosen}
					disabled={retry !== null}
				/>
			</View>
		</Screen>
	);
}
