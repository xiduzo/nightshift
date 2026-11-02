import { Badge } from "@nightshift/ui/components/badge";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/api";
import { count, dollars, duration, percent } from "@/shared/format";
import {
	Columns,
	EmptyNote,
	LoadState,
	Page,
	Section,
	Stat,
	Stats,
} from "@/shared/page";

/** Pull requests, gate answers, and phone or desktop. */
export function MorningsPage() {
	const query = useQuery(orpc.mornings.queryOptions({ input: {} }));
	const data = query.data;
	return (
		<Page
			title="Mornings"
			detail="See pull requests and how fast gates get an answer."
		>
			<LoadState pending={query.isPending} error={query.isError}>
				{data ? (
					<>
						<Stats>
							<Stat label="Opened" value={count(data.opened)} />
							<Stat label="Merged" value={count(data.merged)} />
							<Stat label="Closed" value={count(data.closed)} />
							<Stat label="Reverted" value={count(data.reverted)} />
						</Stats>
						<Stats>
							<Stat
								label="Merged pull request rate"
								value={percent(data.mergedRate)}
							/>
							<Stat
								label="Reverted within 7 days"
								value={percent(data.revertedRate)}
							/>
							<Stat
								label="Cost per kept pull request"
								value={dollars(data.costPerMergedPullRequest)}
							/>
							<Stat
								label="Median gate wait"
								value={duration(data.gates.medianWaitSeconds)}
							/>
						</Stats>
						<Section title="Gates">
							<Columns
								headers={["Answer", "Count"]}
								rows={[
									["Answered by a person", count(data.gates.byPerson)],
									["Answered by a deadline", count(data.gates.byDeadline)],
									["Phone", count(data.gates.phone)],
									["Desktop", count(data.gates.desktop)],
									["Web", count(data.gates.web)],
									["Lock screen", count(data.gates.lockScreen)],
									["Other", count(data.gates.other)],
								]}
							/>
						</Section>
						<Section title="Pull requests by week">
							{data.byInstallWeek.length === 0 ? (
								<EmptyNote title="No pull request is recorded yet." />
							) : (
								<Columns
									headers={[
										"Install",
										"Week",
										"Opened",
										"Merged",
										"Closed",
										"Reverted",
										"Flag",
									]}
									rows={data.byInstallWeek.map((row) => [
										row.installId,
										row.week,
										count(row.opened),
										count(row.merged),
										count(row.closed),
										count(row.reverted),
										row.flagged ? (
											<Badge key={row.installId}>Flagged</Badge>
										) : (
											""
										),
									])}
								/>
							)}
						</Section>
					</>
				) : null}
			</LoadState>
		</Page>
	);
}
