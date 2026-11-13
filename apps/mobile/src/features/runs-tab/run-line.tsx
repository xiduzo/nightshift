import { useRunPrefetch } from "@nightshift/client";
import { CircleStop } from "lucide-react-native";
import { memo } from "react";
import { Alert } from "react-native";

import { useSignedIn } from "@/features/host";
import { openRun, useRunAct } from "@/features/runs";
import type { RowAction } from "@/shared/native-list";
import type { RunLine as Line } from "./agenda";
import { AgendaLine, ProblemLine } from "./agenda-line";

const STOP_ICON = { sf: "stop.fill", lucide: CircleStop } as const;

/**
 * A run on its way: a tap opens it. Stop is a swipe on iOS and in the
 * long-press menu on Android, and asks first. When the stop does not
 * work, the reason shows in a row under the line.
 */
export const RunLine = memo(function RunLine({ line }: { line: Line }) {
	const act = useRunAct(line.runId, line.status);
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	const stopping = act.acting?.action === "stop";

	const stop: RowAction = {
		label: "Stop",
		icon: STOP_ICON,
		destructive: true,
		onPress: () =>
			Alert.alert(
				"Stop this run?",
				"The running step stops now, and no new step starts. You can resume the run later.",
				[
					{ text: "Cancel", style: "cancel" },
					{
						text: "Stop run",
						style: "destructive",
						onPress: () => {
							act.only("stop");
							act.stop.mutate({ runId: line.runId, when: "now" });
						},
					},
				],
			),
	};

	return (
		<>
			<AgendaLine
				at={line.at}
				title={line.title}
				caption={stopping ? "Stopping…" : line.caption}
				rail={line.rail}
				status={line.status}
				onPress={() => {
					prefetch(line.runId);
					openRun(line.runId);
				}}
				actions={stopping ? undefined : [stop]}
			/>
			{act.stop.error ? (
				<ProblemLine
					title="The run did not stop"
					message={act.stop.error.message}
					fix="Check that this phone is online and that your role in this Space lets you do this."
				/>
			) : null}
		</>
	);
});
