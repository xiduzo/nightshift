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

/** Useful runs, Gate answers, and what became of pull requests. */
export function FeedbackPage() {
	const query = useQuery(orpc.feedback.queryOptions({ input: {} }));
	const data = query.data;
	return (
		<Page
			title="Feedback"
			detail="See which runs people found useful and how fast Gates get an answer."
		>
			<LoadState pending={query.isPending} error={query.isError}>
				{data ? (
					<>
						<Stats>
							<Stat label="Finished runs" value={count(data.finished)} />
							<Stat label="Answered" value={count(data.answered)} />
							<Stat label="Useful" value={count(data.useful)} />
							<Stat label="Useful rate" value={percent(data.usefulRate)} />
						</Stats>
						<Stats>
							<Stat
								label="Cost per useful result"
								value={dollars(data.costPerUsefulResult)}
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
						<Section title="Pull requests">
							<p className="text-muted-foreground text-sm">
								Only a schedule that scores pull requests sends these.
							</p>
							<Stats>
								<Stat label="Merged" value={count(data.pullRequests.merged)} />
								<Stat label="Closed" value={count(data.pullRequests.closed)} />
								<Stat
									label="Reverted within 7 days"
									value={count(data.pullRequests.revertedWithin7Days)}
								/>
								<Stat
									label="Reverted rate"
									value={percent(data.pullRequests.revertedRate)}
								/>
							</Stats>
							{data.pullRequests.byInstallWeek.length === 0 ? (
								<EmptyNote title="No pull request is recorded yet." />
							) : (
								<Columns
									headers={[
										"Install",
										"Week",
										"Merged",
										"Closed",
										"Reverted",
										"Flag",
									]}
									rows={data.pullRequests.byInstallWeek.map((row) => [
										row.installId,
										row.week,
										count(row.merged),
										count(row.closed),
										count(row.revertedWithin7Days),
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
