import type { InsightsDb } from "../client";
import { usageAgentShare } from "../schema";
import { feedback } from "./feedback";
import { funnel } from "./funnel";
import { mix } from "./mix";
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
			/** Installs with an event in the current UTC week. */
			weeklyActiveInstalls: number;
			usefulRuns: number;
			usefulRate: number | null;
			costPerUsefulResult: number | null;
			neededYouRate: number | null;
			medianSecondsToFirstFinishedRun: number | null;
			medianSecondsToFirstUsefulRun: number | null;
			shareWithTwoOrMoreAgents: number | null;
			daysPerWeek: number | null;
			week4Retention: number | null;
			gatesByPerson: number;
			gatesByDeadline: number;
			medianGateWaitSeconds: number | null;
			phoneAnswers: number;
			desktopAnswers: number;
			/** The code scorer: pull requests that merged, and reverts within 7 days. */
			mergedPullRequests: number;
			revertedWithin7Days: number;
			revertedRate: number | null;
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
	const [home, first, said, blend, kept] = await Promise.all([
		overview(db),
		funnel(db),
		feedback(db),
		mix(db),
		retention(db),
	]);
	return {
		ready: true,
		installs,
		weeklyActiveInstalls: home.activeInstallsThisWeek,
		usefulRuns: home.usefulRuns,
		usefulRate: home.usefulRate,
		costPerUsefulResult: home.costPerUsefulResult,
		neededYouRate: home.neededYouRate,
		medianSecondsToFirstFinishedRun: first.medianSecondsToFirstFinishedRun,
		medianSecondsToFirstUsefulRun: first.medianSecondsToFirstUsefulRun,
		shareWithTwoOrMoreAgents: blend.shareWithTwoOrMoreAgents,
		daysPerWeek: kept.daysPerWeek,
		week4Retention: kept.week4Retention,
		gatesByPerson: said.gates.byPerson,
		gatesByDeadline: said.gates.byDeadline,
		medianGateWaitSeconds: said.gates.medianWaitSeconds,
		phoneAnswers: said.gates.phone,
		desktopAnswers: said.gates.desktop,
		mergedPullRequests: said.pullRequests.merged,
		revertedWithin7Days: said.pullRequests.revertedWithin7Days,
		revertedRate: said.pullRequests.revertedRate,
		firstFlowStarters: blend.firstFlowStarters,
	};
}
