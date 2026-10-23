import {
	CircleCheck,
	CircleDollarSign,
	CircleX,
	Hand,
} from "lucide-react-native";

import { StatGrid, StatTile } from "@/shared/tiles";
import type { NightNumbers } from "./last-night";

function shown(count: number | null | undefined): string | undefined {
	if (count === undefined) return undefined;
	return count === null ? "—" : String(count);
}

/**
 * The numbers of last night, two by two: finished and failed runs, the
 * Gates that need you now, and what the night cost. Skeletons while they
 * load. A tap on a count opens its list.
 */
export function NightTiles({
	numbers,
	waiting,
}: {
	/** Undefined while the summary loads. */
	numbers: NightNumbers | undefined;
	/** The Gates you may answer. Undefined while they load, null when they did not. */
	waiting: number | null | undefined;
}) {
	const finished = numbers?.finished;
	const failed = numbers?.failed;
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
				value={shown(waiting)}
				label="Needs you"
				icon={Hand}
				tone={waiting ? "waiting" : "neutral"}
				href="/inbox"
				accessibilityHint="Opens the inbox"
			/>
			<StatTile
				value={numbers?.cost}
				label="Spent"
				icon={CircleDollarSign}
				caption={numbers?.costCaption}
				detail={numbers?.runTime ?? undefined}
			/>
		</StatGrid>
	);
}
