import { useRunPrefetch } from "@nightshift/client";
import { memo } from "react";
import { View } from "react-native";

import { useSignedIn } from "@/features/host";
import {
	openRun,
	RunActionButton,
	RunActionFailure,
	useRunAct,
} from "@/features/runs";
import type { RunLine as Line } from "./agenda";
import { AgendaLine } from "./agenda-line";

const NO_LABELS: ReadonlyMap<string, string> = new Map();

/** A run on its way: a tap opens it, Stop asks first and stops it. */
export const RunLine = memo(function RunLine({ line }: { line: Line }) {
	const act = useRunAct(line.runId, line.status);
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	return (
		<View>
			<AgendaLine
				at={line.at}
				title={line.title}
				caption={line.caption}
				rail={line.rail}
				onPress={() => openRun(line.runId)}
				onPressIn={() => prefetch(line.runId)}
				accessibilityHint="Opens the run"
				action={
					<RunActionButton
						runId={line.runId}
						action="stop"
						act={act}
						labels={NO_LABELS}
					/>
				}
			/>
			<RunActionFailure act={act} />
		</View>
	);
});
