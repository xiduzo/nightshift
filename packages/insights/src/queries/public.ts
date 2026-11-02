import type { InsightsDb } from "../client";
import { usageAgentShare } from "../schema";
import { firstNight } from "./first-night";
import { mix } from "./mix";
import { mornings } from "./mornings";
import { asNumber } from "./numbers";
import { overview } from "./overview";
import { retention } from "./retention";

/** The public page waits until this many installs have sent an event. */
const PUBLIC_INSTALLS = 5;

export type PublicNumbers =
	| { ready: false }
	| {
			ready: true;
			installs: number;
			openedPullRequests: number;
			mergedPullRequests: number;
			mergedRate: number | null;
			revertedWithin7Days: number;
			revertedRate: number | null;
			costPerMergedPullRequest: number | null;
			medianSecondsToFirstFinishedRun: number | null;
			medianSecondsToFirstMergedPullRequest: number | null;
			shareWithTwoOrMoreAgents: number | null;
			/** Installs with an event in the current UTC week. */
			weeklyActiveInstalls: number;
			nightsPerWeek: number | null;
			week4Retention: number | null;
			gatesByPerson: number;
			gatesByDeadline: number;
			medianGateWaitSeconds: number | null;
			phoneAnswers: number;
			desktopAnswers: number;
			firstFlowStarters: {
				starter: string | null;
				from: string | null;
				installs: number;
			}[];
	  };

export async function publicNumbers(db: InsightsDb): Promise<PublicNumbers> {
	const [share] = await db.select().from(usageAgentShare);
	const installs = asNumber(share?.installs);
	if (installs < PUBLIC_INSTALLS) return { ready: false };
	const [home, first, morning, blend, kept] = await Promise.all([
		overview(db),
		firstNight(db),
		mornings(db),
		mix(db),
		retention(db),
	]);
	return {
		ready: true,
		installs,
		openedPullRequests: morning.opened,
		mergedPullRequests: morning.merged,
		mergedRate: morning.mergedRate,
		revertedWithin7Days: morning.revertedWithin7Days,
		revertedRate: morning.revertedRate,
		costPerMergedPullRequest: morning.costPerMergedPullRequest,
		medianSecondsToFirstFinishedRun: first.medianSecondsToFirstFinishedRun,
		medianSecondsToFirstMergedPullRequest:
			first.medianSecondsToFirstMergedPullRequest,
		shareWithTwoOrMoreAgents: blend.shareWithTwoOrMoreAgents,
		weeklyActiveInstalls: home.activeInstallsThisWeek,
		nightsPerWeek: kept.nightsPerWeek,
		week4Retention: kept.week4Retention,
		gatesByPerson: morning.gates.byPerson,
		gatesByDeadline: morning.gates.byDeadline,
		medianGateWaitSeconds: morning.gates.medianWaitSeconds,
		phoneAnswers: morning.gates.phone,
		desktopAnswers: morning.gates.desktop,
		firstFlowStarters: blend.firstFlowStarters,
	};
}
