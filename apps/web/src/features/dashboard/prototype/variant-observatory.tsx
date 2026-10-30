/**
 * PROTOTYPE, throw away. Variant D, "Observatory": the dashboard once the
 * monitoring proposal lands (run metrics per step, guards and budgets, the
 * morning digest, feedback scores, tokens by model, the OpenTelemetry
 * export). A long report with a table of contents on the left. Sections with
 * invented numbers carry a "Sample data" badge.
 */

import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Label } from "@nightshift/ui/components/label";
import { Progress } from "@nightshift/ui/components/progress";
import { Switch } from "@nightshift/ui/components/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { BellIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { RunStatusBadge } from "@/features/runs";
import type { DashboardSummary } from "@/shared/api";
import {
	formatCost,
	formatKnownCost,
	formatTime,
	formatTokens,
} from "@/shared/format";
import { formatNight, formatNightShort } from "../nights";
import type { VariantProps } from "../project-dashboard-page";
import { nightsOf } from "../ranges";
import {
	type DashboardRange,
	RangeBar,
	rangeLabel,
	useDashboardRange,
} from "./range-bar";
import {
	MODEL_SHARES,
	SAMPLE_FLOWS,
	sampleGuards,
	sampleHotSpots,
	sampleOutcomes,
	sampleTokens,
} from "./variant-observatory-sample";

const SECTIONS = [
	{ id: "obs-digest", title: "Morning digest" },
	{ id: "obs-guards", title: "Guards and budgets" },
	{ id: "obs-money", title: "Where the money goes" },
	{ id: "obs-steps", title: "Step hot spots" },
	{ id: "obs-outcomes", title: "Outcomes that count" },
	{ id: "obs-export", title: "Export" },
] as const;

export function VariantObservatory({ summary, isLoading }: VariantProps) {
	const { range } = useDashboardRange();
	const flows = summary?.flowHealth?.rows.map((row) => row.name) ?? [];
	const shownFlows = flows.length > 0 ? flows : SAMPLE_FLOWS;

	return (
		<div className="grid gap-8 lg:grid-cols-[12rem_1fr]">
			<nav
				aria-label="On this page"
				className="hidden lg:sticky lg:top-4 lg:flex lg:h-fit lg:flex-col lg:gap-1"
			>
				<p className="px-2 pb-1 font-medium text-muted-foreground text-xs">
					On this page
				</p>
				{SECTIONS.map((section) => (
					<Button
						key={section.id}
						variant="ghost"
						size="sm"
						className="justify-start"
						nativeButton={false}
						render={<a href={`#${section.id}`} />}
					>
						{section.title}
					</Button>
				))}
			</nav>

			<div className="flex min-w-0 flex-col gap-10">
				<div className="sticky top-0 z-10 border-b bg-background/95 py-3 backdrop-blur">
					<RangeBar />
				</div>

				<Digest summary={summary} isLoading={isLoading} range={range} />
				<Guards summary={summary} flows={shownFlows} range={range} />
				<Money summary={summary} range={range} />
				<HotSpots flows={shownFlows} range={range} />
				<Outcomes summary={summary} flows={shownFlows} range={range} />
				<Export />
			</div>
		</div>
	);
}

/** A section of the report, with an anchor for the table of contents. */
function ReportSection({
	id,
	title,
	description,
	sample,
	children,
}: {
	id: string;
	title: string;
	description: string;
	/** What the invented numbers stand for; shows the "Sample data" badge. */
	sample?: string;
	children: ReactNode;
}) {
	return (
		<section id={id} className="flex scroll-mt-20 flex-col gap-3">
			<div className="flex flex-col gap-1">
				<div className="flex items-center gap-2">
					<h2 className="font-semibold text-lg tracking-tight">{title}</h2>
					{sample ? <Badge variant="outline">Sample data</Badge> : null}
				</div>
				<p className="text-muted-foreground text-sm">{description}</p>
				{sample ? (
					<p className="text-muted-foreground text-xs italic">{sample}</p>
				) : null}
			</div>
			{children}
		</section>
	);
}

/** The numbers of the range: the hours of the last day, or whole nights. */
function rangeNumbers(summary: DashboardSummary, range: DashboardRange) {
	if (range === "24h") {
		const day = summary.cards.lastDay;
		return {
			runs: day.runs,
			finished: day.finished,
			spend: day.cost.costUsd,
			gatesAsked: null,
			gatesAnswered: null,
		};
	}
	const nights = nightsOf(summary, range);
	return {
		runs: nights.runs.runs,
		finished: nights.runs.finished,
		spend: nights.spend.total,
		gatesAsked: nights.gates.asked,
		gatesAnswered: nights.gates.answered,
	};
}

function Digest({
	summary,
	isLoading,
	range,
}: {
	summary: DashboardSummary | undefined;
	isLoading: boolean;
	range: DashboardRange;
}) {
	const lastNight = summary?.lastNight;
	const waiting =
		summary && range !== "24h" ? nightsOf(summary, range).gates.unanswered : 0;

	return (
		<ReportSection
			id={SECTIONS[0].id}
			title="Morning digest"
			description="One message when your quiet hours end. It lists each run of the night and the Gates that wait."
		>
			<div className="grid gap-4 md:grid-cols-[22rem_1fr] md:items-start">
				<Card size="sm" className="rounded-3xl">
					<CardContent className="flex flex-col gap-3">
						<div className="flex items-center gap-2 text-muted-foreground text-xs">
							<BellIcon className="size-3.5" />
							<span>Night Shift · 7:00</span>
						</div>
						<p className="font-medium text-sm">
							{lastNight
								? `Night of ${formatNight(lastNight.night)}: ${lastNight.runs} ${lastNight.runs === 1 ? "run" : "runs"}, ${formatKnownCost(lastNight.cost)}`
								: isLoading
									? "Loading the night"
									: "No runs last night"}
						</p>
						<ItemGroup className="gap-1">
							{(lastNight?.latest ?? []).map((run) => (
								<Item key={run.id} size="xs" variant="muted">
									<ItemContent className="min-w-0">
										<ItemTitle className="w-full truncate">
											{run.title}
										</ItemTitle>
										<ItemDescription className="truncate">
											{run.reason ?? run.branch}
										</ItemDescription>
									</ItemContent>
									<ItemActions className="flex-col items-end gap-1">
										<RunStatusBadge status={run.status} result={run.result} />
										<span className="text-muted-foreground text-xs tabular-nums">
											{formatCost(run.costUsd)}
										</span>
									</ItemActions>
								</Item>
							))}
						</ItemGroup>
						<p className="text-sm">
							{waiting > 0
								? `${waiting} ${waiting === 1 ? "Gate waits" : "Gates wait"} for you.`
								: "No Gate waits for you."}
						</p>
					</CardContent>
				</Card>
				<div className="flex flex-col gap-2 text-muted-foreground text-sm">
					<p>
						The digest goes to this computer, to your phone and to the Inbox. It
						shows the latest night, whatever range you pick above.
					</p>
					<p>Choose when it arrives in Settings.</p>
				</div>
			</div>
		</ReportSection>
	);
}

export function Guards({
	summary,
	flows,
	range,
}: {
	summary: DashboardSummary | undefined;
	flows: string[];
	range: DashboardRange;
}) {
	const typical = new Map(
		(summary?.flowHealth?.rows ?? []).map((row) => [
			row.name,
			row.cost?.median ?? null,
		]),
	);
	const rows = flows.map((flow) => ({
		flow,
		typical: typical.get(flow) ?? null,
		...sampleGuards(flow, range),
	}));

	return (
		<ReportSection
			id={SECTIONS[1].id}
			title="Guards and budgets"
			description={`What a typical run costs against its budget, and how often a guard stopped a run in ${rangeLabel(range)}.`}
			sample="The budgets and guard counts are invented. The typical cost is real where a flow has finished runs."
		>
			<Card className="py-0">
				<CardContent className="px-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="pl-4">Flow</TableHead>
								<TableHead className="w-64">
									Typical run of the budget
								</TableHead>
								<TableHead className="text-right">Budget stops</TableHead>
								<TableHead className="text-right">Stalled</TableHead>
								<TableHead className="text-right">Looped</TableHead>
								<TableHead className="pr-4 text-right">Out of turns</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => {
								const used = row.typical ?? 0;
								const share = Math.min(100, Math.round((used / row.cap) * 100));
								return (
									<TableRow key={row.flow}>
										<TableCell className="pl-4 font-mono text-xs">
											{row.flow}
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-3">
												<Progress value={share} className="w-32" />
												<span className="text-muted-foreground text-xs tabular-nums">
													{row.typical === null
														? "No cost yet"
														: formatCost(row.typical)}{" "}
													of {formatCost(row.cap)}
												</span>
											</div>
										</TableCell>
										<GuardCell count={row.budgetStops} />
										<GuardCell count={row.stalls} />
										<GuardCell count={row.loops} />
										<GuardCell count={row.turns} className="pr-4" />
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</ReportSection>
	);
}

function GuardCell({
	count,
	className,
}: {
	count: number;
	className?: string;
}) {
	return (
		<TableCell className={`text-right tabular-nums ${className ?? ""}`}>
			{count === 0 ? (
				<span className="text-muted-foreground">0</span>
			) : (
				<Badge variant="destructive">{count}</Badge>
			)}
		</TableCell>
	);
}

const MODEL_CONFIG = Object.fromEntries(
	MODEL_SHARES.map((model) => [
		model.key,
		{ label: model.label, color: model.color },
	]),
) satisfies ChartConfig;

const TOKEN_CONFIG = {
	tokens: { label: "Tokens" },
} satisfies ChartConfig;

export function Money({
	summary,
	range,
}: {
	summary: DashboardSummary | undefined;
	range: DashboardRange;
}) {
	const totals: { label: string; title: string; total: number }[] = !summary
		? []
		: range === "24h"
			? summary.cards.hours.map((hour) => ({
					label: formatTime(hour.hour),
					title: formatTime(hour.hour),
					total: hour.costUsd,
				}))
			: nightsOf(summary, range).spend.perNight.map(({ night, counts }) => ({
					label: formatNightShort(night),
					title: formatNight(night),
					total: Object.values(counts).reduce((sum, value) => sum + value, 0),
				}));
	const rows = totals.map(({ label, title, total }) => ({
		label,
		title,
		...Object.fromEntries(
			MODEL_SHARES.map((model) => [
				model.key,
				Math.round(total * model.share * 100) / 100,
			]),
		),
	}));
	const spend = summary ? rangeNumbers(summary, range).spend : 0;
	const tokens = sampleTokens(spend);

	return (
		<ReportSection
			id={SECTIONS[2].id}
			title="Where the money goes"
			description={`${formatCost(spend)} in ${rangeLabel(range)}, split by model, and the tokens behind it.`}
			sample="The spend per night is real. The split by model and the token counts are invented."
		>
			<div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
				<Card size="sm">
					<CardContent>
						<ChartContainer
							config={MODEL_CONFIG}
							className="aspect-auto h-64 w-full"
						>
							<BarChart data={rows} margin={{ left: 0, right: 8 }}>
								<CartesianGrid vertical={false} />
								<XAxis
									dataKey="label"
									tickLine={false}
									axisLine={false}
									minTickGap={16}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									width={48}
									tickFormatter={(value: number) => formatCost(value)}
								/>
								<ChartTooltip
									content={<ChartTooltipContent labelKey="title" />}
								/>
								<ChartLegend content={<ChartLegendContent />} />
								{MODEL_SHARES.map((model, index) => (
									<Bar
										key={model.key}
										dataKey={model.key}
										stackId="spend"
										fill={`var(--color-${model.key})`}
										radius={
											index === MODEL_SHARES.length - 1 ? [3, 3, 0, 0] : 0
										}
									/>
								))}
							</BarChart>
						</ChartContainer>
					</CardContent>
				</Card>
				<Card size="sm">
					<CardContent className="flex flex-col gap-2">
						<p className="font-medium text-sm">Tokens by type</p>
						<ChartContainer
							config={TOKEN_CONFIG}
							className="aspect-auto h-52 w-full"
						>
							<BarChart
								data={tokens}
								layout="vertical"
								margin={{ left: 8, right: 16 }}
							>
								<XAxis type="number" hide />
								<YAxis
									type="category"
									dataKey="type"
									tickLine={false}
									axisLine={false}
									width={84}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											hideIndicator
											formatter={(value) => formatTokens(Number(value))}
										/>
									}
								/>
								<Bar dataKey="tokens" radius={3} />
							</BarChart>
						</ChartContainer>
					</CardContent>
				</Card>
			</div>
		</ReportSection>
	);
}

export function HotSpots({
	flows,
	range,
}: {
	flows: string[];
	range: DashboardRange;
}) {
	const rows = sampleHotSpots(flows, range);
	return (
		<ReportSection
			id={SECTIONS[3].id}
			title="Step hot spots"
			description={`The steps that fail, retry or cost the most in ${rangeLabel(range)}. Open one to see its runs.`}
			sample="Night Shift does not count per step yet. All numbers here are invented."
		>
			<Card className="py-0">
				<CardContent className="px-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="pl-4">Flow · step</TableHead>
								<TableHead className="text-right">Runs</TableHead>
								<TableHead className="text-right">Typical time</TableHead>
								<TableHead className="text-right">Typical cost</TableHead>
								<TableHead className="w-48">Retries of the maximum</TableHead>
								<TableHead className="pr-4 text-right">
									Share of failures
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={`${row.flow}/${row.step}`}>
									<TableCell className="pl-4">
										<span className="font-mono text-xs">{row.flow}</span>
										<span className="text-muted-foreground"> · </span>
										<span className="text-sm">{row.step}</span>
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{row.runs}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{row.minutes} min
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatCost(row.costUsd)}
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-3">
											<Progress
												value={Math.round((row.retries / row.maxRetries) * 100)}
												className="w-24"
											/>
											<span className="text-muted-foreground text-xs tabular-nums">
												{row.retries} of {row.maxRetries}
											</span>
										</div>
									</TableCell>
									<TableCell className="pr-4 text-right tabular-nums">
										{row.failShare > 0 ? `${row.failShare}%` : "None"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</ReportSection>
	);
}

export function Outcomes({
	summary,
	flows,
	range,
}: {
	summary: DashboardSummary | undefined;
	flows: string[];
	range: DashboardRange;
}) {
	const real = summary ? rangeNumbers(summary, range) : null;
	const rows = flows.map((flow) => ({ flow, ...sampleOutcomes(flow, range) }));

	return (
		<ReportSection
			id={SECTIONS[4].id}
			title="Outcomes that count"
			description="A finished run is not the goal. This shows which pull requests you merged and how you answered the Gates."
			sample="The pull request outcomes and Gate scores per flow are invented. The totals below are real."
		>
			{real ? (
				<p className="text-sm">
					{real.finished} of {real.runs} runs finished in {rangeLabel(range)}
					{real.gatesAsked === null
						? "."
						: `. You answered ${real.gatesAnswered} of ${real.gatesAsked} Gates.`}
				</p>
			) : null}
			<Card className="py-0">
				<CardContent className="px-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="pl-4">Flow</TableHead>
								<TableHead className="text-right">Pull requests</TableHead>
								<TableHead className="text-right">Merged</TableHead>
								<TableHead className="text-right">Closed</TableHead>
								<TableHead className="text-right">Reverted</TableHead>
								<TableHead className="w-48">Merge rate</TableHead>
								<TableHead className="pr-4 text-right">
									Gates approved
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => {
								const rate = Math.round((row.merged / row.opened) * 100);
								return (
									<TableRow key={row.flow}>
										<TableCell className="pl-4 font-mono text-xs">
											{row.flow}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.opened}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.merged}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.closed}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.reverted > 0 ? (
												<Badge variant="destructive">{row.reverted}</Badge>
											) : (
												<span className="text-muted-foreground">0</span>
											)}
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-3">
												<Progress value={rate} className="w-24" />
												<span className="text-muted-foreground text-xs tabular-nums">
													{rate}%
												</span>
											</div>
										</TableCell>
										<TableCell className="pr-4 text-right tabular-nums">
											{row.gates === 0
												? "No Gates"
												: `${row.approved} of ${row.gates}`}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</ReportSection>
	);
}

function Export() {
	return (
		<ReportSection
			id={SECTIONS[5].id}
			title="Export"
			description="Send your runs to a dashboard you already use, such as Grafana or SigNoz."
		>
			<Card size="sm">
				<CardContent>
					<div className="flex items-start justify-between gap-6">
						<div className="flex flex-col gap-1">
							<Label htmlFor="obs-otel">Send to OpenTelemetry</Label>
							<p className="text-muted-foreground text-sm">
								Sends each run, step and Gate with its time, cost and tokens.
								Prompts and code stay on this computer. Off until you turn it
								on.
							</p>
						</div>
						<Switch id="obs-otel" disabled checked={false} />
					</div>
				</CardContent>
			</Card>
		</ReportSection>
	);
}
