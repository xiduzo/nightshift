import { Badge } from "@nightshift/ui/components/badge";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/api";
import { count, dollars, percent } from "@/shared/format";
import {
	EmptyNote,
	LoadState,
	Page,
	Section,
	Stat,
	Stats,
} from "@/shared/page";

/** Active installs, days with runs, useful runs, cost, and flagged installs. */
export function OverviewPage() {
	const query = useQuery(orpc.overview.queryOptions({ input: {} }));
	const data = query.data;
	return (
		<Page
			title="Overview"
			detail="See active installs, days with runs, and the runs people found useful."
		>
			<LoadState pending={query.isPending} error={query.isError}>
				{data ? (
					<>
						<Stats>
							<Stat
								label="Active installs this week"
								value={count(data.activeInstallsThisWeek)}
							/>
							<Stat
								label="Days with runs this week"
								value={count(data.daysWithRunsThisWeek)}
							/>
							<Stat label="Useful rate" value={percent(data.usefulRate)} />
							<Stat
								label="Cost per useful result"
								value={dollars(data.costPerUsefulResult)}
							/>
						</Stats>
						<Stats>
							<Stat label="Finished runs" value={count(data.finishedRuns)} />
							<Stat label="Useful runs" value={count(data.usefulRuns)} />
							<Stat label="Needed you" value={percent(data.neededYouRate)} />
						</Stats>
						<Section title="Flagged installs">
							<p className="text-muted-foreground text-sm">
								These installs send far more events than the usual day.
							</p>
							{data.flaggedInstallIds.length === 0 ? (
								<EmptyNote title="No install is flagged." />
							) : (
								<ItemGroup>
									{data.flaggedInstallIds.map((id) => (
										<Item key={id}>
											<ItemContent>
												<ItemTitle className="font-mono">{id}</ItemTitle>
											</ItemContent>
											<ItemActions>
												<Badge>Flagged</Badge>
											</ItemActions>
										</Item>
									))}
								</ItemGroup>
							)}
						</Section>
					</>
				) : null}
			</LoadState>
		</Page>
	);
}
