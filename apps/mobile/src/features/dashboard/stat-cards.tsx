import type { DashboardSummary } from "@nightshift/client";
import {
	CircleDollarSign,
	History,
	LoaderCircle,
	type LucideIcon,
} from "lucide-react-native";

import { iconOf } from "@/shared/status";
import { StatGrid, StatTile } from "@/shared/tiles";
import { NEEDS_YOU, type Tone } from "@/shared/tone";
import { type StatCardView, statCards } from "./cards";

/** Where a card goes when the person taps it. */
const HREF = { inbox: "/inbox", runs: "/runs" } as const;

const HINT = { inbox: "Opens the inbox", runs: "Opens your runs" } as const;

const ICON: Record<StatCardView["key"], LucideIcon> = {
	running: LoaderCircle,
	waiting: iconOf(NEEDS_YOU.icon),
	spent: CircleDollarSign,
	runs: History,
};

/** A waiting Gate takes the waiting tone, failed runs the failed tone. */
const TONE: Record<StatCardView["tone"], Tone> = {
	plain: "neutral",
	waiting: NEEDS_YOU.tone,
	failed: "failed",
};

/**
 * The four numbers on top, two by two: running now, waiting for you, and
 * the spend and the runs of the last 24 hours. Skeletons while they load.
 */
export function StatCards({
	summary,
	waiting,
}: {
	/** Undefined while it loads. */
	summary: DashboardSummary | undefined;
	/** The open Gates: null when they did not load. */
	waiting: number | null;
}) {
	if (!summary) {
		return (
			<StatGrid>
				{(["running", "waiting", "spent", "runs"] as const).map((key) => (
					<StatTile key={key} value={undefined} label="" icon={ICON[key]} />
				))}
			</StatGrid>
		);
	}
	return (
		<StatGrid>
			{statCards(summary, waiting).map((card) => (
				<StatTile
					key={card.key}
					value={card.value}
					label={card.label}
					icon={ICON[card.key]}
					tone={TONE[card.tone]}
					caption={card.headline}
					detail={card.footer}
					href={card.opens ? HREF[card.opens] : undefined}
					accessibilityHint={card.opens ? HINT[card.opens] : undefined}
				/>
			))}
		</StatGrid>
	);
}
