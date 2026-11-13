import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { ChevronRight, Moon, RotateCcw } from "lucide-react-native";
import { memo, type ReactNode, useState } from "react";
import { View } from "react-native";

import { openRun } from "@/features/runs";
import { RunNowDialog, useScheduleNudges } from "@/features/schedules";
import { ErrorAlert } from "@/shared/feedback";
import type { ScheduleLine as Line } from "./agenda";
import { AgendaLine } from "./agenda-line";

const BUTTON = "h-auto min-h-11 py-2";

/**
 * A schedule of tonight: Pause, Undo for a paused one, or Open for one
 * whose run is on its way. A long press asks to run it now. A screen
 * reader offers Run now as an action. When a nudge does not work, the
 * reason shows under the line.
 */
export const ScheduleLine = memo(function ScheduleLine({
	line,
}: {
	line: Line;
}) {
	const { entry, title } = line;
	const nudges = useScheduleNudges(entry.projectId, entry.schedule);
	const [asking, setAsking] = useState(false);
	const runId = line.runId;
	const canRunNow = line.runNow === "yes" && !nudges.hidden;

	let action: ReactNode = null;
	if (line.action === "open" && runId !== null) {
		action = (
			<Button
				size="lg"
				variant="ghost"
				className={BUTTON}
				accessibilityLabel={`Open the run of ${title}`}
				onPress={() => openRun(runId)}
			>
				<Text>Open</Text>
				<Icon as={ChevronRight} />
			</Button>
		);
	} else if (nudges.hidden) {
		action = null;
	} else if (line.action === "undo") {
		action = (
			<Button
				size="lg"
				variant="ghost"
				disabled={nudges.resuming}
				className={BUTTON}
				accessibilityLabel={`Undo the pause of ${title}`}
				accessibilityHint="Starts it at its next time again"
				onPress={nudges.resume}
			>
				<Icon as={RotateCcw} />
				<Text>Undo</Text>
			</Button>
		);
	} else if (line.action === "pause") {
		action = (
			<Button
				size="lg"
				variant="secondary"
				disabled={nudges.pausing}
				className={BUTTON}
				accessibilityLabel={`Pause ${title} tonight`}
				accessibilityHint="Skips its starts until tomorrow morning"
				onPress={nudges.pause}
			>
				<Icon as={Moon} />
				<Text>Pause</Text>
			</Button>
		);
	}

	return (
		<View>
			<AgendaLine
				at={line.at}
				title={title}
				caption={nudges.starting ? "Starting the run…" : line.caption}
				rail={line.rail}
				muted={line.muted}
				onPress={runId === null ? undefined : () => openRun(runId)}
				accessibilityHint={runId === null ? undefined : "Opens the run"}
				onLongPress={
					canRunNow && !nudges.starting ? () => setAsking(true) : undefined
				}
				longPressLabel={canRunNow ? "Run now" : undefined}
				action={action}
			/>
			{canRunNow ? (
				<RunNowDialog
					name={title}
					open={asking}
					onOpenChange={setAsking}
					onConfirm={nudges.runNow}
				/>
			) : null}
			{nudges.copy ? (
				<View className="pb-2">
					<ErrorAlert
						title={nudges.copy.title}
						message={nudges.copy.message}
						fix={nudges.copy.fix}
					/>
				</View>
			) : null}
		</View>
	);
});
