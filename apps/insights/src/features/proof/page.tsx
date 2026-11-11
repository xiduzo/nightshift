import { Button } from "@nightshift/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

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

type Proof =
	| { ready: false }
	| {
			ready: true;
			installs: number;
			weeklyActiveInstalls: number;
			usefulRuns: number;
			usefulRate: number | null;
			costPerUsefulResult: number | null;
			neededYouRate: number | null;
			medianSecondsToFirstFinishedRun: number | null;
			medianSecondsToFirstUsefulRun: number | null;
			shareWithTwoOrMoreAgents: number | null;
			daysPerWeek: number | null;
			week4Retention: number | null;
			gatesByPerson: number;
			gatesByDeadline: number;
			medianGateWaitSeconds: number | null;
			phoneAnswers: number;
			desktopAnswers: number;
			mergedPullRequests: number;
			revertedWithin7Days: number;
			revertedRate: number | null;
			firstFlowStarters: {
				starter: string | null;
				from: string | null;
				installs: number;
			}[];
	  };

const COUNTS = [
	"installs",
	"weeklyActiveInstalls",
	"usefulRuns",
	"gatesByPerson",
	"gatesByDeadline",
	"phoneAnswers",
	"desktopAnswers",
	"mergedPullRequests",
	"revertedWithin7Days",
] as const;

const RATES = [
	"usefulRate",
	"costPerUsefulResult",
	"neededYouRate",
	"medianSecondsToFirstFinishedRun",
	"medianSecondsToFirstUsefulRun",
	"shareWithTwoOrMoreAgents",
	"daysPerWeek",
	"week4Retention",
	"medianGateWaitSeconds",
	"revertedRate",
] as const;

/** The public numbers. An install id is never shown. */
export function ProofPage() {
	const query = useQuery({
		queryKey: ["proof"],
		queryFn: loadProof,
	});
	const data = query.data;
	return (
		<Page
			title="Proof"
			detail={
				data?.ready === false
					? "There is not enough data yet."
					: "These numbers cover every install."
			}
		>
			<div>
				<Button variant="outline" render={<Link to="/login" />}>
					Sign in
				</Button>
			</div>
			<LoadState pending={query.isPending} error={query.isError}>
				{data?.ready === true ? (
					<>
						<Stats>
							<Stat label="Installs" value={count(data.installs)} />
							<Stat
								label="Active installs this week"
								value={count(data.weeklyActiveInstalls)}
							/>
							<Stat label="Useful rate" value={percent(data.usefulRate)} />
							<Stat
								label="Cost per useful result"
								value={dollars(data.costPerUsefulResult)}
							/>
						</Stats>
						<Stats>
							<Stat label="Useful runs" value={count(data.usefulRuns)} />
							<Stat label="Needed you" value={percent(data.neededYouRate)} />
							<Stat
								label="Time to a finished run"
								value={duration(data.medianSecondsToFirstFinishedRun)}
							/>
							<Stat
								label="Time to a useful run"
								value={duration(data.medianSecondsToFirstUsefulRun)}
							/>
						</Stats>
						<Stats>
							<Stat
								label="Two or more agents"
								value={percent(data.shareWithTwoOrMoreAgents)}
							/>
							<Stat
								label="Days with runs per install"
								value={
									data.daysPerWeek == null
										? "No rate yet"
										: count(data.daysPerWeek)
								}
							/>
						</Stats>
						<Stats>
							<Stat
								label="Week 4 retention"
								value={percent(data.week4Retention)}
							/>
							<Stat
								label="Gates answered by a person"
								value={count(data.gatesByPerson)}
							/>
							<Stat
								label="Gates answered by a deadline"
								value={count(data.gatesByDeadline)}
							/>
							<Stat
								label="Median gate wait"
								value={duration(data.medianGateWaitSeconds)}
							/>
						</Stats>
						<Stats>
							<Stat label="Phone" value={count(data.phoneAnswers)} />
							<Stat label="Desktop" value={count(data.desktopAnswers)} />
						</Stats>
						<Section title="Pull requests">
							<p className="text-muted-foreground text-sm">
								Only a schedule that scores pull requests sends these.
							</p>
							<Stats>
								<Stat label="Merged" value={count(data.mergedPullRequests)} />
								<Stat
									label="Reverted within 7 days"
									value={count(data.revertedWithin7Days)}
								/>
								<Stat
									label="Reverted rate"
									value={percent(data.revertedRate)}
								/>
							</Stats>
						</Section>
						<Section title="First flow">
							{data.firstFlowStarters.length === 0 ? (
								<EmptyNote title="No flow is recorded yet." />
							) : (
								<Columns
									headers={["Starter", "From", "Installs"]}
									rows={data.firstFlowStarters.map((row) => [
										row.starter ?? "No starter",
										row.from ?? "No source",
										count(row.installs),
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

async function loadProof(): Promise<Proof> {
	const response = await fetch("/api/proof");
	if (!response.ok) throw new Error("The numbers did not load.");
	const body: unknown = await response.json();
	const proof = readProof(body);
	if (!proof) throw new Error("The numbers did not load.");
	return proof;
}

function readProof(value: unknown): Proof | null {
	if (!value || typeof value !== "object") return null;
	if (!("ready" in value)) return null;
	if (value.ready === false) return { ready: false };
	if (value.ready !== true) return null;
	const counts = {} as Record<(typeof COUNTS)[number], number>;
	for (const key of COUNTS) {
		const field = numberField(value, key);
		if (field == null) return null;
		counts[key] = field;
	}
	const rates = {} as Record<(typeof RATES)[number], number | null>;
	for (const key of RATES) {
		const field = rateField(value, key);
		if (field === undefined) return null;
		rates[key] = field;
	}
	const starters = startersOf(value);
	if (!starters) return null;
	return { ready: true, ...counts, ...rates, firstFlowStarters: starters };
}

function numberField(value: object, key: string): number | null {
	if (!(key in value)) return null;
	const field = value[key as keyof typeof value];
	return typeof field === "number" ? field : null;
}

function rateField(value: object, key: string): number | null | undefined {
	if (!(key in value)) return undefined;
	const field = value[key as keyof typeof value];
	if (field === null) return null;
	return typeof field === "number" ? field : undefined;
}

function startersOf(value: object): ProofStarters | null {
	if (!("firstFlowStarters" in value)) return null;
	const field = value.firstFlowStarters;
	if (!Array.isArray(field)) return null;
	const rows: ProofStarters = [];
	for (const item of field) {
		if (!item || typeof item !== "object") return null;
		const starter = textOrNull(item, "starter");
		const from = textOrNull(item, "from");
		const installs = numberField(item, "installs");
		if (starter === undefined || from === undefined || installs == null) {
			return null;
		}
		rows.push({ starter, from, installs });
	}
	return rows;
}

type ProofStarters = {
	starter: string | null;
	from: string | null;
	installs: number;
}[];

function textOrNull(value: object, key: string): string | null | undefined {
	if (!(key in value)) return undefined;
	const field = value[key as keyof typeof value];
	if (field === null) return null;
	return typeof field === "string" ? field : undefined;
}
