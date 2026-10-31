import type { DashboardSummary } from "@nightshift/client";
import { Card, CardContent } from "@nightshift/ui-native/components/ui/card";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { View } from "react-native";

import { SectionHead } from "@/shared/list";
import { FactGrid, FactTile } from "@/shared/tiles";
import { consoleGlance, GLANCE_NIGHTS } from "./console";

/**
 * How the project did last week: its runs, the share that finished, what
 * they cost and the Gates they asked, against the week before. The
 * desktop has the chart and the lists behind each number.
 */
export function ConsoleGlance({
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
				<Skeleton className="h-36 w-full rounded-xl" />
			</View>
		);
	}
	const glance = consoleGlance(summary);
	if (!glance) return null;
	return (
		<View className="gap-3">
			<SectionHead
				title={title}
				hint={glance.empty ? undefined : glance.hint}
			/>
			{glance.empty ? (
				<Card className="py-4">
					<CardContent className="px-4">
						<Text className="text-muted-foreground text-sm">
							No runs in these nights.
						</Text>
					</CardContent>
				</Card>
			) : (
				<FactGrid>
					{glance.tiles.map((tile) => (
						<FactTile
							key={tile.key}
							label={tile.label}
							value={tile.value}
							sub={tile.change ?? undefined}
						/>
					))}
				</FactGrid>
			)}
		</View>
	);
}
