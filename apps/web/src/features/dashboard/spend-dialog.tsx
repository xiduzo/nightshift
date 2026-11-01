import { nightsOf } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import { DialogFooter } from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CircleHelpIcon } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { CostWithTokens, RunStatusBadge } from "@/features/runs";
import type { DashboardSummary, NightRange, Project } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	costWithTokens,
	formatCost,
	formatKnownCost,
	formatRelative,
	useNow,
} from "@/shared/format";
import { LocalTime } from "@/shared/time";
import {
	ChartSection,
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	DetailsTabContent,
	DetailsTabs,
	NightRangeToggle,
	Stat,
	Swatch,
} from "./details";
import { nightChartRows } from "./nights";

type Tab = "overview" | "groups" | "priciest";

/**
 * What runs cost, in detail, in tabs like Flow health: the last day,
 * averages, spend per night stacked by flow (or by project over all of
 * them), and the most expensive runs. One range drives every tab.
 */
export function SpendDialog({
	open,
	onOpenChange,
	summary,
	project,
	initialRange,
	initialTab,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	summary: DashboardSummary;
	/** One project; otherwise all of them. */
	project?: Project;
	/** The range it opens at: the page's. Default 30 nights. */
	initialRange?: NightRange;
	/** The tab it opens at. Default Overview. */
	initialTab?: Tab;
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<SpendDetails
				summary={summary}
				project={project}
				onNavigate={() => onOpenChange(false)}
				initialRange={initialRange}
				initialTab={initialTab}
			/>
		</DetailsDialog>
	);
}

function SpendDetails({
	summary,
	project,
	onNavigate,
	initialRange = 30,
	initialTab = "overview",
}: {
	summary: DashboardSummary;
	project?: Project;
	onNavigate: () => void;
	initialRange?: NightRange;
	initialTab?: Tab;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<NightRange>(initialRange);
	const [tab, setTab] = useState<Tab>(initialTab);
	const history = nightsOf(summary, range).spend;
	const lastDay = summary.cards.lastDay;
	// Runs with a step whose cost is not known: the totals leave that step out.
	const { unknown, priciest } = history;
	const latest = lastDay.latestAt;
	const rows = history.perNight.map((night, index) => {
		const tokens = history.tokensPerNight[index]?.counts ?? {};
		return {
			...(nightChartRows([night])[0] ?? {}),
			...Object.fromEntries(
				Object.entries(tokens).map(([key, value]) => [`${key}Tokens`, value]),
			),
		};
	});
	const config = Object.fromEntries(
		history.groups.map((group, index) => [
			group.key,
			{
				label: group.label,
				color:
					group.key === "other"
						? "var(--muted-foreground)"
						: `var(--chart-${index + 1})`,
			},
		]),
	) satisfies ChartConfig;

	return (
		<>
			<DetailsHeader project={project} trail="Runs" title="Spend" />

			<DetailsTabs
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "groups", label: project ? "By flow" : "By project" },
					{ value: "priciest", label: "Most expensive" },
				]}
				value={tab}
				onValueChange={setTab}
				toggle={
					<NightRangeToggle
						ranges={summary.nights.map((n) => n.nights)}
						value={range}
						onValueChange={setRange}
					/>
				}
			>
				<DetailsTabContent value="overview">
					{unknown > 0 ? (
						<Alert>
							<CircleHelpIcon />
							<AlertTitle>Some costs are not known</AlertTitle>
							<AlertDescription>
								{unknown === 1
									? `1 run in the last ${range} nights has a step that did not report its cost.`
									: `${unknown} runs in the last ${range} nights have a step that did not report its cost.`}{" "}
								The totals do not include those steps. Open the run to see which
								step.
							</AlertDescription>
						</Alert>
					) : null}

					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Stat
							label="Last 24 h"
							value={costWithTokens(
								formatKnownCost(lastDay.cost),
								lastDay.tokens,
							)}
							hint={
								lastDay.runs === 0 ? (
									"No runs in the last day"
								) : (
									<>
										{lastDay.runs} {lastDay.runs === 1 ? "run" : "runs"}
										{latest ? (
											<>
												, the last{" "}
												<LocalTime at={latest}>
													{formatRelative(latest, now)}
												</LocalTime>
											</>
										) : null}
									</>
								)
							}
						/>
						<Stat
							label="Spent"
							value={costWithTokens(formatCost(history.total), history.tokens)}
							hint={`Last ${range} nights`}
						/>
						<Stat
							label="Per run"
							value={
								history.runs > 0
									? costWithTokens(
											formatCost(history.total / history.runs),
											history.tokens / history.runs,
										)
									: "—"
							}
							hint="Average"
						/>
						<Stat
							label="Per night"
							value={
								history.nightsWithRuns > 0
									? costWithTokens(
											formatCost(history.total / history.nightsWithRuns),
											history.tokens / history.nightsWithRuns,
										)
									: "—"
							}
							hint="Nights with runs"
						/>
					</div>

					<ChartSection
						title="History"
						hint={`Per night, noon to noon, by ${project ? "flow" : "project"}`}
					>
						{history.total === 0 ? (
							<DetailsEmpty>No spend in the last {range} nights.</DetailsEmpty>
						) : (
							<ChartContainer
								config={config}
								className="aspect-auto h-56 w-full"
							>
								<BarChart data={rows} margin={{ left: 0, right: 0 }}>
									<CartesianGrid vertical={false} />
									<XAxis
										dataKey="label"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
										minTickGap={24}
									/>
									<YAxis
										tickLine={false}
										axisLine={false}
										width={48}
										tickFormatter={(value: number) => `$${value.toFixed(2)}`}
									/>
									<ChartTooltip
										cursor={false}
										content={
											<ChartTooltipContent
												labelKey="title"
												labelFormatter={(_, payload) =>
													String(payload[0]?.payload?.title ?? "")
												}
												formatter={(value, name, item) => (
													<div className="flex w-full items-center gap-2">
														<Swatch color={`var(--color-${name})`} />
														<span className="text-muted-foreground">
															{config[name as string]?.label ?? name}
														</span>
														<span className="ml-auto font-medium font-mono tabular-nums">
															{costWithTokens(
																formatCost(Number(value)),
																Number(
																	(
																		item.payload as
																			| Record<string, number | string>
																			| undefined
																	)?.[`${String(name)}Tokens`] ?? 0,
																),
															)}
														</span>
													</div>
												)}
											/>
										}
									/>
									{history.groups.map((group, index) => (
										<Bar
											key={group.key}
											dataKey={group.key}
											stackId="spend"
											fill={`var(--color-${group.key})`}
											radius={
												index === history.groups.length - 1
													? [4, 4, 0, 0]
													: [0, 0, 0, 0]
											}
										/>
									))}
								</BarChart>
							</ChartContainer>
						)}
					</ChartSection>
				</DetailsTabContent>

				<DetailsTabContent value="groups">
					<ChartSection
						title={project ? "Spend per flow" : "Spend per project"}
						hint="The most spend first"
					>
						{history.groups.length === 0 ? (
							<DetailsEmpty>No runs in the last {range} nights.</DetailsEmpty>
						) : (
							<DataTable
								columns={spendColumns(
									project ? "Flow" : "Project",
									history.total,
								)}
								data={history.groups.map((group) => ({
									...group,
									color: config[group.key]?.color,
								}))}
								getRowId={(group) => group.key}
							/>
						)}
					</ChartSection>
				</DetailsTabContent>

				<DetailsTabContent value="priciest">
					<ChartSection
						title="Most expensive runs"
						hint={`The top ${priciest.length} of the last ${range} nights`}
					>
						{priciest.length === 0 ? (
							<DetailsEmpty>No spend in the last {range} nights.</DetailsEmpty>
						) : (
							<ItemGroup className="gap-1">
								{priciest.map((run) => (
									<Item
										key={run.id}
										size="xs"
										render={
											<Link
												to="/runs/$runId"
												params={{ runId: run.id }}
												onClick={onNavigate}
											/>
										}
									>
										<ItemContent className="min-w-0">
											<ItemTitle className="w-full truncate">
												{run.title}
											</ItemTitle>
											<ItemDescription>
												{project ? null : `${run.group}, `}
												<LocalTime at={run.createdAt}>
													{formatRelative(run.createdAt, now)}
												</LocalTime>
											</ItemDescription>
										</ItemContent>
										<ItemActions>
											<RunStatusBadge status={run.status} />
											<CostWithTokens
												cost={run}
												tokens={run.tokens}
												className="text-right font-medium tabular-nums"
											/>
										</ItemActions>
									</Item>
								))}
							</ItemGroup>
						)}
					</ChartSection>
				</DetailsTabContent>
			</DetailsTabs>

			{project ? (
				<DialogFooter>
					<Button
						variant="outline"
						nativeButton={false}
						render={
							<Link
								to="/projects/$projectId/runs"
								params={{ projectId: project.id }}
								onClick={onNavigate}
							/>
						}
					>
						All runs
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
				</DialogFooter>
			) : null}
		</>
	);
}

type SpendRow = {
	key: string;
	label: string;
	color: string | undefined;
	runs: number;
	total: number;
	tokens: number;
};

const spendColumn = dataTableColumns<SpendRow>();

/** Spend per flow or project: runs, cost per run, share and total. */
function spendColumns(groupLabel: string, total: number) {
	return spendColumn.columns([
		spendColumn.accessor("label", {
			header: groupLabel,
			cell: ({ row }) => (
				<span className="flex min-w-0 items-center gap-2">
					<Swatch color={row.original.color} />
					<span className="truncate font-mono text-xs">
						{row.original.label}
					</span>
				</span>
			),
		}),
		spendColumn.accessor("runs", {
			header: "Runs",
			enableSorting: true,
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right tabular-nums",
			},
		}),
		spendColumn.accessor((group) => group.total / group.runs, {
			id: "perRun",
			header: "Per run",
			enableSorting: true,
			cell: ({ row: { original } }) =>
				costWithTokens(
					formatCost(original.total / original.runs),
					original.tokens / original.runs,
				),
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right tabular-nums",
			},
		}),
		spendColumn.accessor((group) => (total > 0 ? group.total / total : 0), {
			id: "share",
			header: "Share",
			enableSorting: true,
			cell: ({ getValue }) =>
				total > 0 ? `${Math.round(getValue() * 100)}%` : "—",
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right text-muted-foreground tabular-nums",
			},
		}),
		spendColumn.accessor("total", {
			header: "Total",
			enableSorting: true,
			cell: ({ row }) =>
				costWithTokens(formatCost(row.original.total), row.original.tokens),
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right font-medium tabular-nums",
			},
		}),
	]);
}
