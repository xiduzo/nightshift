import type { DashboardSummary } from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { View } from "react-native";

import { SectionHead } from "@/shared/list";
import { FactGrid, FactTile } from "@/shared/tiles";
import { GLANCE_NIGHTS, nightsFacts } from "./console";

/** How the project did last week: its runs, the share that finished and what they cost. */
export function NightsGlance({
	summary,
	failed,
}: {
	/** Undefined while it loads. */
	summary: DashboardSummary | undefined;
	/** The numbers did not load: the glance stays out. */
	failed: boolean;
}) {
	const title = `Last ${GLANCE_NIGHTS} nights`;
	if (!summary) {
		if (failed) return null;
		return (
			<View className="gap-3">
				<SectionHead title={title} />
				<Skeleton className="h-24 w-full rounded-xl" />
			</View>
		);
	}
	const facts = nightsFacts(summary);
	if (!facts) return null;
	return (
		<View className="gap-3">
			<SectionHead title={title} />
			<FactGrid>
				{facts.map((fact) => (
					<FactTile key={fact.key} label={fact.label} value={fact.value} />
				))}
			</FactGrid>
		</View>
	);
}
