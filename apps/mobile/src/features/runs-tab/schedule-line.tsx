import { Moon, Play, RotateCcw } from "lucide-react-native";
import { memo } from "react";
import { Alert } from "react-native";

import { openRun } from "@/features/runs";
import { useScheduleNudges } from "@/features/schedules";
import type { RowAction } from "@/shared/native-list";
import type { ScheduleLine as Line } from "./agenda";
import { AgendaLine, ProblemLine } from "./agenda-line";

const ORANGE = "#ea580c";
const BLUE = "#2563eb";
const PAUSE_ICON = { sf: "moon.zzz", lucide: Moon } as const;
const UNDO_ICON = { sf: "arrow.uturn.backward", lucide: RotateCcw } as const;
const RUN_ICON = { sf: "play.fill", lucide: Play } as const;

/**
 * A schedule of tonight. Its actions are swipes on iOS (left: Pause
 * tonight, or Undo pause for a paused one; right: Run now) and a
 * long-press menu on Android. Run now asks first. A tap opens the run its
 * start began. When a nudge does not work, the reason shows in a row
 * under the line.
 */
export const ScheduleLine = memo(function ScheduleLine({
	line,
}: {
	line: Line;
}) {
	const { entry, title, runId } = line;
	const nudges = useScheduleNudges(entry.projectId, entry.schedule);

	const actions: RowAction[] = [];
	if (!nudges.hidden) {
		if (line.action === "pause" && !nudges.pausing) {
			actions.push({
				label: "Pause tonight",
				icon: PAUSE_ICON,
				color: ORANGE,
				onPress: nudges.pause,
			});
		} else if (line.action === "undo" && !nudges.resuming) {
			actions.push({
				label: "Undo pause",
				icon: UNDO_ICON,
				color: ORANGE,
				onPress: nudges.resume,
			});
		}
		if (line.runNow === "yes" && !nudges.starting) {
			actions.push({
				label: "Run now",
				icon: RUN_ICON,
				color: BLUE,
				edge: "leading",
				onPress: () =>
					Alert.alert(
						`Run ${title} now?`,
						"The run starts at once, with the inputs of this schedule. A pause tonight stays.",
						[
							{ text: "Cancel", style: "cancel" },
							{ text: "Run now", onPress: nudges.runNow },
						],
					),
			});
		}
	}

	return (
		<>
			<AgendaLine
				at={line.at}
				title={title}
				caption={nudges.starting ? "Starting the run…" : line.caption}
				rail={line.rail}
				muted={line.muted}
				onPress={runId === null ? undefined : () => openRun(runId)}
				actions={actions}
			/>
			{nudges.copy ? (
				<ProblemLine
					title={nudges.copy.title}
					message={nudges.copy.message}
					fix={nudges.copy.fix}
				/>
			) : null}
		</>
	);
});
