import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/api";
import { count, percent } from "@/shared/format";
import {
	Columns,
	EmptyNote,
	LoadState,
	Page,
	Section,
	Stat,
	Stats,
} from "@/shared/page";

/** Weekly cohorts by the week of the first run. */
export function RetentionPage() {
	const query = useQuery(orpc.retention.queryOptions({ input: {} }));
	const data = query.data;
	return (
		<Page
			title="Retention"
			detail="See weekly cohorts by the week of the first run."
		>
			<LoadState pending={query.isPending} error={query.isError}>
				{data ? (
					<>
						<Stats>
							<Stat
								label="Nights per install"
								value={
									data.nightsPerWeek == null
										? "No rate yet"
										: count(data.nightsPerWeek)
								}
							/>
							<Stat
								label="Week 4 retention"
								value={percent(data.week4Retention)}
							/>
						</Stats>
						<Section title="Weeks">
							{data.weeks.length === 0 ? (
								<EmptyNote title="No week is recorded yet." />
							) : (
								<Columns
									headers={[
										"Week",
										"Active installs",
										"Installs with runs",
										"Nights",
										"Nights per install",
									]}
									rows={data.weeks.map((row) => [
										row.week,
										count(row.activeInstalls),
										count(row.installsWithRuns),
										count(row.nights),
										row.nightsPerInstall == null
											? "No rate yet"
											: count(row.nightsPerInstall),
									])}
								/>
							)}
						</Section>
						<Section title="Cohorts">
							{data.cohorts.length === 0 ? (
								<EmptyNote title="No cohort is recorded yet." />
							) : (
								<Columns
									headers={["Week of the first run", "Installs", "Week 4"]}
									rows={data.cohorts.map((row) => [
										row.week,
										count(row.size),
										row.retainedWeek4 == null
											? "No rate yet"
											: count(row.retainedWeek4),
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
