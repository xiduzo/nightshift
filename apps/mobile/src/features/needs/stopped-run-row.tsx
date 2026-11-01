import {
	hoverTime,
	type RunSummary,
	runActions,
	useRunPrefetch,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Play, RotateCcw } from "lucide-react-native";
import { memo } from "react";
import { View } from "react-native";

import { useSignedIn } from "@/features/host";
import { formatTime } from "@/shared/format";
import { ListRow } from "@/shared/list";
import { runStatusLook } from "@/shared/tone";
import { retryLabel } from "./retry";

/**
 * A run that stopped: "project · flow", its title, "Failed at 01:22" and
 * why. Tap opens the run. Under it, Retry (a run that failed) or Resume
 * (one that stopped), when the run allows it, and Leave it. After a tap
 * on Retry or Resume the buttons make way for what happens now, until the
 * run leaves the list.
 */
export const StoppedRunRow = memo(function StoppedRunRow({
	run,
	projectName,
	retry,
	onRetry,
	onLeave,
}: {
	run: RunSummary;
	projectName: string | null;
	/** A tap on Retry or Resume is on its way, or Night Shift took it (`retryState`). */
	retry: "sending" | "sent" | null;
	onRetry: (run: RunSummary) => void;
	onLeave: (run: RunSummary) => void;
}) {
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	const look = runStatusLook(run.status, run.result);
	const label = retryLabel(run.status);
	const canRetry = runActions(
		run.status,
		run.walker.thisDevice,
		run.result,
	).resume;
	const overline = [projectName, run.flowName].filter(Boolean).join(" · ");

	return (
		<View>
			<ListRow
				look={look}
				overline={overline || undefined}
				title={run.title}
				caption={[
					{
						text: `${look.label} at ${formatTime(run.endedAt ?? run.createdAt)}`,
						tone: look.tone,
					},
				]}
				detail={run.reason ?? undefined}
				href={{ pathname: "/runs/[runId]", params: { runId: run.id } }}
				onPressIn={() => prefetch(run.id)}
				accessibilityHint={`${hoverTime(run.endedAt ?? run.createdAt)}. Opens the run`}
			/>
			<View className="flex-row flex-wrap items-center gap-2 px-4 pb-4">
				{retry ? (
					<Text
						className="min-h-11 py-2.5 text-muted-foreground text-sm"
						accessibilityLiveRegion="polite"
					>
						{retry === "sending"
							? "Sending…"
							: "Night Shift continues this run."}
					</Text>
				) : (
					<>
						{canRetry ? (
							<Button
								size="lg"
								className="h-auto min-h-11 py-2"
								onPress={() => onRetry(run)}
								accessibilityHint="The run continues at its last step"
							>
								<Icon as={label === "Retry" ? RotateCcw : Play} />
								<Text>{label}</Text>
							</Button>
						) : null}
						<Button
							size="lg"
							variant="outline"
							className="h-auto min-h-11 py-2"
							onPress={() => onLeave(run)}
							accessibilityHint="Takes it off this list. It stays in Runs."
						>
							<Text>Leave it</Text>
						</Button>
					</>
				)}
			</View>
		</View>
	);
});
