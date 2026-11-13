import { type RunSummary, useRunPrefetch } from "@nightshift/client";
import { router } from "expo-router";
import { CirclePlay, TriangleAlert } from "lucide-react-native";
import { useEffect, useState } from "react";

import { useSignedIn } from "@/features/host";
import {
	type AnswerBar,
	ChoiceSection,
	type GateQueue,
	useQueueBar,
} from "@/features/inbox";
import { formatTime } from "@/shared/format";
import { HeaderToolbar } from "@/shared/header";
import {
	NativeList,
	NativeRow,
	NativeSection,
	NativeTextRow,
	NativeTitleRow,
} from "@/shared/native-list";
import { useThemeColors } from "@/shared/theme";
import { runStatusLook } from "@/shared/tone";
import { stoppedFacts, stoppedOptions } from "./stopped-view";

const NO_ROUTES = new Map();

/**
 * A run that stopped, in full, as Needs you shows it: its title, where
 * it is from and when it stopped, why it stopped, the run to check
 * first, then what you can do as options in their color (Retry or
 * Resume, Leave it). The bar above the tabs confirms the choice in its
 * color. Once Night Shift takes a Retry or Resume, `onRetried` moves the
 * queue on.
 */
export function RunBriefing({
	run,
	projectName,
	retry,
	onRetry,
	onRetried,
	onLeave,
	onRefresh,
	queue,
}: {
	run: RunSummary;
	projectName: string | null;
	/** A tap on Retry or Resume is on its way, or Night Shift took it (`retryState`). */
	retry: "sending" | "sent" | null;
	onRetry: (run: RunSummary) => void;
	onRetried: (run: RunSummary, label: string) => void;
	onLeave: (run: RunSummary) => void;
	onRefresh: () => Promise<unknown>;
	/** What shows at the top, in the header and in the bar above the tabs. */
	queue: GateQueue;
}) {
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	const { colors } = useThemeColors();
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

	const bar: AnswerBar = {
		choice: option
			? { name: option.name, color: option.color ?? null, destructive: false }
			: null,
		prompt: "Choose what happens",
		action: {
			label: option ? option.act : "Confirm",
			busyLabel: "Sending…",
			busy: retry !== null,
			disabled: !option,
		},
	};
	useQueueBar(queue, bar, act);

	return (
		<>
			{queue.right.length > 0 ? (
				<HeaderToolbar placement="right" items={queue.right} />
			) : null}
			<NativeList onRefresh={onRefresh}>
				{queue.lead}

				<NativeSection>
					<NativeTitleRow
						title={run.title}
						caption={stoppedFacts(run, {
							projectName,
							statusLabel: look.label,
							time: formatTime,
						})}
					/>
				</NativeSection>

				{run.reason ? (
					<NativeSection title="Why it stopped">
						<NativeTextRow
							icon={{
								sf: "exclamationmark.triangle.fill",
								lucide: TriangleAlert,
							}}
							iconColor={colors.destructive}
							text={run.reason}
						/>
					</NativeSection>
				) : null}

				<NativeSection
					title="Check first"
					footer="Look at the run before you choose."
				>
					<NativeRow
						icon={{ sf: "play.circle", lucide: CirclePlay }}
						title="Open the run"
						subtitle="Its steps and where it stopped"
						onPress={() => {
							prefetch(run.id);
							router.push({
								pathname: "/runs/[runId]",
								params: { runId: run.id },
							});
						}}
					/>
				</NativeSection>

				<ChoiceSection
					title="What happens now"
					choices={options}
					routes={NO_ROUTES}
					chosen={chosen}
					onChoose={setChosen}
					disabled={retry !== null}
				/>
			</NativeList>
		</>
	);
}
