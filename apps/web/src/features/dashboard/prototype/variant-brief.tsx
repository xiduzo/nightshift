/**
 * PROTOTYPE, throw away. Variant A, "Morning brief": the page reads like the
 * morning digest. One sentence sums up the range, then three short sections
 * in one column: what needs you, what the night made, what comes tonight.
 * No tiles, no charts.
 */

import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Separator } from "@nightshift/ui/components/separator";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	CircleHelpIcon,
	CircleXIcon,
	ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useOpenGates } from "@/features/gates";
import { RunList } from "@/features/runs";
import type { DashboardSummary } from "@/shared/api";
import {
	formatCost,
	formatKnownCost,
	formatRelative,
	formatTime,
	useNow,
} from "@/shared/format";
import { formatNight } from "../nights";
import type { VariantProps } from "../project-dashboard-page";
import { nightsOf } from "../ranges";
import { type DashboardRange, RangeBar, useDashboardRange } from "./range-bar";
import { BriefTonight } from "./variant-brief-tonight";

type DashboardRun =
	DashboardSummary["nights"][number]["runs"]["failed"]["rows"][number];

/** The numbers of the range the headline tells. */
type Tally = {
	runs: number;
	finished: number;
	failed: number;
	spend: number;
};

const DAY_MS = 24 * 60 * 60_000;

export function VariantBrief({
	project,
	summary,
	isLoading,
	onQuickRun,
}: VariantProps) {
	const { range, compare } = useDashboardRange();
	const gates = useOpenGates();
	const now = useNow(60_000);
	const openGates = (gates.data ?? []).filter(
		(gate) => gate.projectId === project.id,
	);

	const tally = summary ? tallyOf(summary, range) : undefined;
	const before = summary && compare ? tallyBefore(summary, range) : undefined;
	const failed = summary ? failedRuns(summary, range, now) : undefined;

	return (
		<div className="flex flex-col gap-8">
			<RangeBar />

			<div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
				{tally ? (
					<Headline
						range={range}
						tally={tally}
						before={before}
						waiting={openGates.length}
					/>
				) : (
					<div className="flex flex-col gap-3">
						<Skeleton className="h-9 w-4/5" />
						<Skeleton className="h-9 w-3/5" />
					</div>
				)}

				<BriefSection
					title="Needs you"
					description="Gates that wait for an answer, and why runs failed."
				>
					{isLoading || !failed ? (
						<Skeleton className="h-16 w-full" />
					) : openGates.length === 0 && failed.rows.length === 0 ? (
						<Empty className="border border-dashed py-8">
							<EmptyHeader>
								<EmptyTitle>Nothing needs you</EmptyTitle>
								<EmptyDescription>
									No Gate waits and no run failed in {rangePhrase(range)}.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<ItemGroup className="gap-2">
							{openGates.map((gate) => (
								<Item
									key={`${gate.runId}:${gate.stepId}`}
									variant="outline"
									size="sm"
									render={<Link to="/inbox" />}
								>
									<ItemMedia variant="icon">
										<CircleHelpIcon className="text-status-waiting" />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle className="w-full truncate">
											{gate.question}
										</ItemTitle>
										<ItemDescription>
											{gate.runTitle} asks since{" "}
											{formatRelative(gate.openedAt, now)}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Badge variant="outline">Answer</Badge>
									</ItemActions>
								</Item>
							))}
							{groupByReason(failed.rows).map((group) => (
								<FailureGroup key={group.reason} {...group} />
							))}
							{failed.count > failed.rows.length ? (
								<Button
									variant="link"
									size="sm"
									className="self-start"
									nativeButton={false}
									render={
										<Link
											to="/projects/$projectId/runs"
											params={{ projectId: project.id }}
										/>
									}
								>
									{failed.count - failed.rows.length} more failed runs
									<ArrowRightIcon data-icon="inline-end" />
								</Button>
							) : null}
						</ItemGroup>
					)}
				</BriefSection>

				<BriefSection
					title="What it made"
					description={
						summary?.lastNight
							? `The night of ${formatNight(summary.lastNight.night)}: ${summary.lastNight.runs} ${summary.lastNight.runs === 1 ? "run" : "runs"}, ${formatKnownCost(summary.lastNight.cost)}.`
							: "The runs of the last night, to review."
					}
				>
					<div className="overflow-hidden rounded-lg border">
						<RunList
							runs={summary?.lastNight?.latest}
							isLoading={isLoading}
							clockTimes
							emptyDescription="Run a flow or start a quick run. What it makes shows up here."
							emptyAction={
								<Button onClick={onQuickRun}>
									<ZapIcon data-icon="inline-start" />
									Quick run
								</Button>
							}
						/>
					</div>
				</BriefSection>

				<BriefSection
					title="Tonight"
					description="What starts and wakes on its own."
				>
					<BriefTonight projectId={project.id} upNext={summary?.upNext} />
				</BriefSection>

				<Separator />
				<nav
					aria-label="Project pages"
					className="-mt-6 flex flex-wrap gap-1 text-muted-foreground"
				>
					{(
						[
							["Flows", "/projects/$projectId/flows"],
							["Runs", "/projects/$projectId/runs"],
							["Schedules", "/projects/$projectId/schedules"],
						] as const
					).map(([label, to]) => (
						<Button
							key={label}
							variant="ghost"
							size="sm"
							nativeButton={false}
							render={<Link to={to} params={{ projectId: project.id }} />}
						>
							{label}
							<ArrowRightIcon data-icon="inline-end" />
						</Button>
					))}
				</nav>
			</div>
		</div>
	);
}

function Headline({
	range,
	tally,
	before,
	waiting,
}: {
	range: DashboardRange;
	tally: Tally;
	before: Tally | undefined;
	waiting: number;
}) {
	const lead =
		range === "24h" ? "In the last 24 hours" : `Over the last ${range} nights`;
	const outcome =
		tally.runs === 0
			? "Nothing ran."
			: `${count(tally.runs, "run")}. ${tally.finished} finished, ${tally.failed} failed.`;
	const ask =
		waiting === 0
			? "Nothing waits for you."
			: `${count(waiting, "Gate")} ${waiting === 1 ? "waits" : "wait"} for you.`;

	return (
		<div className="flex flex-col gap-3">
			<p className="text-balance font-semibold text-3xl leading-tight tracking-tight">
				{lead}: {outcome}{" "}
				<span className={waiting > 0 ? "text-status-waiting" : undefined}>
					{ask}
				</span>
			</p>
			<p className="text-muted-foreground">
				It cost {formatCost(tally.spend)}.
				{before ? ` ${changeLine(tally, before, range)}` : null}
			</p>
		</div>
	);
}

function FailureGroup({
	reason,
	runs,
}: {
	reason: string;
	runs: DashboardRun[];
}) {
	const latest = runs[0];
	if (!latest) return null;
	const flows = [...new Set(runs.map((run) => run.group))];

	return (
		<Item variant="outline" size="sm" className="items-start">
			<ItemMedia variant="icon">
				<CircleXIcon className="text-status-failed" />
			</ItemMedia>
			<ItemContent className="min-w-0 gap-2">
				<ItemTitle className="w-full">
					{runs.length === 1
						? `${latest.title} failed`
						: `${runs.length} runs failed for the same reason`}
				</ItemTitle>
				<ItemDescription className="line-clamp-3">{reason}</ItemDescription>
				<div className="flex flex-wrap items-center gap-1">
					{flows.map((flow) => (
						<Badge key={flow} variant="secondary">
							{flow}
						</Badge>
					))}
					{runs.map((run) => (
						<Badge
							key={run.id}
							variant="outline"
							render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
						>
							{formatTime(run.createdAt)}
						</Badge>
					))}
				</div>
			</ItemContent>
		</Item>
	);
}

function BriefSection({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-col gap-0.5">
				<h2 className="font-semibold text-lg tracking-tight">{title}</h2>
				<p className="text-muted-foreground text-sm">{description}</p>
			</div>
			{children}
		</section>
	);
}

function count(n: number, word: string): string {
	return `${n} ${n === 1 ? word : `${word}s`}`;
}

function rangePhrase(range: DashboardRange): string {
	return range === "24h" ? "the last 24 hours" : `the last ${range} nights`;
}

function tallyOf(summary: DashboardSummary, range: DashboardRange): Tally {
	if (range === "24h") {
		const day = summary.cards.lastDay;
		return {
			runs: day.runs,
			finished: day.finished,
			failed: day.failed,
			spend: day.cost.costUsd,
		};
	}
	const nights = nightsOf(summary, range);
	const failed =
		nights.runs.statuses.find((status) => status.status === "failed")?.count ??
		0;
	return {
		runs: nights.runs.runs,
		finished: nights.runs.finished,
		failed,
		spend: nights.spend.total,
	};
}

/**
 * The same numbers over the period just before, where the counts reach that
 * far back: the 30 nights hold the 7 before, the 90 nights the 30 before.
 */
function tallyBefore(
	summary: DashboardSummary,
	range: DashboardRange,
): Tally | undefined {
	if (range === "24h") {
		const day = summary.cards.dayBefore;
		return {
			runs: day.runs,
			finished: day.finished,
			failed: day.failed,
			spend: day.cost.costUsd,
		};
	}
	const source = range === 7 ? 30 : range === 30 ? 90 : undefined;
	if (!source) return undefined;
	const wide = nightsOf(summary, source);
	const runs = wide.runs.perNight.slice(-2 * range, -range);
	const spend = wide.spend.perNight.slice(-2 * range, -range);
	const sum = (rows: typeof runs, key?: string) =>
		rows.reduce(
			(total, { counts }) =>
				total +
				(key
					? (counts[key] ?? 0)
					: Object.values(counts).reduce((a, b) => a + b, 0)),
			0,
		);
	return {
		runs: sum(runs),
		finished: sum(runs, "finished"),
		failed: sum(runs, "failed"),
		spend: sum(spend),
	};
}

function changeLine(now: Tally, before: Tally, range: DashboardRange): string {
	const period =
		range === "24h" ? "the day before" : `the ${range} nights before`;
	const runs = now.runs - before.runs;
	const failed = now.failed - before.failed;
	const parts = [
		runs === 0
			? "as many runs"
			: `${count(Math.abs(runs), "run")} ${runs > 0 ? "more" : "fewer"}`,
		failed === 0
			? "as many failures"
			: `${Math.abs(failed)} ${failed > 0 ? "more" : "fewer"} failed`,
		`${formatCost(before.spend)} spent`,
	];
	return `Against ${period}: ${parts.join(", ")}.`;
}

/** The failed runs of the range, newest first. The 24 hours take them from the 7 nights. */
function failedRuns(
	summary: DashboardSummary,
	range: DashboardRange,
	now: number,
): { rows: DashboardRun[]; count: number } {
	if (range === "24h") {
		const rows = nightsOf(summary, 7).runs.failed.rows.filter(
			(run) => run.createdAt >= now - DAY_MS,
		);
		return { rows, count: Math.max(rows.length, summary.cards.lastDay.failed) };
	}
	return nightsOf(summary, range).runs.failed;
}

/** One group per reason, the group with the newest failure first. */
function groupByReason(
	runs: DashboardRun[],
): { reason: string; runs: DashboardRun[] }[] {
	const groups = new Map<string, DashboardRun[]>();
	for (const run of runs) {
		const reason = run.reason ?? "The run gave no reason.";
		groups.set(reason, [...(groups.get(reason) ?? []), run]);
	}
	return [...groups].map(([reason, rows]) => ({ reason, runs: rows }));
}
