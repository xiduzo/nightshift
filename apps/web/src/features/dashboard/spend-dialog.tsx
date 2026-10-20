import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
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
import { CostText, RunStatusBadge } from "@/features/runs";
import type { Project, RunSummary } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	formatCost,
	formatKnownCost,
	formatRelative,
	sumKnownCost,
	useNow,
} from "@/shared/format";
import {
	ChartSection,
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	DetailsTabContent,
	DetailsTabs,
	type NightRange,
	NightRangeToggle,
	Stat,
	Swatch,
} from "./details";
import { OVERVIEW_ROWS } from "./overview";
import { spendGroupOf, spendPerNight } from "./spend";

const DAY_MS = 24 * 60 * 60 * 1000;
type Tab = "overview" | "groups" | "priciest";

/**
 * What runs cost, in detail, in tabs like Flow health: the last day,
 * averages, spend per night stacked by flow (or by project over all of
 * them), and the most expensive runs. One range drives every tab.
 */
export function SpendDialog({
	open,
	onOpenChange,
	runs,
	project,
	projects,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	runs: RunSummary[];
	/** One project; otherwise all of them. */
	project?: Project;
	/** To name the project of each run, over all projects. */
	projects?: Project[];
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<SpendDetails
				runs={runs}
				project={project}
				projects={projects}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function SpendDetails({
	runs,
	project,
	projects,
	onNavigate,
}: {
	runs: RunSummary[];
	project?: Project;
	projects?: Project[];
	onNavigate: () => void;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<NightRange>(30);
	const [tab, setTab] = useState<Tab>("overview");
	const groupOf = spendGroupOf(project, projects);
	const history = spendPerNight(runs, range, groupOf, now);
	const lastDay = runs.filter((run) => run.createdAt >= now - DAY_MS);
	const spentLastDay = sumKnownCost(lastDay);
	// Runs with a step whose cost is not known: the totals leave that step out.
	const unknown = history.inRange.filter((run) => run.costMissing > 0).length;
	const latest = lastDay.reduce<number | null>(
		(last, run) =>
			last === null || run.createdAt > last ? run.createdAt : last,
		null,
	);
	const priciest = history.inRange
		.filter((run) => run.costUsd > 0)
		.sort((a, b) => b.costUsd - a.costUsd)
		.slice(0, OVERVIEW_ROWS);

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
				toggle={<NightRangeToggle value={range} onValueChange={setRange} />}
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
								The totals leave those steps out. The run shows which step.
							</AlertDescription>
						</Alert>
					) : null}

					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Stat
							label="Last 24 h"
							value={formatKnownCost(spentLastDay)}
							hint={
								lastDay.length === 0
									? "No runs in the last day"
									: `${lastDay.length} ${lastDay.length === 1 ? "run" : "runs"}, the last ${latest ? formatRelative(latest, now) : ""}`
							}
						/>
						<Stat
							label="Spent"
							value={formatCost(history.total)}
							hint={`Last ${range} nights`}
						/>
						<Stat
							label="Per run"
							value={
								history.inRange.length > 0
									? formatCost(history.total / history.inRange.length)
									: "—"
							}
							hint="Average"
						/>
						<Stat
							label="Per night"
							value={
								history.nightsWithRuns > 0
									? formatCost(history.total / history.nightsWithRuns)
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
								config={history.config}
								className="aspect-auto h-56 w-full"
							>
								<BarChart data={history.rows} margin={{ left: 0, right: 0 }}>
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
												formatter={(value, name) => (
													<div className="flex w-full items-center gap-2">
														<Swatch color={`var(--color-${name})`} />
														<span className="text-muted-foreground">
															{history.config[name as string]?.label ?? name}
														</span>
														<span className="ml-auto font-medium font-mono tabular-nums">
															{formatCost(Number(value))}
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
									color: history.config[group.key]?.color,
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
												{project ? null : `${groupOf(run)}, `}
												{formatRelative(run.createdAt, now)}
											</ItemDescription>
										</ItemContent>
										<ItemActions>
											<RunStatusBadge status={run.status} />
											<CostText
												cost={run}
												className="w-20 text-right font-medium tabular-nums"
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
			cell: ({ getValue }) => formatCost(getValue()),
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
			cell: ({ row }) => formatCost(row.original.total),
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right font-medium tabular-nums",
			},
		}),
	]);
}
