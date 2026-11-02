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

/** Active installs, nights, merge rate, cost, and flagged installs. */
export function OverviewPage() {
	const query = useQuery(orpc.overview.queryOptions({ input: {} }));
	const data = query.data;
	return (
		<Page
			title="Overview"
			detail="See active installs, nights, and pull requests this week."
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
								label="Nights with runs"
								value={count(data.nightsWithRunsThisWeek)}
							/>
							<Stat
								label="Merged pull request rate"
								value={percent(data.mergedRate)}
							/>
							<Stat
								label="Cost per kept pull request"
								value={dollars(data.costPerMergedPullRequest)}
							/>
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
