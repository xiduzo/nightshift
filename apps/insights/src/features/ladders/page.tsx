import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/api";
import { count, dollars, percent } from "@/shared/format";
import {
	Columns,
	EmptyNote,
	LoadState,
	Page,
	Section,
	Stat,
	Stats,
} from "@/shared/page";

/**
 * The registry's rungs in plain words, as Flow health says them. A person
 * is "A person" here, not "You": these are other people's runs. Any other
 * value shows as sent.
 */
const RUNG_LABEL: Record<string, string> = {
	rule: "Rule",
	first: "First tier",
	later: "Later tier",
	person: "A person",
	deadline: "Its deadline",
	none: "Nowhere",
	_OTHER: "Other",
};

type Totals = {
	landings: number;
	installs: number;
	costPerLanding: number | null;
	rungs: {
		rung: string;
		landings: number;
		share: number | null;
		installs: number;
		costPerLanding: number | null;
	}[];
};

/** Where work and choices landed, what a landing cost, and how often a decider was not sure enough. */
export function LaddersPage() {
	const query = useQuery(orpc.ladders.queryOptions({ input: {} }));
	const data = query.data;
	return (
		<Page
			title="Ladders"
			detail="See where work and choices landed, what a landing cost, and how often a decider was not sure."
		>
			<LoadState pending={query.isPending} error={query.isError}>
				{data ? (
					<>
						<Stats>
							<Stat label="Work landings" value={count(data.work.landings)} />
							<Stat label="Decisions" value={count(data.choice.landings)} />
							<Stat
								label="Cost per work landing"
								value={dollars(data.work.costPerLanding)}
							/>
							<Stat
								label="Not sure enough"
								value={percent(data.choice.unsureShare)}
							/>
						</Stats>
						<Section title="Work">
							<LadderTable
								totals={data.work}
								empty="No work landing is recorded yet."
							/>
						</Section>
						<Section title="Choices">
							<p className="text-muted-foreground text-sm">
								Not sure enough is a share of every Decision that a rule did not
								make.
							</p>
							<LadderTable
								totals={data.choice}
								empty="No Decision is recorded yet."
							/>
						</Section>
					</>
				) : null}
			</LoadState>
		</Page>
	);
}

function LadderTable({ totals, empty }: { totals: Totals; empty: string }) {
	if (totals.rungs.length === 0) return <EmptyNote title={empty} />;
	return (
		<Columns
			headers={["Rung", "Share", "Landings", "Installs", "Cost per landing"]}
			rows={[
				...totals.rungs.map((row) => [
					RUNG_LABEL[row.rung] ?? row.rung,
					percent(row.share),
					count(row.landings),
					count(row.installs),
					dollars(row.costPerLanding),
				]),
				[
					"All rungs",
					percent(1),
					count(totals.landings),
					count(totals.installs),
					dollars(totals.costPerLanding),
				],
			]}
		/>
	);
}
