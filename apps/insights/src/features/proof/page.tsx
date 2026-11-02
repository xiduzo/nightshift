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
			openedPullRequests: number;
			mergedPullRequests: number;
			mergedRate: number | null;
			revertedWithin7Days: number;
			revertedRate: number | null;
			costPerMergedPullRequest: number | null;
			medianSecondsToFirstFinishedRun: number | null;
			medianSecondsToFirstMergedPullRequest: number | null;
			shareWithTwoOrMoreAgents: number | null;
			weeklyActiveInstalls: number;
			nightsPerWeek: number | null;
			week4Retention: number | null;
			gatesByPerson: number;
			gatesByDeadline: number;
			medianGateWaitSeconds: number | null;
			phoneAnswers: number;
			desktopAnswers: number;
			firstFlowStarters: {
				starter: string | null;
				from: string | null;
				installs: number;
			}[];
	  };

const COUNTS = [
	"installs",
	"openedPullRequests",
	"mergedPullRequests",
	"revertedWithin7Days",
	"weeklyActiveInstalls",
	"gatesByPerson",
	"gatesByDeadline",
	"phoneAnswers",
	"desktopAnswers",
] as const;

const RATES = [
	"mergedRate",
	"revertedRate",
	"costPerMergedPullRequest",
	"medianSecondsToFirstFinishedRun",
	"medianSecondsToFirstMergedPullRequest",
	"shareWithTwoOrMoreAgents",
	"nightsPerWeek",
	"week4Retention",
	"medianGateWaitSeconds",
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
							<Stat
								label="Merged pull request rate"
								value={percent(data.mergedRate)}
							/>
							<Stat
								label="Cost per kept pull request"
								value={dollars(data.costPerMergedPullRequest)}
							/>
						</Stats>
						<Stats>
							<Stat label="Opened" value={count(data.openedPullRequests)} />
							<Stat label="Merged" value={count(data.mergedPullRequests)} />
							<Stat
								label="Reverted within 7 days"
								value={count(data.revertedWithin7Days)}
							/>
							<Stat label="Reverted rate" value={percent(data.revertedRate)} />
						</Stats>
						<Stats>
							<Stat
								label="Time to a finished run"
								value={duration(data.medianSecondsToFirstFinishedRun)}
							/>
							<Stat
								label="Time to a merged pull request"
								value={duration(data.medianSecondsToFirstMergedPullRequest)}
							/>
							<Stat
								label="Two or more agents"
								value={percent(data.shareWithTwoOrMoreAgents)}
							/>
							<Stat
								label="Nights per install"
								value={
									data.nightsPerWeek == null
										? "No rate yet"
										: count(data.nightsPerWeek)
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
