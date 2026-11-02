import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/api";
import { count, percent } from "@/shared/format";
import { Columns, EmptyNote, LoadState, Page, Section } from "@/shared/page";

/** Runs per night, how runs end, and which guards stop them. */
export function NightsPage() {
	const query = useQuery(orpc.nights.queryOptions({ input: {} }));
	const data = query.data;
	return (
		<Page
			title="Nights"
			detail="See runs per night, how runs end, and which guards stop them."
		>
			<LoadState pending={query.isPending} error={query.isError}>
				{data ? (
					<>
						<Section title="Runs per night">
							{data.runsPerNight.length === 0 ? (
								<EmptyNote title="No run is recorded yet." />
							) : (
								<Columns
									headers={["Night", "Runs"]}
									rows={data.runsPerNight.map((row) => [
										row.night,
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
