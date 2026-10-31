import {
	CircleCheck,
	CircleDollarSign,
	CircleStop,
	CircleX,
} from "lucide-react-native";

import { StatGrid, StatTile } from "@/shared/tiles";
import type { NightNumbers } from "./last-night";

function shown(count: number | null | undefined): string | undefined {
	if (count === undefined) return undefined;
	return count === null ? "—" : String(count);
}

/**
 * The numbers of last night, two by two: finished, failed and stopped
 * runs, and what the night cost. Skeletons while they load. A tap on a
 * count opens Runs with that filter.
 */
export function NightTiles({
	numbers,
}: {
	/** Undefined while the summary loads. */
	numbers: NightNumbers | undefined;
}) {
	const finished = numbers?.finished;
	const failed = numbers?.failed;
	const stopped = numbers?.stopped;
	return (
		<StatGrid>
			<StatTile
				value={numbers ? shown(finished) : undefined}
				label="Finished"
				icon={CircleCheck}
				tone={finished ? "finished" : "neutral"}
				href={{ pathname: "/runs", params: { filter: "finished" } }}
				accessibilityHint="Opens every finished run, not only last night's"
			/>
			<StatTile
				value={numbers ? shown(failed) : undefined}
				label="Failed"
				icon={CircleX}
				tone={failed ? "failed" : "neutral"}
				href={{ pathname: "/runs", params: { filter: "failed" } }}
				accessibilityHint="Opens every failed or interrupted run, not only last night's"
			/>
			<StatTile
				value={numbers ? shown(stopped) : undefined}
				label="Stopped"
				icon={CircleStop}
				tone={stopped ? "stopped" : "neutral"}
				href={{ pathname: "/runs", params: { filter: "stopped" } }}
				accessibilityHint="Opens every stopped run, not only last night's"
			/>
			<StatTile
				value={numbers?.cost}
				label="Cost"
				icon={CircleDollarSign}
				caption={numbers?.costCaption}
			/>
		</StatGrid>
	);
}
