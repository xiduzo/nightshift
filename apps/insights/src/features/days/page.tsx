import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/api";
import { count, percent } from "@/shared/format";
import { Columns, EmptyNote, LoadState, Page, Section } from "@/shared/page";

/** Runs per day, how runs end, and which guards stop them. */
export function DaysPage() {
	const query = useQuery(orpc.days.queryOptions({ input: {} }));
	const data = query.data;
	return (
		<Page
			title="Days"
			detail="See runs per day, how runs end, and which guards stop them."
		>
			<LoadState pending={query.isPending} error={query.isError}>
				{data ? (
					<>
						<Section title="Runs per day">
							{data.runsPerDay.length === 0 ? (
								<EmptyNote title="No run is recorded yet." />
							) : (
								<Columns
									headers={["Day (UTC)", "Runs"]}
									rows={data.runsPerDay.map((row) => [
										row.day,
										count(row.runs),
									])}
								/>
							)}
						</Section>
						<Section title="How runs end">
							{data.endings.length === 0 ? (
								<EmptyNote title="No run is recorded yet." />
							) : (
								<Columns
									headers={["End", "Runs"]}
									rows={data.endings.map((row) => [
										row.endReason ?? "No reason",
										count(row.runs),
									])}
								/>
							)}
						</Section>
						<Section title="Guards">
							{data.guards.length === 0 ? (
								<EmptyNote title="No guard is recorded yet." />
							) : (
								<Columns
									headers={["Guard", "Runs", "Share"]}
									rows={data.guards.map((row) => [
										row.guard,
										count(row.runs),
										percent(row.share),
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
